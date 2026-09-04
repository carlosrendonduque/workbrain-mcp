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

// Canon domains (Phase 4.18b). One user can curate multiple cross-project
// canon "buckets" — e.g. a consultant who works on Salesforce AND on
// digital narratives needs to keep those bodies of conventions completely
// separate. A project belongs to at most one domain (nullable for legacy
// projects). Project-level canon still overrides where it exists; the
// domain canon fills gaps.
export const canonDomains = pgTable(
  "canon_domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    conventions: text("conventions"),
    guidelines: text("guidelines"),
    architecture: text("architecture"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("canon_domains_user_slug_idx").on(t.userId, t.slug)],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    keyHash: text("key_hash").notNull().unique(),
    label: text("label").notNull(),
    // When set, this key can only reach that one client. NULL means every
    // client the user owns — the behaviour every key had before scoping
    // existed, so old keys keep working.
    //
    // The point is blast radius: the key sitting in the .mcp.json of the
    // bakery's repo should not be able to read the bank's corpus if that
    // laptop is lost.
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    lastUsedAt: timestamp("last_used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("api_keys_user_idx").on(t.userId), index("api_keys_client_idx").on(t.clientId)],
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
// Where a client's corpus lives. "shared" keeps it in the central database
// alongside other shared clients (separation enforced inside); "dedicated"
// puts it in a database of its own, so the answer to "is my data in the same
// database as your other clients?" is no.
export const ISOLATION_MODES = ["shared", "dedicated"] as const;
export type IsolationMode = (typeof ISOLATION_MODES)[number];

// Which account the client's text is processed through. "anthropic"/"voyage"
// mean our own keys; the cloud providers mean the client's own account, where
// they are the data processor and Anthropic never receives the content.
export const LLM_PROVIDERS = ["anthropic", "bedrock", "vertex", "foundry"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export const EMBEDDING_PROVIDERS = ["voyage", "bedrock", "vertex"] as const;
export type EmbeddingProvider = (typeof EMBEDDING_PROVIDERS)[number];

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),

    // --- Isolation scenario -------------------------------------------
    // These six columns are the whole per-client policy. Everything that
    // touches this client's data reads them to decide where the data lives
    // and which account processes it. Defaults reproduce today's behaviour
    // exactly, so existing rows keep working with no migration of content.
    isolationMode: text("isolation_mode").notNull().default("shared"),
    // Name of the environment variable holding the dedicated connection
    // string — NOT the connection string itself. Secrets stay in the
    // deployment environment; the database only records which one to read.
    corpusDbUrlEnv: text("corpus_db_url_env"),
    llmProvider: text("llm_provider").notNull().default("anthropic"),
    // Non-secret provider settings (region, project id, the env var name to
    // read credentials from). Never store credentials here.
    llmConfig: jsonb("llm_config").notNull().default({}),
    embeddingProvider: text("embedding_provider").notNull().default("voyage"),
    embeddingConfig: jsonb("embedding_config").notNull().default({}),
    // NULL means keep indefinitely. Set it when a contract caps retention.
    retentionDays: integer("retention_days"),

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
    // Canon domain this project inherits from. Nullable so legacy projects
    // (created before domains were introduced) keep working — UI nudges the
    // user to assign one. New projects must select a domain at creation.
    domainId: uuid("domain_id").references(() => canonDomains.id, {
      onDelete: "set null",
    }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    persist: boolean("persist").notNull().default(true),
    conventions: text("conventions"),
    guidelines: text("guidelines"),
    architecture: text("architecture"),
    repoUrl: text("repo_url"),
    defaultBranch: text("default_branch"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("projects_client_slug_idx").on(t.clientId, t.slug),
    index("projects_domain_idx").on(t.domainId),
  ],
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
    // 5-stage ticket progress (only meaningful when type='ticket'). Each
    // stage is a free-form text field; emptiness signals "not done yet".
    // The status line phase = the next empty stage.
    progress: jsonb("progress").notNull().default({}),
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
    // Which model produced the vector above. Vectors from two different
    // models are not comparable, so a corpus embedded by more than one is
    // silently broken search — the scores are meaningless across the split
    // and nothing else would reveal it. Recorded so it can be detected, and
    // so switching a client's embedding provider is a visible re-index
    // rather than a quiet corruption. NULL on rows written before this
    // existed; those are all voyage-3-large.
    embeddingModel: text("embedding_model"),
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
    // Stable, semantic kind of activity for the feed (e.g.
    // 'draft_proposed', 'draft_approved', 'document_archived'). Distinct
    // from `operation` which is the raw tool name (some tools produce many
    // kinds, e.g. compose_context only has one). NULL for legacy rows.
    activityKind: text("activity_kind"),
    // Primary external entity this row affected (e.g. 'ACME-1042' for a
    // draft about that ticket). Lets the activity feed group by entity
    // and supports drill-downs without re-parsing payloads.
    targetExternalId: text("target_external_id"),
    // Streamable-HTTP MCP session that produced this row (or a synthetic
    // ID for web-originated mutations). Lets users filter the audit and
    // activity feed to a single chat / browsing session.
    sessionId: text("session_id"),
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
    index("invocations_session_idx").on(t.sessionId),
    index("invocations_project_kind_created_idx").on(t.projectId, t.activityKind, t.createdAt),
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

// -----------------------------
// Drafts (Phase 4.17): proposals from the agent for the user to review
// before they enter the corpus. Status flows pending → approved | rejected.
// On approve, approved_document_id points at the freshly inserted document.
// -----------------------------
export const draftDocuments = pgTable(
  "draft_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    proposedType: text("proposed_type").notNull(),
    proposedTitle: text("proposed_title").notNull(),
    proposedContent: text("proposed_content").notNull(),
    proposedExternalId: text("proposed_external_id"),
    proposedFrontmatter: jsonb("proposed_frontmatter").notNull().default({}),
    proposalNote: text("proposal_note"),
    // List of external_ids the agent flagged as related to this draft. On
    // approve, each becomes a `related` document_links row when the other
    // side already exists as a real document. Soft co-mention semantics.
    relatedExternalIds: jsonb("related_external_ids").notNull().default([]),
    status: text("status").notNull().default("pending"),
    proposedBy: text("proposed_by").notNull().default("agent"),
    approvedDocumentId: uuid("approved_document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    reviewedAt: timestamp("reviewed_at"),
  },
  (t) => [
    index("draft_documents_project_status_idx").on(t.projectId, t.status),
    index("draft_documents_created_at_idx").on(t.createdAt),
  ],
);
