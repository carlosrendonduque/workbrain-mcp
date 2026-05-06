import { config } from "dotenv";
import { type DocumentType, classify } from "../src/lib/classifier";

config({ path: ".env.local" });

interface Sample {
  label: string;
  expected: DocumentType;
  text: string;
}

const SAMPLES: Sample[] = [
  {
    label: "jira ticket",
    expected: "ticket",
    text: `[TICKET-4521] Login button does not redirect to dashboard

Reporter: Jane Smith
Assignee: Carlos R.
Status: In Progress
Priority: High
Created: 2026-04-22

Description:
After clicking "Sign in" the page reloads instead of routing to /dashboard.
Affects only Safari. Linked to TICKET-4488 (cookies regression) and TICKET-4490.

Comments:
- Carlos (2 days ago): Reproduced on Safari 17.4. Looks like a SameSite issue.
- Jane (1 day ago): Same on iPad. Marking as P1.`,
  },
  {
    label: "confluence page",
    expected: "confluence",
    text: `# Order Service - Architecture Overview

Last updated: 2026-03-12 by Architecture Guild

## Context
The Order Service owns the lifecycle of customer orders end to end. It exposes
REST endpoints under /api/orders and emits events on the orders.* topic.

## Components
- API gateway (Spring Boot)
- Persistence layer (Postgres + Hibernate)
- Event publisher (Kafka)
- Pricing client (gRPC to Pricing Service)

## SLOs
- Availability: 99.9%
- p95 latency: under 250ms
- Error budget: 0.1% per 30-day window

## See also
- Pricing Service architecture
- Inventory Service ADR 0017`,
  },
  {
    label: "teams thread",
    expected: "teams_thread",
    text: `Carlos R. - 9:14 AM
hey team, the QA env is throwing 502 on /api/orders. anyone else seeing it?

Maria L. - 9:16 AM
yep, same here. started ~10min ago

Tom W. - 9:18 AM
checking the gateway logs

Tom W. - 9:24 AM
found it - the order-service pod is in CrashLoopBackOff after a failed migration.
filed TICKET-7012 to track the rollback.

Carlos R. - 9:26 AM
thanks tom. rolling back now.

Tom W. - 9:31 AM
QA back up. closing the thread.`,
  },
  {
    label: "outlook email",
    expected: "email",
    text: `From: Jane Smith <jane.smith@acme.com>
To: Carlos Rendon <carlos@workbrain.app>
Cc: Tom White <tom@acme.com>
Subject: RE: Pricing Service migration window
Date: Mon, 5 May 2026 10:32:18 +1000

Hi Carlos,

Confirming the maintenance window: Friday 9 May 2026, 22:00 - 23:00 AEST.
We'll need a freeze on /api/pricing during that hour. Please coordinate
with the order team.

Re your earlier question about TICKET-7012: yes, we're tracking the rollback
under that ticket. Tom has the full context.

Thanks,
Jane`,
  },
  {
    label: "ADR / decision",
    expected: "decision",
    text: `# ADR 0042: Use pgvector for the WorkBrain corpus

Status: Accepted
Date: 2026-05-01
Authors: Carlos R.

## Context
We need to store embeddings for the per-project document corpus and query by
cosine similarity. The corpus is small per project (low thousands of chunks).

## Decision
We will use pgvector inside the same Postgres (Neon) instance, with an HNSW
index and the vector_cosine_ops opclass. No separate vector store.

## Consequences
+ One database to operate, one transactional surface, simpler ops.
+ Acceptable performance for the projected corpus size.
- Will need to revisit if the corpus grows past ~1M chunks per project.

Supersedes ADR 0031 (Pinecone evaluation).`,
  },
];

async function main(): Promise<void> {
  let pass = 0;
  let fail = 0;
  for (const sample of SAMPLES) {
    process.stdout.write(`[${sample.label.padEnd(18)}] ... `);
    try {
      const out = await classify(sample.text);
      const ok = out.result.type === sample.expected;
      const ext = out.result.externalId ? ` ext=${out.result.externalId}` : "";
      const refs =
        out.result.references.length > 0 ? ` refs=${out.result.references.join(",")}` : "";
      const date = out.result.detectedDate ? ` date=${out.result.detectedDate}` : "";
      const cache =
        out.usage.cacheReadInputTokens > 0
          ? ` cache_hit=${out.usage.cacheReadInputTokens}`
          : out.usage.cacheCreationInputTokens > 0
            ? ` cache_write=${out.usage.cacheCreationInputTokens}`
            : "";
      const tag = ok ? "OK" : `FAIL (got ${out.result.type})`;
      console.log(
        `${tag}  type=${out.result.type}${ext}${refs}${date}  in=${out.usage.inputTokens} out=${out.usage.outputTokens}${cache}  ${out.latencyMs}ms`,
      );
      if (ok) pass += 1;
      else fail += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`ERROR: ${msg}`);
      fail += 1;
    }
  }
  console.log(`\n${pass} pass / ${fail} fail / ${SAMPLES.length} total`);
  if (fail > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error("classifier-test failed:", err);
  process.exit(1);
});
