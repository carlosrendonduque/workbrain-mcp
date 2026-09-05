import { beforeAll, describe, expect, it } from "vitest";
import { emptyCounts } from "./provisioning";

type Mod = typeof import("./destruction");
let mod: Mod;

beforeAll(async () => {
  process.env.DATABASE_URL = "postgresql://u:p@central.example.neon.tech/main?sslmode=require";
  mod = await import("./destruction");
});

const IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];

describe("digestDocumentIds", () => {
  it("is stable for the same set", () => {
    expect(mod.digestDocumentIds(IDS)).toBe(mod.digestDocumentIds(IDS));
  });

  // Rows come back in whatever order the database feels like. A digest that
  // depended on that would differ between two runs over identical data and
  // would be worthless as a commitment.
  it("does not depend on the order the ids arrived in", () => {
    expect(mod.digestDocumentIds(IDS)).toBe(mod.digestDocumentIds([...IDS].reverse()));
  });

  it("changes when a single document is added", () => {
    const more = [...IDS, "44444444-4444-4444-8444-444444444444"];
    expect(mod.digestDocumentIds(more)).not.toBe(mod.digestDocumentIds(IDS));
  });

  it("changes when a single document is removed", () => {
    expect(mod.digestDocumentIds(IDS.slice(1))).not.toBe(mod.digestDocumentIds(IDS));
  });

  it("has a value for an empty corpus", () => {
    // Destroying nothing is still a fact worth certifying — the certificate
    // says the corpus was empty, and the digest of the empty set backs it.
    expect(mod.digestDocumentIds([])).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces a sha256 hex digest", () => {
    expect(mod.digestDocumentIds(IDS)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not leak an id into the digest", () => {
    // Obvious, but the whole value of the commitment is that it discloses
    // nothing about what it commits to.
    const digest = mod.digestDocumentIds(IDS);
    for (const id of IDS) expect(digest).not.toContain(id);
  });
});

function certificate(over: Partial<Parameters<Mod["renderCertificate"]>[0]> = {}) {
  return {
    clientSlug: "testbank",
    clientName: "Test Bank",
    projectSlugs: ["vault", "ledger"],
    removed: { ...emptyCounts(), documents: 3, chunks: 6, invocations: 4 },
    documentsDigest: "a".repeat(64),
    storage: "dedicated database db.example.neon.tech",
    issuedAt: new Date("2026-09-05T05:27:56Z"),
    ...over,
  };
}

describe("renderCertificate", () => {
  it("names the client, the projects and where the data was held", () => {
    const md = mod.renderCertificate(certificate());
    expect(md).toContain("Test Bank");
    expect(md).toContain("`vault`");
    expect(md).toContain("db.example.neon.tech");
  });

  it("states the time it was issued", () => {
    expect(mod.renderCertificate(certificate())).toContain("2026-09-05 05:27:56 UTC");
  });

  it("carries the digest", () => {
    expect(mod.renderCertificate(certificate())).toContain("a".repeat(64));
  });

  // A row list without a header renders as literal pipes, not a table. This
  // shipped broken once and was caught by reading the real output.
  it("renders the removed counts as an actual markdown table", () => {
    const md = mod.renderCertificate(certificate());
    expect(md).toContain("| What | Rows |");
    expect(md).toContain("|---|---|");
    expect(md).toContain("| documents | 3 |");
  });

  it("omits tables that have no rows", () => {
    const md = mod.renderCertificate(certificate());
    expect(md).not.toContain("stakeholders");
    expect(md).not.toContain("draft documents");
  });

  it("says so plainly when there was nothing to remove", () => {
    const md = mod.renderCertificate(certificate({ removed: emptyCounts() }));
    expect(md).toMatch(/already empty/);
  });

  // The two arrangements end differently, and saying the wrong one would be
  // a false statement on a document handed to a client.
  it("tells a dedicated client the database itself can now be deleted", () => {
    const md = mod.renderCertificate(certificate());
    expect(md).toMatch(/deleted outright/);
  });

  it("tells a shared client the database remains in use by others", () => {
    const md = mod.renderCertificate(certificate({ storage: "shared database" }));
    expect(md).toMatch(/remains in use by other engagements/);
    expect(md).not.toMatch(/deleted outright/);
  });

  it("is explicit about what was kept", () => {
    // A certificate that only lists deletions invites the question it does
    // not answer.
    expect(mod.renderCertificate(certificate())).toContain("What was not removed");
  });
});
