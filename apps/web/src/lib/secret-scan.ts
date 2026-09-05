import { createEngine } from "@secretlint/node";

/**
 * Refuse to store credentials that arrive inside pasted content.
 *
 * A ticket, a Teams thread or an email routinely carries a connection string
 * or a deploy key that someone shared in a hurry. Everything that reaches
 * this product is persisted, chunked, embedded and made searchable — so a
 * credential pasted once is a credential kept forever, in a corpus that may
 * later be handed to the client whose engagement it belongs to.
 *
 * The scan runs before anything is written, and a hit refuses the operation
 * rather than storing with a warning. A warning would be read once and then
 * ignored, and by then the row exists.
 *
 * Detection comes from secretlint's recommended preset, which was chosen
 * after testing it against realistic content rather than on reputation. What
 * it does well, verified: real private keys (RSA and OpenSSH), connection
 * strings carrying a password, GitHub and Slack tokens, and AWS credentials
 * when the secret key is present. What it deliberately ignores, correctly:
 * documentation example keys, an AWS access key id on its own (an id is not
 * a secret), and business prose about passwords and token rotation.
 */

export interface SecretFinding {
  /** Rule that fired, e.g. "privatekey". */
  rule: string;
  line: number;
}

// Deliberately NOT carried: secretlint's own message, which quotes the
// matched text in full ("found PostgreSQL connection string:
// postgresql://admin:hunter2@…"). Passing it through would have written the
// credential into logs and into invocations.error_detail — the exact place
// this module exists to keep it out of, and labelled as a credential to
// boot. The rule name already says what kind it is, which is all a caller
// needs to act.

export class SecretsFoundError extends Error {
  readonly code = "secret_detected";
  readonly status = 422;
  readonly findings: SecretFinding[];

  constructor(findings: SecretFinding[]) {
    // The message names the KIND and the line, never the value. It travels
    // into invocations.errorDetail, and echoing the secret there would store
    // it in exactly the place this check exists to keep it out of.
    const summary = findings.map((f) => `${f.rule} (line ${f.line})`).join(", ");
    super(
      `This content looks like it contains a credential: ${summary}. ` +
        "Nothing was saved. Remove it and paste again, or pass allowSecrets to store it anyway " +
        "if you are certain it is not real.",
    );
    this.name = "SecretsFoundError";
    this.findings = findings;
  }
}

type Engine = Awaited<ReturnType<typeof createEngine>>;
let engine: Engine | null = null;

/**
 * Built once and reused. Constructing the engine loads and registers every
 * rule in the preset, which is far too slow to repeat per ingest.
 */
async function getEngine(): Promise<Engine> {
  if (engine) return engine;
  engine = await createEngine({
    color: false,
    formatter: "json",
    cwd: process.cwd(),
    configFileJSON: {
      rules: [{ id: "@secretlint/secretlint-rule-preset-recommend" }],
    },
  });
  return engine;
}

interface SecretlintMessage {
  ruleId?: string;
  loc?: { start?: { line?: number } };
}

function shortRuleName(ruleId: string): string {
  return ruleId.replace("@secretlint/secretlint-rule-", "");
}

/**
 * Scan a block of text. Returns what kind of secret was found and where —
 * never the secret itself, so a finding can be logged and shown to the user
 * without re-leaking the thing it is warning about.
 */
export async function scanForSecrets(content: string): Promise<SecretFinding[]> {
  if (content.trim().length === 0) return [];

  const result = await (await getEngine()).executeOnContent({
    content,
    // secretlint keys some rules off the file extension. Everything here is
    // markdown, and the path is never written anywhere.
    filePath: "/pasted-content.md",
  });

  let parsed: { messages?: SecretlintMessage[] }[];
  try {
    parsed = JSON.parse(result.output || "[]");
  } catch {
    // A scanner that cannot report is not a reason to drop content on the
    // floor, but it is a reason to say so rather than pretend it passed.
    throw new Error("Secret scan produced output that could not be read; nothing was saved.");
  }

  return parsed
    .flatMap((r) => r.messages ?? [])
    .map((m) => ({
      rule: shortRuleName(m.ruleId ?? "unknown"),
      line: m.loc?.start?.line ?? 0,
    }));
}

/**
 * Scan and refuse. The single call sites use, so the decision to block lives
 * in one place rather than being re-made at each of them.
 */
export async function assertNoSecrets(
  content: string,
  opts: { allowSecrets?: boolean } = {},
): Promise<SecretFinding[]> {
  const findings = await scanForSecrets(content);
  if (findings.length > 0 && !opts.allowSecrets) {
    throw new SecretsFoundError(findings);
  }
  return findings;
}
