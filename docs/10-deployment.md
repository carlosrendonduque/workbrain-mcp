# Deploying workbrain-mcp

This repo is a separate deployment from production (`workbrain`, live at
workbrain.app). It has its own Vercel project, its own Neon databases and its
own secrets. Nothing here is shared with production.

## Vercel project settings

| Setting | Value | Why |
|---|---|---|
| Repository | `carlosrendonduque/workbrain-mcp` | |
| Framework | Next.js | detected |
| Root Directory | `apps/web` | pnpm workspace; the app is not at the repo root |
| Node version | 22 | matches `.nvmrc` and the `engines` field |
| Build / install commands | leave as detected | Vercel reads `packageManager` from the root `package.json` |

Vercel installs from the root `pnpm-lock.yaml` and honours `.npmrc`, which
hoists `drizzle-orm`. Do not override the install command — the hoisting is
what keeps `packages/shared` and `apps/web` on one instance of drizzle.

## Environment variables

Every one of these was traced to the code that reads it. Anything not listed
is either CLI-only or unused at runtime, and adding it puts a secret in a
place that has no reason to hold one.

| Variable | Read by | Needed |
|---|---|---|
| `DATABASE_URL` | `lib/db.ts` | yes — the app cannot start without it |
| `WORKBRAIN_SESSION_SECRET` | `lib/session.ts` | yes — `next build` fails at page-data collection without it |
| `WORKBRAIN_API_KEYS_SALT` | `lib/auth.ts` | yes — must be the SAME value the existing keys were hashed with, or every API key stops working |
| `VOYAGE_API_KEY` | `lib/embeddings.ts` | yes — ingestion and search both embed |
| `ANTHROPIC_API_KEY` | `new Anthropic()` in `lib/providers.ts` | yes for any client on the shared arrangement; a client routed to their own Bedrock never touches it |
| `WORKBRAIN_DB_<CLIENT>` | `lib/db.ts` via `clients.corpus_db_url_env` | one per dedicated client. Missing one does not fall back to the central database — it refuses |

### Deliberately NOT set on Vercel

| Variable | Why not |
|---|---|
| `DATABASE_URL_UNPOOLED` | only migrations and admin scripts use it. The serverless runtime never opens a direct connection, and a direct connection string on a serverless platform is a connection-limit incident waiting to happen |
| `NEON_API_KEY` | only `db:isolate` uses it, and only when creating a database. It can create and delete Neon projects — the running app has no business holding it |
| `WORKBRAIN_CORPUS_PATH` / `_REMOTE` / `_BRANCH` | the git-backed corpus mirror is opt-in: `paste.ts` skips the write entirely when the config is absent. Vercel's filesystem is ephemeral, so a mirror there would be written and lost |
| `NODE_ENV` | Vercel sets it. Setting it by hand is how a preview ends up believing it is production |

## Importing the repo adopts .env.example

Vercel reads `apps/web/.env.example` on import and creates a variable for
every entry, using whatever value it finds there. The first import of this
project came up pointing at `host-pooler.region.aws.neon.tech`, with
`NODE_ENV=development` in production and a corpus mirror aimed at a path that
does not exist on a serverless filesystem.

`.env.example` therefore holds no values at all — only shapes, in comments.
Keep it that way. A plausible placeholder does not stay a placeholder.

## Getting the values there

Load them from `.env.local` with the CLI rather than by hand. Run it from
`apps/web`, not the repo root: the link lives beside the Root Directory, and
from anywhere else every command fails without saying why.

    cd apps/web
    pnpm dlx vercel link --project workbrain-mcp-web
    pnpm dlx vercel env ls
    printf %s "$VALUE" | pnpm dlx vercel env add DATABASE_URL production

Typing them is the failure mode: a truncated connection string fails clearly,
but a truncated salt fails as "your API key is invalid" and sends you looking
in the wrong place.

`vercel link` appends `VERCEL_OIDC_TOKEN` to `.env.local`. It is short-lived
and the file is ignored by git; leave it.

## Deployment Protection is on

Every deployment sits behind Vercel's SSO. An unauthenticated request gets a
302 to `vercel.com/sso-api` and never reaches the app, so curl and any health
check will report a redirect rather than a fault.

Leave it on. This environment holds real client corpora, and a preview URL is
guessable. Reaching it from outside a browser — an MCP client, a smoke test —
needs a protection bypass token, issued per deployment, not the protection
turned off.

## Which branch is production

`main` does not yet carry the per-client isolation work. Until it is merged,
either set Vercel's production branch to the feature branch or read the
preview deployment instead — a production build off `main` runs old code
against a database that has migrations 0009–0014 applied.

## Migrations are not part of the build

`next build` never touches the database. Migrations run deliberately, from a
machine with the unpooled URL:

    pnpm --filter @workbrain/web db:migrate:all

`db:migrate:all` and not `db:migrate`: a dedicated client's database needs the
same migrations as the central one, and the failure when it is skipped shows
up as a missing column in search, far from the cause.
