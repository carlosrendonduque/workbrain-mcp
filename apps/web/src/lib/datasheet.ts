import { schema } from "@workbrain/shared";
import { and, eq, isNull, or } from "drizzle-orm";
import { type WorkbrainDb, corpusDbFor, db } from "./db";
import { describeRouting } from "./providers";
import { CORPUS_TABLES, type CorpusCounts, countCorpus } from "./provisioning";
import { checkSessionIsolation } from "./session-isolation";

/**
 * The document a client's security team actually asks for.
 *
 * Nobody buys an architecture — they cannot audit it and they will not read
 * it. What they need is a page they can hand to someone else, and what makes
 * that page worth anything is that it is generated from the live system
 * rather than written by hand and left to rot.
 *
 * Everything below is read out of the running system at the moment of asking.
 * Nothing is asserted that the code cannot show.
 */

export interface Datasheet {
  clientSlug: string;
  clientName: string;
  generatedAt: Date;
  markdown: string;
}

interface KeyReach {
  label: string;
  scoped: boolean;
  lastUsedAt: Date | null;
}

function line(label: string, value: string): string {
  return `| ${label} | ${value} |`;
}

function countsTable(counts: CorpusCounts): string {
  return CORPUS_TABLES.filter((t) => counts[t] > 0)
    .map((t) => `| ${t.replace(/_/g, " ")} | ${counts[t]} |`)
    .join("\n");
}

function hostOf(url: string | undefined): string {
  if (!url) return "(not reachable from here)";
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable)";
  }
}

/**
 * Build the sheet for one client.
 *
 * Deliberately says "could not be verified" rather than staying silent when
 * something cannot be checked from where this runs — a gap presented as a
 * pass is worse than no document at all.
 */
export async function buildDatasheet(userId: string, clientSlug: string): Promise<Datasheet> {
  const clients = await db
    .select()
    .from(schema.clients)
    .where(and(eq(schema.clients.userId, userId), eq(schema.clients.slug, clientSlug)))
    .limit(1);
  const client = clients[0];
  if (!client) throw new Error(`No client with slug "${clientSlug}" for this user`);

  const projects = await db
    .select({ id: schema.projects.id, slug: schema.projects.slug, name: schema.projects.name })
    .from(schema.projects)
    .where(eq(schema.projects.clientId, client.id));
  const projectIds = projects.map((p) => p.id);

  const dedicated = client.isolationMode === "dedicated";
  const dedicatedUrl = client.corpusDbUrlEnv ? process.env[client.corpusDbUrlEnv] : undefined;

  let corpusDb: WorkbrainDb | null = null;
  let reachError: string | null = null;
  try {
    corpusDb = corpusDbFor(client);
  } catch (err) {
    reachError = err instanceof Error ? err.message : String(err);
  }

  const counts = corpusDb ? await countCorpus(corpusDb, projectIds) : null;

  // For a dedicated client, anything left in the central database is the
  // client's data sitting exactly where they were told it would not be. It
  // belongs on the sheet, not in a log nobody reads.
  const strayInShared = dedicated ? await countCorpus(db, projectIds) : null;
  const strayTables = strayInShared ? CORPUS_TABLES.filter((t) => strayInShared[t] > 0) : [];

  // Which keys can reach this client: those pinned to it, plus any key that
  // was never scoped and therefore reaches everything.
  const keyRows = await db
    .select({
      label: schema.apiKeys.label,
      clientId: schema.apiKeys.clientId,
      lastUsedAt: schema.apiKeys.lastUsedAt,
    })
    .from(schema.apiKeys)
    .where(
      and(
        eq(schema.apiKeys.userId, userId),
        or(eq(schema.apiKeys.clientId, client.id), isNull(schema.apiKeys.clientId)),
      ),
    );
  const keys: KeyReach[] = keyRows.map((k) => ({
    label: k.label,
    scoped: k.clientId !== null,
    lastUsedAt: k.lastUsedAt,
  }));

  const isolation = await checkSessionIsolation(userId, null);
  const crossingsHere = isolation.crossings.filter((c) =>
    c.clients.some((x) => x.clientId === client.id),
  );

  const routing = describeRouting({ ...client, clientSlug: client.slug });
  const generatedAt = new Date();
  const stamp = generatedAt.toISOString().replace("T", " ").slice(0, 16);

  const md = `# Data sheet — ${client.name}

Generated ${stamp} UTC from the running system. Every figure below was read
at that moment; nothing here is written by hand.

## Where this client's data is stored

| | |
|---|---|
${line("Arrangement", dedicated ? "**A database of its own**" : "Shared database, separated within it")}
${line("Host", dedicated ? hostOf(dedicatedUrl) : hostOf(process.env.DATABASE_URL))}
${line("Other clients in that database", dedicated ? "**None**" : "Yes — separation is enforced by the application, per project")}
${line("Projects", projects.map((p) => `\`${p.slug}\``).join(", ") || "(none)")}

## Which accounts process this client's text

| | |
|---|---|
${line("Language model", routing.llm)}
${line("Embeddings", routing.embeddings)}

${
  routing.llm.includes("client's own")
    ? "The text is processed inside this client's own cloud account, under their\nexisting agreement with that provider. It does not reach Anthropic."
    : "The text is processed through our provider accounts. Ask if you need it\nrouted through your own cloud account instead — it is a configuration\nchange, not a rebuild."
}

## What is held

${
  counts
    ? CORPUS_TABLES.some((t) => counts[t] > 0)
      ? `| | |\n|---|---|\n${countsTable(counts)}`
      : "Nothing yet — no documents have been stored for this client."
    : `**Could not be read.** ${reachError ?? "unknown reason"}`
}

## Retention

${
  client.retentionDays === null
    ? "Held indefinitely. No automatic deletion is configured."
    : `Held for ${client.retentionDays} days.`
}

## Who can reach it

${
  keys.length === 0
    ? "No API key currently reaches this client."
    : `| Key | Reach | Last used |\n|---|---|---|\n${keys
        .map(
          (k) =>
            `| ${k.label} | ${k.scoped ? "This client only" : "**Every client**"} | ${
              k.lastUsedAt ? k.lastUsedAt.toISOString().slice(0, 10) : "never"
            } |`,
        )
        .join("\n")}`
}

${
  keys.some((k) => !k.scoped)
    ? "One or more keys are not limited to this client. Limiting a key reduces\nwhat is exposed if the machine holding it is lost."
    : "Every key that reaches this client is limited to it."
}

## Evidence of separation

| Check | Result |
|---|---|
| A work session that touched this client and another | ${
    crossingsHere.length === 0
      ? `**None**, across ${isolation.sessionsChecked} session(s) and ${isolation.invocationsChecked} operation(s)`
      : `**${crossingsHere.length} found** — see below`
  } |
${
  dedicated
    ? `| Rows left in the shared database | ${
        strayTables.length === 0
          ? "**None**"
          : `**${strayTables.map((t) => `${t}=${strayInShared?.[t]}`).join(", ")}** — should be purged`
      } |`
    : ""
}

${
  crossingsHere.length > 0
    ? `### Sessions that spanned two clients\n\n${crossingsHere
        .map(
          (c) =>
            `- \`${c.sessionId}\` — ${c.clients.map((x) => x.clientSlug).join(" + ")}, ${c.firstSeen
              .toISOString()
              .slice(0, 16)
              .replace("T", " ")} to ${c.lastSeen.toISOString().slice(0, 16).replace("T", " ")}`,
        )
        .join("\n")}\n\nEach of these is one chat that held two clients' material in context.`
    : ""
}

## How this ends

When the engagement closes, this client's corpus is destroyed and a
certificate is issued stating what was removed and when.

\`\`\`
pnpm --filter @workbrain/web db:destroy ${client.slug}
\`\`\`

${
  dedicated
    ? "Because this client has a database of its own, destruction also means the\ndatabase itself can be dropped, leaving nothing behind."
    : "This client shares a database, so destruction removes its rows. Moving it\nto a database of its own first makes the removal absolute."
}
`;

  return {
    clientSlug: client.slug,
    clientName: client.name,
    generatedAt,
    markdown: md.replace(/\n{3,}/g, "\n\n"),
  };
}
