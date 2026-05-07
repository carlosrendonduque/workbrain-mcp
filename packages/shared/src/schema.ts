import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

// -----------------------------
// Auth
// -----------------------------
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    keyHash: text("key_hash").notNull().unique(),
    label: text("label").notNull(),
    lastUsedAt: timestamp("last_used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("api_keys_user_idx").on(t.userId)],
);

// Invite-only signup tokens. The owner of an existing account generates a
// token, shares it out-of-band with someone they want to onboard, and that
// person redeems it at /signup to create their own user + first API key.
// Tokens are one-time-use and can optionally expire.
export const signupTokens = pgTable(
  "signup_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    label: text("label").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    usedByUserId: uuid("used_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    usedAt: timestamp("used_at"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("signup_tokens_creator_idx").on(t.createdByUserId),
    index("signup_tokens_used_idx").on(t.usedByUserId),
  ],
);

// -----------------------------
// Tenancy
// -----------------------------
export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("clients_user_slug_idx").on(t.userId, t.slug)],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    persist: boolean("persist").notNull().default(true),
    conventions: text("conventions"),
    guidelines: text("guidelines"),
    architecture: text("architecture"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("projects_client_slug_idx").on(t.clientId, t.slug)],
);

// -----------------------------
// Corpus
// -----------------------------
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    type: text("type").notNull(),
    externalId: text("external_id"),
    path: text("path").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    frontmatter: jsonb("frontmatter").notNull().default({}),
    status: text("status"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("doc_project_idx").on(t.projectId),
    index("doc_type_idx").on(t.type),
    index("doc_external_id_idx").on(t.externalId),
  ],
);

export const documentLinks = pgTable(
  "document_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromDocumentId: uuid("from_document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    toDocumentId: uuid("to_document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    linkType: text("link_type").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("doc_links_from_idx").on(t.fromDocumentId),
    index("doc_links_to_idx").on(t.toDocumentId),
  ],
);

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    type: text("type").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    text: text("text").notNull(),
    tokenCount: integer("token_count").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("chunks_project_idx").on(t.projectId),
    index("chunks_client_idx").on(t.clientId),
  ],
);

// -----------------------------
// Audit
// -----------------------------
export const invocations = pgTable(
  "invocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id),
    projectId: uuid("project_id").references(() => projects.id),
    operation: text("operation").notNull(),
    userPrompt: text("user_prompt").notNull(),
    systemPrompt: text("system_prompt").notNull().default(""),
    retrievedChunks: jsonb("retrieved_chunks").notNull().default([]),
    provider: text("provider").notNull().default("none"),
    model: text("model").notNull().default("none"),
    responseText: text("response_text"),
    status: text("status").notNull(),
    errorDetail: text("error_detail"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    costUsd: text("cost_usd"),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("invocations_project_idx").on(t.projectId),
    index("invocations_created_at_idx").on(t.createdAt),
  ],
);

// -----------------------------
// Stakeholders (Phase 2+, table created, empty in Phase 1)
// -----------------------------
export const stakeholders = pgTable("stakeholders", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  name: text("name").notNull(),
  role: text("role"),
  communicationStyle: text("communication_style"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
