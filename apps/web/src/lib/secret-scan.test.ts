import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { SecretsFoundError, assertNoSecrets, scanForSecrets } from "./secret-scan";

/**
 * These run the real scanner — no mock. Mocking it would test the mock, and
 * the question that matters is empirical: does it catch what actually turns
 * up in a pasted ticket, and does it stay quiet on ordinary business prose?
 *
 * Every fixture below was chosen because it caught out an assumption while
 * this was being written.
 */

// A truncated private key does NOT trip the scanner, and a real one does.
// Generated here rather than pasted so the repo never contains a key-shaped
// blob that a future scan flags on itself.
let realPrivateKey = "";

/**
 * AWS credentials built at run time rather than written into the file.
 *
 * Not squeamishness: the first version of this test embedded a realistic
 * AKIA… literal, and GitHub push protection rejected the commit. It was
 * right to — a secret-shaped string in a repo is a secret-shaped string,
 * regardless of intent, and the fix is never to add it to an allowlist.
 *
 * Deterministic so the test cannot flake, and derived rather than literal so
 * no scanner has anything to find in the source.
 */
function awsCredentials(): { id: string; secret: string } {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const mixed = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const derive = (set: string, n: number, step: number) =>
    Array.from({ length: n }, (_, i) => set[(i * step + 7) % set.length]).join("");
  return { id: `AKIA${derive(upper, 16, 5)}`, secret: derive(mixed, 40, 11) };
}

beforeAll(() => {
  realPrivateKey = execFileSync("openssl", ["genrsa", "2048"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}, 30_000);

const NORMAL_TICKET = `# ACME-1042 — Booking flow fails on retry

Status: In Progress. Assignee: Maya.

The retry handler double-books when the gateway times out. We discussed the
password policy and API key rotation schedule in Confluence, and Maya will
review the token expiry settings before the next release.

Decision: idempotency key per booking attempt. Related: ACME-1010.`;

describe("scanForSecrets — what it must catch", () => {
  it("finds a real private key", async () => {
    const found = await scanForSecrets(realPrivateKey);
    expect(found.length).toBeGreaterThan(0);
    expect(found.map((f) => f.rule)).toContain("privatekey");
  });

  it("finds a private key buried inside an otherwise normal ticket", async () => {
    // The realistic shape: someone pastes a whole Teams thread that happens
    // to contain a deploy key halfway down.
    const found = await scanForSecrets(
      `# ACME-1050 — Deploy key rotation\n\nMaya sent the old one:\n\n${realPrivateKey}\n\nUse the new one from 1Password.`,
    );
    expect(found.map((f) => f.rule)).toContain("privatekey");
  });

  it("finds a connection string carrying a password", async () => {
    const found = await scanForSecrets(
      "Run against: postgresql://admin:S3cr3tPassw0rd@db.acme.com:5432/prod",
    );
    expect(found.length).toBeGreaterThan(0);
  });

  it("finds a GitHub token", async () => {
    const found = await scanForSecrets("token: ghp_16C7e42F292c6912E7710c838347Ae178B4a");
    expect(found.length).toBeGreaterThan(0);
  });

  it("finds AWS credentials when the secret key is present", async () => {
    const aws = awsCredentials();
    const found = await scanForSecrets(
      `AWS_ACCESS_KEY_ID=${aws.id}\nAWS_SECRET_ACCESS_KEY=${aws.secret}`,
    );
    expect(found.length).toBeGreaterThan(0);
  });
});

describe("scanForSecrets — what it must NOT flag", () => {
  // Crying wolf is not a harmless failure mode: an ingest that blocks on
  // ordinary tickets gets bypassed with allowSecrets and then protects
  // nothing.
  it("stays quiet on a normal ticket that talks about passwords and tokens", async () => {
    expect(await scanForSecrets(NORMAL_TICKET)).toEqual([]);
  });

  it("stays quiet on an AWS access key id alone", async () => {
    // An access key id is not a secret — it is the username half. Flagging
    // it would fire on half the infrastructure tickets ever written.
    expect(await scanForSecrets(`AWS_ACCESS_KEY_ID=${awsCredentials().id}`)).toEqual([]);
  });

  it("stays quiet on empty content", async () => {
    expect(await scanForSecrets("")).toEqual([]);
    expect(await scanForSecrets("   \n  ")).toEqual([]);
  });
});

describe("findings never carry the secret itself", () => {
  // The message travels into invocations.error_detail. Echoing the value
  // there would store it in the exact place this check exists to keep it out
  // of, and it would be stored WITH a label saying what it is.
  // This one failed when first written: secretlint's own message quotes the
  // matched text in full, and it was being passed straight through into a
  // field bound for the audit trail. The finding now carries the rule and
  // the line only.
  it("reports the kind and the line, not the value", async () => {
    const found = await scanForSecrets("postgresql://admin:S3cr3tPassw0rd@db.acme.com:5432/prod");
    const blob = JSON.stringify(found);
    expect(blob).not.toContain("S3cr3tPassw0rd");
    expect(found[0]?.line).toBeGreaterThan(0);
  });

  it("keeps the thrown error free of the secret too", async () => {
    try {
      await assertNoSecrets("postgresql://admin:S3cr3tPassw0rd@db.acme.com:5432/prod");
      throw new Error("should have refused");
    } catch (err) {
      expect(err).toBeInstanceOf(SecretsFoundError);
      expect((err as Error).message).not.toContain("S3cr3tPassw0rd");
      expect((err as Error).message).toMatch(/line \d+/);
    }
  });
});

describe("assertNoSecrets", () => {
  it("passes clean content through", async () => {
    await expect(assertNoSecrets(NORMAL_TICKET)).resolves.toEqual([]);
  });

  it("refuses content with a credential", async () => {
    await expect(assertNoSecrets(realPrivateKey)).rejects.toBeInstanceOf(SecretsFoundError);
  });

  it("carries the findings on the error so a caller can show them", async () => {
    await expect(assertNoSecrets(realPrivateKey)).rejects.toSatisfy(
      (err: SecretsFoundError) => err.findings.length > 0 && err.code === "secret_detected",
    );
  });

  it("stores anyway when the caller explicitly allows it", async () => {
    const found = await assertNoSecrets(realPrivateKey, { allowSecrets: true });
    // The override does not hide the finding — it just stops it blocking.
    expect(found.length).toBeGreaterThan(0);
  });
});
