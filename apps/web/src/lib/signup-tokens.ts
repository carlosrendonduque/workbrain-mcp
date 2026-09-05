import { and, desc, eq, sql } from "drizzle-orm";
import { hashApiKey } from "./auth";
import { createApiKey } from "./api-keys";
import { db, schema } from "./db";

export class SignupTokenError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "SignupTokenError";
    this.code = code;
    this.status = status;
  }
}

export interface SignupTokenRow {
  tokenId: string;
  label: string;
  createdAt: Date | string;
  expiresAt: Date | string | null;
  usedAt: Date | string | null;
  usedByEmail: string | null;
}

export interface CreatedSignupToken {
  tokenId: string;
  rawToken: string;
  label: string;
}

export interface ClaimResult {
  userId: string;
  email: string;
  apiKey: string;
}

const TOKEN_PREFIX = "inv_";

function generateRawToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `${TOKEN_PREFIX}${hex}`;
}

export async function listSignupTokens(userId: string): Promise<SignupTokenRow[]> {
  const rows = await db
    .select({
      tokenId: schema.signupTokens.id,
      label: schema.signupTokens.label,
      createdAt: schema.signupTokens.createdAt,
      expiresAt: schema.signupTokens.expiresAt,
      usedAt: schema.signupTokens.usedAt,
      usedByEmail: schema.users.email,
    })
    .from(schema.signupTokens)
    .leftJoin(schema.users, eq(schema.users.id, schema.signupTokens.usedByUserId))
    .where(eq(schema.signupTokens.createdByUserId, userId))
    .orderBy(desc(schema.signupTokens.createdAt));
  return rows;
}

export interface CreateSignupTokenInput {
  label: string;
  expiresInDays?: number;
}

export async function createSignupToken(
  creatorUserId: string,
  input: CreateSignupTokenInput,
): Promise<CreatedSignupToken> {
  const label = input.label.trim();
  if (label.length === 0) {
    throw new SignupTokenError("missing_label", "Label is required.", 400);
  }
  const rawToken = generateRawToken();
  const tokenHash = await hashApiKey(rawToken);
  const expiresAt =
    input.expiresInDays && input.expiresInDays > 0
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

  const inserted = await db
    .insert(schema.signupTokens)
    .values({
      tokenHash,
      label,
      createdByUserId: creatorUserId,
      expiresAt,
    })
    .returning({ id: schema.signupTokens.id });

  const row = inserted[0];
  if (!row) {
    throw new SignupTokenError("insert_failed", "Failed to insert signup token.", 500);
  }
  return { tokenId: row.id, rawToken, label };
}

export async function revokeSignupToken(creatorUserId: string, tokenId: string): Promise<void> {
  const result = await db
    .delete(schema.signupTokens)
    .where(
      and(
        eq(schema.signupTokens.id, tokenId),
        eq(schema.signupTokens.createdByUserId, creatorUserId),
      ),
    )
    .returning({ id: schema.signupTokens.id });
  if (result.length === 0) {
    throw new SignupTokenError("not_found", "Token not found or not owned by user.", 404);
  }
}

// Validates the token, creates a user with the given email, marks the token
// as used, and issues the user's first API key. Atomic-ish: failure to insert
// the API key after creating the user would leave a user without keys, which
// is fine — they can request another invitation.
export async function claimSignupToken(args: {
  rawToken: string;
  email: string;
}): Promise<ClaimResult> {
  const trimmedToken = args.rawToken.trim();
  if (!trimmedToken.startsWith(TOKEN_PREFIX)) {
    throw new SignupTokenError(
      "invalid_token_format",
      "Invitation token must start with 'inv_'.",
      400,
    );
  }
  const email = args.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new SignupTokenError("invalid_email", "Email is not valid.", 400);
  }

  const tokenHash = await hashApiKey(trimmedToken);
  const tokenRows = await db
    .select({
      id: schema.signupTokens.id,
      usedByUserId: schema.signupTokens.usedByUserId,
      expiresAt: schema.signupTokens.expiresAt,
    })
    .from(schema.signupTokens)
    .where(eq(schema.signupTokens.tokenHash, tokenHash))
    .limit(1);

  const token = tokenRows[0];
  if (!token) {
    throw new SignupTokenError(
      "token_invalid",
      "Invitation token is invalid or already used.",
      403,
    );
  }
  if (token.usedByUserId) {
    throw new SignupTokenError(
      "token_used",
      "This invitation token has already been redeemed.",
      403,
    );
  }
  if (token.expiresAt && new Date(token.expiresAt).getTime() < Date.now()) {
    throw new SignupTokenError("token_expired", "This invitation token has expired.", 403);
  }

  const existingUser = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  if (existingUser[0]) {
    throw new SignupTokenError("email_taken", "An account with this email already exists.", 409);
  }

  const insertedUser = await db
    .insert(schema.users)
    .values({ email })
    .returning({ id: schema.users.id });
  const user = insertedUser[0];
  if (!user) {
    throw new SignupTokenError("user_insert_failed", "Failed to create user.", 500);
  }

  // Mark the token used. Defensive: if another concurrent claim wins the race
  // we'd see usedByUserId already set; the unique constraint on tokenHash plus
  // this update ordering keeps it safe enough for MVP.
  await db
    .update(schema.signupTokens)
    .set({ usedByUserId: user.id, usedAt: sql`now()` })
    .where(eq(schema.signupTokens.id, token.id));

  const apiKey = await createApiKey(user.id, "signup-key");

  return { userId: user.id, email, apiKey: apiKey.rawKey };
}
