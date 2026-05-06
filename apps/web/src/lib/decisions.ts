import { z } from "zod";
import { type IngestPasteResult, ingestPaste } from "./paste";

export const RecordDecisionInputSchema = z.object({
  projectSlug: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  linksTo: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string()).optional(),
});

export type RecordDecisionInput = z.infer<typeof RecordDecisionInputSchema>;

// recordDecision is intentionally a thin wrapper over ingestPaste with
// type="decision" pre-set. UX-wise it gives the IDE agent a tool whose
// name communicates the intent ("I am closing a ticket / making an ADR")
// instead of the generic ingest_paste shape. Mechanically the chunking,
// embedding, persistence, audit row, corpus push, and auto-linking from
// linksTo all come for free from the existing pipeline.
export async function recordDecision(
  userId: string,
  input: RecordDecisionInput,
): Promise<IngestPasteResult> {
  return ingestPaste(userId, {
    projectSlug: input.projectSlug,
    type: "decision",
    title: input.title,
    content: input.body,
    relatedTickets: input.linksTo,
    tags: input.tags,
  });
}
