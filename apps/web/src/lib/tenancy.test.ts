import { beforeAll, describe, expect, it } from "vitest";

const CENTRAL_URL = "postgresql://u:p@central.example.neon.tech/main?sslmode=require";

type TenancyModule = typeof import("./tenancy");
type DbModule = typeof import("./db");
let tenancy: TenancyModule;
let dbMod: DbModule;

beforeAll(async () => {
  process.env.DATABASE_URL = CENTRAL_URL;
  process.env.WB_BANK_DB = "postgresql://u:p@bank.example.neon.tech/main?sslmode=require";
  process.env.WB_FBI_DB = "postgresql://u:p@fbi.example.neon.tech/main?sslmode=require";
  dbMod = await import("./db");
  tenancy = await import("./tenancy");
});

function placement(over: Partial<Parameters<TenancyModule["groupByCorpus"]>[0][number]> = {}) {
  return {
    projectId: "p1",
    projectSlug: "project-x",
    projectName: "Project X",
    clientId: "c1",
    clientSlug: "leozenit",
    clientName: "ZenIT",
    isolationMode: "shared",
    corpusDbUrlEnv: null,
    ...over,
  };
}

describe("groupByCorpus", () => {
  it("keeps the central target even when the user owns nothing", () => {
    const map = tenancy.groupByCorpus([], null);
    expect(map.targets).toHaveLength(1);
    expect(map.targets[0]?.db).toBe(dbMod.db);
    expect(map.allProjectIds).toEqual([]);
  });

  it("collapses every shared client into a single target", () => {
    const map = tenancy.groupByCorpus(
      [
        placement({ projectId: "p1", clientId: "c1", clientSlug: "leozenit" }),
        placement({ projectId: "p2", clientId: "c2", clientSlug: "deli" }),
        placement({ projectId: "p3", clientId: "c2", clientSlug: "deli" }),
      ],
      null,
    );

    // One target means the dashboard stays exactly one query for a user
    // whose clients are all shared.
    expect(map.targets).toHaveLength(1);
    const only = map.targets[0];
    expect(only?.db).toBe(dbMod.db);
    expect(only?.projectIds).toEqual(["p1", "p2", "p3"]);
    expect(only?.clientIds).toEqual(["c1", "c2"]);
  });

  it("gives each dedicated client its own target", () => {
    const map = tenancy.groupByCorpus(
      [
        placement({ projectId: "p1", clientId: "c1", clientSlug: "leozenit" }),
        placement({
          projectId: "p2",
          clientId: "c2",
          clientSlug: "bank",
          isolationMode: "dedicated",
          corpusDbUrlEnv: "WB_BANK_DB",
        }),
        placement({
          projectId: "p3",
          clientId: "c3",
          clientSlug: "fbi",
          isolationMode: "dedicated",
          corpusDbUrlEnv: "WB_FBI_DB",
        }),
      ],
      null,
    );

    expect(map.targets).toHaveLength(3);
    const keys = map.targets.map((t) => t.key).sort();
    expect(keys).toEqual(["dedicated:WB_BANK_DB", "dedicated:WB_FBI_DB", "shared"]);

    const handles = map.targets.map((t) => t.db);
    expect(new Set(handles).size).toBe(3);
  });

  it("never mixes a dedicated client's projects into the shared target", () => {
    const map = tenancy.groupByCorpus(
      [
        placement({ projectId: "p1", clientId: "c1" }),
        placement({
          projectId: "p2",
          clientId: "c2",
          isolationMode: "dedicated",
          corpusDbUrlEnv: "WB_BANK_DB",
        }),
      ],
      null,
    );

    const shared = map.targets.find((t) => t.key === "shared");
    const bank = map.targets.find((t) => t.key === "dedicated:WB_BANK_DB");
    expect(shared?.projectIds).toEqual(["p1"]);
    expect(bank?.projectIds).toEqual(["p2"]);
    expect(shared?.projectIds).not.toContain("p2");
  });

  it("puts two projects of the same dedicated client in one target", () => {
    const map = tenancy.groupByCorpus(
      [
        placement({
          projectId: "p1",
          clientId: "c2",
          isolationMode: "dedicated",
          corpusDbUrlEnv: "WB_BANK_DB",
        }),
        placement({
          projectId: "p2",
          clientId: "c2",
          isolationMode: "dedicated",
          corpusDbUrlEnv: "WB_BANK_DB",
        }),
      ],
      null,
    );

    const bank = map.targets.find((t) => t.key === "dedicated:WB_BANK_DB");
    expect(bank?.projectIds).toEqual(["p1", "p2"]);
    expect(bank?.clientIds).toEqual(["c2"]);
  });

  it("labels every project so fanned-out rows can be named", () => {
    const map = tenancy.groupByCorpus(
      [
        placement({ projectId: "p1", projectSlug: "orion", clientSlug: "leozenit" }),
        placement({
          projectId: "p2",
          projectSlug: "vault",
          clientId: "c2",
          clientSlug: "bank",
          isolationMode: "dedicated",
          corpusDbUrlEnv: "WB_BANK_DB",
        }),
      ],
      null,
    );

    expect(map.labels.get("p1")?.projectSlug).toBe("orion");
    expect(map.labels.get("p1")?.clientSlug).toBe("leozenit");
    expect(map.labels.get("p2")?.projectSlug).toBe("vault");
    expect(map.labels.get("p2")?.clientSlug).toBe("bank");
    expect(map.allProjectIds).toEqual(["p1", "p2"]);
  });
});

describe("fanOutCorpus", () => {
  it("returns nothing without running the query when there are no targets", async () => {
    let calls = 0;
    const out = await tenancy.fanOutCorpus(
      { targets: [], labels: new Map(), allProjectIds: [] },
      async () => {
        calls += 1;
        return [1];
      },
    );
    expect(out).toEqual([]);
    expect(calls).toBe(0);
  });

  it("runs once for an all-shared user", async () => {
    const map = tenancy.groupByCorpus([placement({ projectId: "p1" })], null);
    let calls = 0;
    const out = await tenancy.fanOutCorpus(map, async (t) => {
      calls += 1;
      return t.projectIds;
    });
    expect(calls).toBe(1);
    expect(out).toEqual(["p1"]);
  });

  it("concatenates results across databases", async () => {
    const map = tenancy.groupByCorpus(
      [
        placement({ projectId: "p1" }),
        placement({
          projectId: "p2",
          clientId: "c2",
          isolationMode: "dedicated",
          corpusDbUrlEnv: "WB_BANK_DB",
        }),
      ],
      null,
    );
    const out = await tenancy.fanOutCorpus(map, async (t) => t.projectIds);
    expect(out.sort()).toEqual(["p1", "p2"]);
  });
});

// The scope is what stops an API key left in one client's repo from reading
// another client's corpus. These are the cases that matter if it regresses.
describe("groupByCorpus with a client scope", () => {
  const rows = [
    placement({ projectId: "p1", clientId: "leozenit-id", clientSlug: "leozenit" }),
    placement({ projectId: "p2", clientId: "bank-id", clientSlug: "bank" }),
    placement({ projectId: "p3", clientId: "bank-id", clientSlug: "bank" }),
  ];

  it("returns every client when the scope is null", () => {
    const map = tenancy.groupByCorpus(rows, null);
    expect(map.allProjectIds).toEqual(["p1", "p2", "p3"]);
  });

  it("returns only the scoped client's projects", () => {
    const map = tenancy.groupByCorpus(rows, "bank-id");
    expect(map.allProjectIds).toEqual(["p2", "p3"]);
  });

  it("does not leak another client's project into the target", () => {
    const map = tenancy.groupByCorpus(rows, "bank-id");
    const shared = map.targets.find((t) => t.key === "shared");
    expect(shared?.projectIds).toEqual(["p2", "p3"]);
    expect(shared?.projectIds).not.toContain("p1");
  });

  it("does not leak another client's label either", () => {
    const map = tenancy.groupByCorpus(rows, "bank-id");
    expect(map.labels.has("p1")).toBe(false);
    expect(map.labels.get("p2")?.clientSlug).toBe("bank");
  });

  it("yields nothing for a scope naming a client the user does not own", () => {
    const map = tenancy.groupByCorpus(rows, "someone-elses-client");
    expect(map.allProjectIds).toEqual([]);
    // The central target survives so user-level audit rows stay reachable,
    // but it carries no projects.
    expect(map.targets).toHaveLength(1);
    expect(map.targets[0]?.projectIds).toEqual([]);
  });

  it("keeps a scoped dedicated client on its own database", () => {
    const map = tenancy.groupByCorpus(
      [
        placement({ projectId: "p1", clientId: "leozenit-id" }),
        placement({
          projectId: "p2",
          clientId: "bank-id",
          isolationMode: "dedicated",
          corpusDbUrlEnv: "WB_BANK_DB",
        }),
      ],
      "bank-id",
    );
    const keys = map.targets.map((t) => t.key).sort();
    expect(keys).toEqual(["dedicated:WB_BANK_DB", "shared"]);
    expect(map.targets.find((t) => t.key === "shared")?.projectIds).toEqual([]);
    expect(map.targets.find((t) => t.key === "dedicated:WB_BANK_DB")?.projectIds).toEqual(["p2"]);
  });
});
