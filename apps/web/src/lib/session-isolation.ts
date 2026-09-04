import { schema } from "@workbrain/shared";
import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { type ClientScope, type UserCorpusMap, corpusMapForUser, fanOutCorpus } from "./tenancy";

/**
 * Detecting a chat session that touched two clients.
 *
 * The databases can be perfectly separated and the mixing still happen one
 * level up, in the agent's context window: a session loads client A's canon,
 * the user switches directory, and the agent carries on for client B with A's
 * material still in the window. WorkBrain does not control that window.
 *
 * What it does control is the record. Every invocation already carries the
 * MCP session id, so a session that spans two clients is detectable — which
 * turns "your data is separated" from a promise into something with evidence
 * behind it, and gives a real answer to "has it ever leaked?".
 *
 * This finds crossings; it does not prevent them. Prevention would mean
 * refusing an operation when the session has already touched another client,
 * which is a policy decision, not a detection one.
 */

export interface SessionInvocation {
  sessionId: string;
  projectId: string | null;
  createdAt: Date | string;
}

export interface ClientRef {
  clientId: string;
  clientSlug: string;
}

export interface CrossClientSession {
  sessionId: string;
  clients: ClientRef[];
  invocations: number;
  firstSeen: Date;
  lastSeen: Date;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Group invocations by session and return the ones that span more than one
 * client. Pure, so the rule is testable without a database.
 *
 * Rows whose project is unknown to the caller's map are ignored rather than
 * counted as a separate client — an unresolvable project is missing context,
 * not evidence of a crossing, and reporting it as one would cry wolf.
 */
export function findCrossings(
  rows: SessionInvocation[],
  labels: Map<string, { clientId: string; clientSlug: string }>,
): CrossClientSession[] {
  interface Acc {
    clients: Map<string, string>;
    invocations: number;
    first: Date;
    last: Date;
  }
  const bySession = new Map<string, Acc>();

  for (const row of rows) {
    if (!row.projectId) continue;
    const label = labels.get(row.projectId);
    if (!label) continue;

    const at = toDate(row.createdAt);
    const acc = bySession.get(row.sessionId);
    if (!acc) {
      bySession.set(row.sessionId, {
        clients: new Map([[label.clientId, label.clientSlug]]),
        invocations: 1,
        first: at,
        last: at,
      });
      continue;
    }
    acc.clients.set(label.clientId, label.clientSlug);
    acc.invocations += 1;
    if (at < acc.first) acc.first = at;
    if (at > acc.last) acc.last = at;
  }

  const crossings: CrossClientSession[] = [];
  for (const [sessionId, acc] of bySession) {
    if (acc.clients.size < 2) continue;
    crossings.push({
      sessionId,
      clients: [...acc.clients.entries()]
        .map(([clientId, clientSlug]) => ({ clientId, clientSlug }))
        .sort((a, b) => a.clientSlug.localeCompare(b.clientSlug)),
      invocations: acc.invocations,
      firstSeen: acc.first,
      lastSeen: acc.last,
    });
  }
  // Most recent first — a crossing from this morning matters more than one
  // from six months ago.
  return crossings.sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());
}

export interface SessionIsolationReport {
  sessionsChecked: number;
  invocationsChecked: number;
  crossings: CrossClientSession[];
  since: Date | null;
}

/**
 * Read every session-tagged invocation the caller can see and report any
 * session that touched more than one client.
 *
 * Fans out across databases: with a client on dedicated storage, the two
 * halves of a crossing live in two different databases, which is precisely
 * the case a single-database query would miss.
 */
export async function checkSessionIsolation(
  userId: string,
  scope: ClientScope,
  opts: { since?: Date } = {},
): Promise<SessionIsolationReport> {
  const map: UserCorpusMap = await corpusMapForUser(userId, scope);

  const rows = await fanOutCorpus(map, async (target) => {
    if (target.projectIds.length === 0) return [];
    const filters = [
      eq(schema.invocations.userId, userId),
      isNotNull(schema.invocations.sessionId),
      inArray(schema.invocations.projectId, target.projectIds),
    ];
    if (opts.since) filters.push(gte(schema.invocations.createdAt, opts.since));

    return await target.db
      .select({
        sessionId: schema.invocations.sessionId,
        projectId: schema.invocations.projectId,
        createdAt: schema.invocations.createdAt,
      })
      .from(schema.invocations)
      .where(and(...filters));
  });

  const usable: SessionInvocation[] = rows
    .filter((r): r is typeof r & { sessionId: string } => r.sessionId !== null)
    .map((r) => ({ sessionId: r.sessionId, projectId: r.projectId, createdAt: r.createdAt }));

  const sessions = new Set(usable.map((r) => r.sessionId));

  return {
    sessionsChecked: sessions.size,
    invocationsChecked: usable.length,
    crossings: findCrossings(usable, map.labels),
    since: opts.since ?? null,
  };
}
