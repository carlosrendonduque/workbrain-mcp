// 5-stage ticket progress: optional artifact slots stored as a jsonb column
// on documents. Only meaningful when type='ticket'. Emptiness of each slot
// signals "not done yet"; the active phase is the next empty stage.

import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "./db";

export const TICKET_STAGES = ["analysis", "design", "build", "tests", "deployment"] as const;
export type TicketStage = (typeof TICKET_STAGES)[number];

export interface TicketProgress {
  analysis: string | null;
  design: string | null;
  build: string | null;
  tests: string | null;
  deployment: string | null;
}

const EMPTY_PROGRESS: TicketProgress = {
  analysis: null,
  design: null,
  build: null,
  tests: null,
  deployment: null,
};

export class TicketProgressError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "TicketProgressError";
    this.code = code;
    this.status = status;
  }
}

function normalizeProgress(raw: unknown): TicketProgress {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ...EMPTY_PROGRESS };
  }
  const obj = raw as Record<string, unknown>;
  const out: TicketProgress = { ...EMPTY_PROGRESS };
  for (const stage of TICKET_STAGES) {
    const v = obj[stage];
    if (typeof v === "string" && v.trim().length > 0) {
      out[stage] = v;
    }
  }
  return out;
}

interface OwnedTicket {
  documentId: string;
  externalId: string | null;
  title: string;
  type: string;
  progress: TicketProgress;
}

async function resolveOwnedTicket(
  userId: string,
  projectSlug: string,
  externalId: string,
): Promise<OwnedTicket> {
  const rows = await db
    .select({
      documentId: schema.documents.id,
      externalId: schema.documents.externalId,
      title: schema.documents.title,
      type: schema.documents.type,
      progress: schema.documents.progress,
    })
    .from(schema.documents)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.documents.projectId))
    .innerJoin(schema.clients, eq(schema.clients.id, schema.projects.clientId))
    .where(
      and(
        eq(schema.clients.userId, userId),
        eq(schema.projects.slug, projectSlug),
        eq(schema.documents.externalId, externalId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new TicketProgressError(
      "ticket_not_found",
      `Ticket ${externalId} not found in project ${projectSlug}.`,
      404,
    );
  }
  return {
    documentId: row.documentId,
    externalId: row.externalId,
    title: row.title,
    type: row.type,
    progress: normalizeProgress(row.progress),
  };
}

export interface SetTicketProgressInput {
  projectSlug: string;
  externalId: string;
  stage: TicketStage;
  content: string | null;
}

export interface SetTicketProgressResult {
  externalId: string;
  title: string;
  stage: TicketStage;
  progress: TicketProgress;
  currentPhase: TicketStage | "done";
}

export async function setTicketProgress(
  userId: string,
  input: SetTicketProgressInput,
): Promise<SetTicketProgressResult> {
  const ticket = await resolveOwnedTicket(userId, input.projectSlug, input.externalId);
  if (ticket.type !== "ticket") {
    throw new TicketProgressError(
      "not_a_ticket",
      `Document ${input.externalId} is type '${ticket.type}', not 'ticket'.`,
      400,
    );
  }

  const next: TicketProgress = { ...ticket.progress };
  const trimmed = input.content?.trim();
  next[input.stage] = trimmed && trimmed.length > 0 ? trimmed : null;

  await db
    .update(schema.documents)
    .set({ progress: next, updatedAt: sql`now()` })
    .where(eq(schema.documents.id, ticket.documentId));

  return {
    externalId: input.externalId,
    title: ticket.title,
    stage: input.stage,
    progress: next,
    currentPhase: nextEmptyStage(next),
  };
}

export interface GetTicketProgressResult {
  externalId: string;
  title: string;
  progress: TicketProgress;
  currentPhase: TicketStage | "done";
  pattern: string;
}

export async function getTicketProgress(
  userId: string,
  projectSlug: string,
  externalId: string,
): Promise<GetTicketProgressResult> {
  const ticket = await resolveOwnedTicket(userId, projectSlug, externalId);
  return {
    externalId,
    title: ticket.title,
    progress: ticket.progress,
    currentPhase: nextEmptyStage(ticket.progress),
    pattern: progressPattern(ticket.progress),
  };
}

// "A·D·B·_·_" — uppercase initial when stage has content, underscore when
// empty. Useful for compact rendering in lists or status lines.
export function progressPattern(p: TicketProgress): string {
  return TICKET_STAGES.map((s) => (p[s] ? s.charAt(0).toUpperCase() : "_")).join("·");
}

export function nextEmptyStage(p: TicketProgress): TicketStage | "done" {
  // Analysis is opt-in, never the active phase target. The current phase
  // is always the first empty mandatory stage (design → build → tests →
  // deployment).
  const mandatory: TicketStage[] = ["design", "build", "tests", "deployment"];
  for (const s of mandatory) {
    if (!p[s]) return s;
  }
  return "done";
}
