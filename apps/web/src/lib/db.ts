import { neon } from "@neondatabase/serverless";
import { type NeonHttpDatabase, drizzle } from "drizzle-orm/neon-http";
import { schema } from "@workbrain/shared";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set");
}

const sql = neon(url);

/**
 * The central database. Holds everything that is NOT one client's content:
 * users, api keys, signup tokens, canon domains, and the registry of clients
 * and projects — including where each client's corpus lives.
 *
 * Never read or write corpus tables (documents, chunks, document_links,
 * stakeholders, draft_documents, invocations) through this handle. Those
 * belong to a client and must go through `corpusDbFor`, or a client on a
 * dedicated database silently reads and writes the wrong place.
 */
export const db = drizzle(sql, { schema });
export { schema };

export type WorkbrainDb = NeonHttpDatabase<typeof schema>;

/**
 * The subset of a client row that decides where its corpus lives. Callers
 * select these alongside the rest of the client so resolving a connection
 * costs no extra query.
 */
export interface ClientIsolation {
  isolationMode: string;
  corpusDbUrlEnv: string | null;
}

// Dedicated connections are cached by connection string. neon-http is
// stateless (one HTTPS request per query, no pool to keep warm), so this
// only avoids rebuilding the drizzle wrapper — it holds no sockets and is
// safe across serverless invocations.
const dedicatedDbs = new Map<string, WorkbrainDb>();

export class IsolationConfigError extends Error {
  readonly code = "isolation_config_error";
  constructor(message: string) {
    super(message);
    this.name = "IsolationConfigError";
  }
}

/**
 * Resolve the database holding one client's corpus.
 *
 * `shared` returns the central handle — identical behaviour to before this
 * existed, which is why turning the resolver on changes nothing until a
 * client is actually moved to `dedicated`.
 *
 * `dedicated` reads the connection string from the environment variable the
 * client row names. The secret itself is never stored in the database.
 */
export function corpusDbFor(client: ClientIsolation): WorkbrainDb {
  if (client.isolationMode !== "dedicated") return db;

  const envName = client.corpusDbUrlEnv;
  if (!envName) {
    throw new IsolationConfigError(
      "Client is marked 'dedicated' but has no corpus_db_url_env set. Refusing to fall back to the shared database.",
    );
  }

  const dedicatedUrl = process.env[envName];
  if (!dedicatedUrl) {
    throw new IsolationConfigError(
      `Client is marked 'dedicated' but ${envName} is not set in this environment. Refusing to fall back to the shared database.`,
    );
  }

  const cached = dedicatedDbs.get(dedicatedUrl);
  if (cached) return cached;

  const handle = drizzle(neon(dedicatedUrl), { schema });
  dedicatedDbs.set(dedicatedUrl, handle);
  return handle;
}

/**
 * True when this client's corpus lives somewhere other than the central
 * database. Used to decide whether a cross-client query can stay a single
 * SQL statement or has to fan out.
 */
export function isDedicated(client: ClientIsolation): boolean {
  return client.isolationMode === "dedicated";
}
