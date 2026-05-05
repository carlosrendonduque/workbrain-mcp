# WorkBrain — Product Vision

> Short document capturing what WorkBrain is as a product, not just as a personal tool. It serves to explain the product to a fellow consultant six months from now, to inform what goes on `workbrain.app`, and to keep the architecture from drifting away from the real problem.

## Thesis in one sentence

**WorkBrain is the project memory that Cursor and Claude Code are missing when you work for multiple clients that must not bleed into each other.**

That's the offer. Everything else derives from it.

## The customer

**The consultant-developer working for multiple accounts in parallel.**

This includes:

- Independent and boutique consultants (Salesforce, ServiceNow, SAP, AWS) running two to four parallel engagements.
- Dev shops and technical agencies where the tech lead rotates between three to five accounts.
- Contractors on platforms like Toptal, Gun, Andela rotating between engagements.
- Full-stack freelancers with a portfolio of active clients.
- Fractional CTOs serving multiple startups, where the cardinal sin is contaminating one client's solution with another's information.

What they have in common is not "lots of code". It's **lots of dispersed context, fragmented across tools, that cannot bleed across accounts, and that today gets manually loaded into the IDE every time you switch tasks**.

Daily rate of this profile: 800-5000 USD/day. A tool that saves them 30 min/day on context loading pays for itself at 200 USD/month with zero discussion.

## The problem, told as they live it

> *A ticket lands for a client. To handle it well I need to: read the ticket, recall the cousin ticket from two months ago, find the Teams thread where the module was discussed, retrieve the architectural decision from Confluence, re-read the project convention the client requires, and open the repo. I load all of that manually into the agent's chat, by copy-paste, every time.*
>
> *When I close the ticket, the context is lost. Tomorrow the cousin bug forces me to start from scratch. If I get distracted and mix info between clients, I contaminate a PR. If I don't remember what I decided three months ago, I'll propose to the agent the same solution we already discarded.*
>
> *Cursor reads the client's code brilliantly. But it's blind to everything that lives outside the repo: the ticket, the cousin ticket, the Confluence, the thread, the meeting, the email, the convention, the stakeholder.*

WorkBrain attacks that, head-on.

## What WorkBrain is and what it ISN'T

### What it is

- **Multi-client operational memory.** Accumulates tickets, Confluence pages, Teams threads, emails, transcripts, decisions, conventions, stakeholders, in a per-client and per-project corpus.
- **A RAG layer with isolation discipline.** Every chunk carries client and project. Queries always filter. Cross-client requires an explicit flag and leaves an audit trail.
- **An MCP server that inserts itself into Cursor / Claude Code.** Your IDE doesn't change. It just gains tools: `compose_context`, `ingest_paste`, `search`, `record_decision`. Your coding agent stops being blind.
- **A hosted service with a management webapp.** So you don't live in the terminal: corpus browse, convention editing, audit trail, project configuration, all in the browser.

### What it is NOT

- **NOT a PKM.** Doesn't compete with Notion, Obsidian, Roam. Those are for personal knowledge with no isolation discipline. WorkBrain assumes that isolation between accounts is the feature, not a feature.
- **NOT a CRM.** Doesn't track pipeline or revenue per client.
- **NOT Glean / Guru.** Those are enterprise knowledge search, single-tenant within one company. WorkBrain is **multi-tenant from the consultant's perspective** — the inverse.
- **NOT an autonomous agent.** Doesn't "solve tickets on its own". It's a copilot to the copilot: it loads context to the agent the consultant already uses.
- **NOT a writing assistant.** Generates communication drafts when needed, but that's a byproduct. The core is coding-with-context.

## The five verbs the user contracts for

JTBD (jobs-to-be-done) framing, because it forces you to think in user verbs, not product features.

1. **"Load into my IDE all the human and business context for the ticket I'm about to work."** → `compose_context`. The flagship operation.
2. **"Keep my clients' contexts separate so the agent doesn't leak one into the other."** → multi-tenant filter, audit trail, persist/ephemeral per project.
3. **"Quickly capture what comes in scattered (Jira, Teams, Confluence, Outlook, transcripts)."** → `ingest_paste`, `ingest_url`.
4. **"Remember prior technical decisions so the agent doesn't propose what we already discarded."** → `record_decision`, `link_documents`, RAG over `decisions/`.
5. **"While you're at it, draft the Jira comment / closing email."** → `draft_jira_comment`, `draft_email`. Byproduct, not foundation.

Those five verbs are the product. Everything else is plumbing.

## Product shape

Three pieces:

1. **Multi-tenant SaaS backend.** One user = one tenant. Each tenant has N clients; each client has N projects. Postgres+pgvector, Voyage embeddings, multi-provider LLM. Hosted on Vercel + Neon.
2. **Downloadable MCP server.** Each user runs it locally and points it at their backend. That's what makes WorkBrain "live" inside Cursor / Claude Code / Claude Desktop without building proprietary UI. Strong product insight: **WorkBrain doesn't compete to be the primary UI; it inserts itself into the UI where the user already lives**. Cursor and Claude Code already won that fight.
3. **Management webapp.** For corpus browser, audit trail, conventions and stakeholders editing, billing, configuration. Secondary to MCP in daily use, but important for keeping the corpus healthy.

## Business model (hypothesis, to be validated)

- **Individual** ~30-50 USD/month. A solo consultant, up to N clients/projects. Optional bring-your-own LLM key.
- **Pro** ~100-150 USD/month. Unlimited clients/projects, advanced audit, ephemeral per project, BYOK by default for multi-provider.
- **Team** (future) per-seat pricing. Share corpus inside a boutique with per-client permissions and consolidated audit.

**BYOK (bring your own key) for LLM** is important in this segment. High-rate professionals prefer paying their own tokens over trusting a vendor that could market on top of them. It also solves the cost problem on expensive operations.

## Why it generalizes beyond the initial user

The five verbs are not specific to Salesforce, nor to any particular prime contractor. Any consultant-developer working multi-account executes them several times a day.

What's currently shaped by the initial user but generalizes naturally:

- **Source types** (ticket, Confluence, Teams, Outlook, transcript) are universal in the enterprise world. Specific connectors (Jira API, MS Graph, etc.) are implementation work, not vision.
- **Per-project conventions** are free-form markdown text. Nothing about how they're modeled is Salesforce-specific.
- **Stakeholders** and their communication styles are generic.
- **Isolation discipline** is what makes the product, and it applies to any consultant.

Plan: **start from the narrow ICP** (Salesforce consultant, where the initial user lives the exact pain and knows others who do too) and expand from there. Five convinced Salesforce consultants up front are worth more than a hundred lukewarm leads of "consultants in general".

## Expansion strategy

1. **v1: the initial user as first customer.** They're the ideal bug detector because they live the pain every day.
2. **v2: 5-10 known Salesforce consultants.** Qualitative validation, pricing test, first case studies.
3. **v3: open up to Salesforce-adjacent stacks** (NetSuite, ServiceNow). Same customer profile, same pain.
4. **v4: generic opening to consultant-developers.** Public marketing, content, third-party integrations.
5. **v5: Team tier.** Small boutiques sharing corpus with controlled permissions.

## Open product decisions

Three foundational questions, in order of architectural impact:

1. **Build it as a personal tool that eventually becomes a product, or as a product from day one with the initial user as first customer?** Auth from the start, real tenant isolation in DB, billing hooks, signup flow. **Recommendation: product from day one, with shortcuts.** That is: multi-tenant schema, but simple auth (signed cookie) until there's a second user. That avoids painful refactors later.

2. **Is the corpus on disk/Git per-user, or only in the backend?** For the initial user as a single user, local private Git makes sense. For a product, the corpus lives only in the tenant's backend — per-user Git doesn't scale. **Recommendation: start with local Git for the initial user, and design the backend to function without Git from day one (Git as optional export, not as a dependency).**

3. **Target Salesforce consultants first or "generic consultants" from the start?** **Recommendation: Salesforce first**, leveraging the initial user's unfair advantage. Focused message and case studies; expansion to other stacks once the model is proven.

## An honest success metric

> *The metric that matters: how many minutes per day of manual context loading were eliminated?*

That's measurable. The audit trail logs every `compose_context` call (ticket worked with context loaded via WorkBrain). If the user goes from 20 manual loads/day to zero, that's roughly 3-4 hours/week of cognitive friction recycled into billable hours or into not burning out.

That metric is also what sells the product to the next users.
