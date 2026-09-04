import { afterEach, beforeAll, describe, expect, it } from "vitest";

// db.ts reads DATABASE_URL at module load, so it has to exist before the
// dynamic import below. These are never connected to — neon-http builds the
// client lazily and no query is issued in this file.
const CENTRAL_URL = "postgresql://u:p@central.example.neon.tech/main?sslmode=require";
const ACME_URL = "postgresql://u:p@acme.example.neon.tech/main?sslmode=require";
const FBI_URL = "postgresql://u:p@fbi.example.neon.tech/main?sslmode=require";

type DbModule = typeof import("./db");
let mod: DbModule;

beforeAll(async () => {
  process.env.DATABASE_URL = CENTRAL_URL;
  mod = await import("./db");
});

afterEach(() => {
  process.env.WB_ACME_DB = undefined;
  process.env.WB_FBI_DB = undefined;
});

describe("corpusDbFor", () => {
  it("returns the central handle for a shared client", () => {
    const handle = mod.corpusDbFor({ isolationMode: "shared", corpusDbUrlEnv: null });
    expect(handle).toBe(mod.db);
  });

  it("ignores a stray env var name while the client is still shared", () => {
    process.env.WB_ACME_DB = ACME_URL;
    const handle = mod.corpusDbFor({ isolationMode: "shared", corpusDbUrlEnv: "WB_ACME_DB" });
    expect(handle).toBe(mod.db);
  });

  it("returns a distinct handle for a dedicated client", () => {
    process.env.WB_ACME_DB = ACME_URL;
    const handle = mod.corpusDbFor({ isolationMode: "dedicated", corpusDbUrlEnv: "WB_ACME_DB" });
    expect(handle).not.toBe(mod.db);
  });

  it("gives two dedicated clients two different handles", () => {
    process.env.WB_ACME_DB = ACME_URL;
    process.env.WB_FBI_DB = FBI_URL;
    const acme = mod.corpusDbFor({ isolationMode: "dedicated", corpusDbUrlEnv: "WB_ACME_DB" });
    const fbi = mod.corpusDbFor({ isolationMode: "dedicated", corpusDbUrlEnv: "WB_FBI_DB" });
    expect(acme).not.toBe(fbi);
    expect(acme).not.toBe(mod.db);
    expect(fbi).not.toBe(mod.db);
  });

  it("caches the handle per connection string", () => {
    process.env.WB_ACME_DB = ACME_URL;
    const first = mod.corpusDbFor({ isolationMode: "dedicated", corpusDbUrlEnv: "WB_ACME_DB" });
    const second = mod.corpusDbFor({ isolationMode: "dedicated", corpusDbUrlEnv: "WB_ACME_DB" });
    expect(first).toBe(second);
  });

  // The two cases below are the ones that matter: a misconfigured dedicated
  // client must fail loudly. Silently falling back to the shared database
  // would put one client's corpus in with everyone else's — the exact
  // outcome this whole mechanism exists to prevent.
  it("throws rather than falling back when the env var name is missing", () => {
    expect(() => mod.corpusDbFor({ isolationMode: "dedicated", corpusDbUrlEnv: null })).toThrow(
      mod.IsolationConfigError,
    );
  });

  it("throws rather than falling back when the env var is not set", () => {
    expect(() =>
      mod.corpusDbFor({ isolationMode: "dedicated", corpusDbUrlEnv: "WB_MISSING_DB" }),
    ).toThrow(mod.IsolationConfigError);
  });

  it("names the missing variable so the failure is actionable", () => {
    expect(() =>
      mod.corpusDbFor({ isolationMode: "dedicated", corpusDbUrlEnv: "WB_MISSING_DB" }),
    ).toThrow(/WB_MISSING_DB/);
  });
});

describe("isDedicated", () => {
  it("is false for shared clients", () => {
    expect(mod.isDedicated({ isolationMode: "shared", corpusDbUrlEnv: null })).toBe(false);
  });

  it("is true for dedicated clients", () => {
    expect(mod.isDedicated({ isolationMode: "dedicated", corpusDbUrlEnv: "WB_ACME_DB" })).toBe(
      true,
    );
  });
});
