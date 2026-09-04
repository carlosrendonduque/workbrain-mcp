/**
 * Report any chat session that touched more than one client.
 *
 * The databases can be perfectly separated and the mixing still happen in the
 * agent's context window — a session loads one client's canon, the user
 * changes directory, and it carries on for another with the first still in
 * the window. This is what turns "your data is separated" into a statement
 * with a record behind it.
 *
 *   pnpm --filter @workbrain/web check:sessions [--days 30] [--user <email>]
 *
 * Exits non-zero when a crossing is found, so it can gate a release.
 */

import { neon } from "@neondatabase/serverless";
import { schema } from "@workbrain/shared";
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import type { WorkbrainDb } from "../src/lib/db";
import { checkSessionIsolation } from "../src/lib/session-isolation";

config({ path: ".env.local" });

function parseArgs(argv: string[]): { days?: number; email?: string } {
  const out: { days?: number; email?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--days") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0) throw new Error("--days needs a positive number");
      out.days = n;
    } else if (argv[i] === "--user") {
      out.email = argv[++i];
    } else {
      throw new Error(`Unknown flag: ${argv[i]}`);
    }
  }
  return out;
}

function fmt(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const centralUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!centralUrl) {
    throw new Error("Set DATABASE_URL_UNPOOLED (or DATABASE_URL) in apps/web/.env.local");
  }
  const central = drizzle(neon(centralUrl), { schema }) as WorkbrainDb;

  const users = await central
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(args.email ? eq(schema.users.email, args.email) : undefined);

  if (users.length === 0) {
    throw new Error(args.email ? `No user with email ${args.email}` : "No users found");
  }

  const since = args.days ? new Date(Date.now() - args.days * 24 * 60 * 60 * 1000) : undefined;
  console.log(
    `\nChecking ${users.length} user(s)${since ? ` since ${fmt(since)}` : " over all time"}\n`,
  );

  let total = 0;

  for (const user of users) {
    // null scope: this is an operator check and must see everything, or a
    // crossing between two clients could hide behind a narrow view.
    const report = await checkSessionIsolation(user.id, null, since ? { since } : {});

    console.log(`── ${user.email}`);
    console.log(
      `   ${report.sessionsChecked} session(s), ${report.invocationsChecked} invocation(s) examined`,
    );

    if (report.crossings.length === 0) {
      console.log("   ✅ no session touched more than one client\n");
      continue;
    }

    total += report.crossings.length;
    console.log(`   ❌ ${report.crossings.length} session(s) touched more than one client:\n`);
    for (const c of report.crossings) {
      console.log(`      session ${c.sessionId}`);
      console.log(`        clients   ${c.clients.map((x) => x.clientSlug).join(" + ")}`);
      console.log(`        window    ${fmt(c.firstSeen)} → ${fmt(c.lastSeen)}`);
      console.log(`        calls     ${c.invocations}`);
      console.log("");
    }
  }

  if (total > 0) {
    console.error(
      `${total} crossing(s) found. Each one is a single chat that held two clients' material.\n` +
        "Look at the audit trail for those session ids before telling anyone the separation held.",
    );
    process.exit(1);
  }
  console.log("No crossings found.");
}

main().catch((err: unknown) => {
  console.error("check-session-isolation failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
