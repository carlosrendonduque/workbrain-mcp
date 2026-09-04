import { beforeAll, describe, expect, it } from "vitest";
import type { SessionInvocation } from "./session-isolation";

// This module reaches db.ts through tenancy.ts, and db.ts throws at import
// time without a connection string. Nothing here connects; the value only
// has to exist. Same pattern as db.test.ts and tenancy.test.ts.
type Mod = typeof import("./session-isolation");
let findCrossings: Mod["findCrossings"];

beforeAll(async () => {
  process.env.DATABASE_URL = "postgresql://u:p@central.example.neon.tech/main?sslmode=require";
  ({ findCrossings } = await import("./session-isolation"));
});

const LABELS = new Map([
  ["p-leozenit", { clientId: "c-leozenit", clientSlug: "leozenit" }],
  ["p-bank", { clientId: "c-bank", clientSlug: "bank" }],
  ["p-bank-2", { clientId: "c-bank", clientSlug: "bank" }],
]);

function inv(
  sessionId: string,
  projectId: string | null,
  createdAt = "2026-09-04T10:00:00Z",
): SessionInvocation {
  return { sessionId, projectId, createdAt };
}

describe("findCrossings", () => {
  it("reports nothing for a session that stayed with one client", () => {
    expect(findCrossings([inv("s1", "p-leozenit"), inv("s1", "p-leozenit")], LABELS)).toEqual([]);
  });

  it("does not flag two projects of the SAME client", () => {
    // Two projects under one client is normal work, not a crossing.
    expect(findCrossings([inv("s1", "p-bank"), inv("s1", "p-bank-2")], LABELS)).toEqual([]);
  });

  it("flags one session that touched two clients", () => {
    const out = findCrossings([inv("s1", "p-leozenit"), inv("s1", "p-bank")], LABELS);
    expect(out).toHaveLength(1);
    expect(out[0]?.sessionId).toBe("s1");
    expect(out[0]?.clients.map((c) => c.clientSlug)).toEqual(["bank", "leozenit"]);
    expect(out[0]?.invocations).toBe(2);
  });

  it("keeps separate sessions separate", () => {
    const out = findCrossings([inv("s1", "p-leozenit"), inv("s2", "p-bank")], LABELS);
    expect(out).toEqual([]);
  });

  it("records when the crossing started and last happened", () => {
    const out = findCrossings(
      [
        inv("s1", "p-leozenit", "2026-09-04T10:00:00Z"),
        inv("s1", "p-bank", "2026-09-04T12:30:00Z"),
        inv("s1", "p-leozenit", "2026-09-04T09:00:00Z"),
      ],
      LABELS,
    );
    expect(out[0]?.firstSeen.toISOString()).toBe("2026-09-04T09:00:00.000Z");
    expect(out[0]?.lastSeen.toISOString()).toBe("2026-09-04T12:30:00.000Z");
    expect(out[0]?.invocations).toBe(3);
  });

  it("puts the most recent crossing first", () => {
    const out = findCrossings(
      [
        inv("old", "p-leozenit", "2026-01-01T00:00:00Z"),
        inv("old", "p-bank", "2026-01-01T00:05:00Z"),
        inv("new", "p-leozenit", "2026-09-01T00:00:00Z"),
        inv("new", "p-bank", "2026-09-01T00:05:00Z"),
      ],
      LABELS,
    );
    expect(out.map((c) => c.sessionId)).toEqual(["new", "old"]);
  });

  // A project the caller cannot resolve is missing context, not proof of a
  // crossing. Counting it as a second client would raise false alarms and
  // train the reader to ignore the report.
  it("ignores rows with no project", () => {
    expect(findCrossings([inv("s1", "p-leozenit"), inv("s1", null)], LABELS)).toEqual([]);
  });

  it("ignores rows whose project is not in the map", () => {
    expect(findCrossings([inv("s1", "p-leozenit"), inv("s1", "p-unknown")], LABELS)).toEqual([]);
  });

  it("handles no rows at all", () => {
    expect(findCrossings([], LABELS)).toEqual([]);
  });

  it("reports every client a session touched, not just two", () => {
    const labels = new Map([...LABELS, ["p-gov", { clientId: "c-gov", clientSlug: "gov" }]]);
    const out = findCrossings(
      [inv("s1", "p-leozenit"), inv("s1", "p-bank"), inv("s1", "p-gov")],
      labels,
    );
    expect(out[0]?.clients.map((c) => c.clientSlug)).toEqual(["bank", "gov", "leozenit"]);
  });
});
