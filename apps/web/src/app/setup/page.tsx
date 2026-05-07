import Link from "next/link";
import { CopyBlock } from "./_components/copy-block";

export const dynamic = "force-static";

const MCP_URL = "https://www.workbrain.app/api/mcp";

const CLI_INSTALL = "npm install -g @anthropic-ai/claude-code";

const CLI_REGISTER = `claude mcp add workbrain --scope user --transport http \\
  ${MCP_URL} \\
  --header "Authorization: Bearer wbk_PASTE_YOUR_KEY_HERE"`;

const CURSOR_JSON = JSON.stringify(
  {
    mcpServers: {
      workbrain: {
        url: MCP_URL,
        headers: { Authorization: "Bearer wbk_PASTE_YOUR_KEY_HERE" },
      },
    },
  },
  null,
  2,
);

const CLAUDE_DESKTOP_JSON = JSON.stringify(
  {
    mcpServers: {
      workbrain: {
        type: "http",
        url: MCP_URL,
        headers: { Authorization: "Bearer wbk_PASTE_YOUR_KEY_HERE" },
      },
    },
  },
  null,
  2,
);

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-10 scroll-mt-24 text-lg font-semibold text-zinc-100">
      {children}
    </h2>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-6 text-sm font-medium text-zinc-200">{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-sm text-zinc-400">{children}</p>;
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
      {children}
    </div>
  );
}

function Inline({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-zinc-900 px-1 py-0.5 font-mono text-[12px] text-zinc-300">
      {children}
    </code>
  );
}

export default function SetupPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10 text-zinc-300">
      <header className="mb-8">
        <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300">
          ← Back to home
        </Link>
        <h1 className="mt-2 text-3xl font-semibold text-zinc-100">Setup</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Connect WorkBrain to your IDE so its agent can use your project memory while
          you work. Pick the path that matches your tooling — they all hit the same
          remote MCP endpoint at <Inline>{MCP_URL}</Inline>.
        </p>
      </header>

      <nav className="mb-10 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 text-sm">
        <p className="mb-2 text-[11px] uppercase tracking-wide text-zinc-500">On this page</p>
        <ul className="space-y-1 text-zinc-300">
          <li>
            <a href="#prerequisites" className="hover:text-indigo-300">
              1. Prerequisites
            </a>
          </li>
          <li>
            <a href="#cursor" className="hover:text-indigo-300">
              2. Cursor (recommended for non-CLI users)
            </a>
          </li>
          <li>
            <a href="#claude-code-cli" className="hover:text-indigo-300">
              3. Claude Code (CLI)
            </a>
          </li>
          <li>
            <a href="#claude-code-vscode" className="hover:text-indigo-300">
              4. Claude Code (VS Code extension)
            </a>
          </li>
          <li>
            <a href="#claude-desktop" className="hover:text-indigo-300">
              5. Claude Desktop
            </a>
          </li>
          <li>
            <a href="#verify" className="hover:text-indigo-300">
              6. Verify it works
            </a>
          </li>
          <li>
            <a href="#first-steps" className="hover:text-indigo-300">
              7. First steps
            </a>
          </li>
          <li>
            <a href="#troubleshooting" className="hover:text-indigo-300">
              8. Troubleshooting
            </a>
          </li>
        </ul>
      </nav>

      <H2 id="prerequisites">1. Prerequisites</H2>
      <P>
        You need an API key (starts with <Inline>wbk_</Inline>). If you don't have one
        yet, redeem an invitation at{" "}
        <Link href="/signup" className="text-indigo-300 hover:underline">
          /signup
        </Link>{" "}
        — you'll receive your key once. If you already have an account, create or
        review keys at{" "}
        <Link href="/account/api-keys" className="text-indigo-300 hover:underline">
          /account/api-keys
        </Link>
        .
      </P>
      <Note>
        We never display the raw key after creation. If you lose it, create another and
        revoke the old one. There's no recovery path.
      </Note>

      <H2 id="cursor">2. Cursor</H2>
      <P>
        Cursor has a 1-click install for MCP servers — no terminal, no JSON editing.
      </P>
      <H3>Option A — One-click (recommended)</H3>
      <P>
        Go to{" "}
        <Link href="/account/api-keys" className="text-indigo-300 hover:underline">
          /account/api-keys
        </Link>{" "}
        and click <strong>Create key</strong>. The success banner shows an{" "}
        <strong>Add to Cursor</strong> button — that opens Cursor with the MCP config
        already filled in. Confirm the prompt and you're done.
      </P>
      <H3>Option B — Manual fallback</H3>
      <P>
        If the deep link doesn't open Cursor (corp policy, missing handler), edit{" "}
        <Inline>~/.cursor/mcp.json</Inline> and merge:
      </P>
      <CopyBlock label="~/.cursor/mcp.json" value={CURSOR_JSON} />
      <P>
        Replace <Inline>wbk_PASTE_YOUR_KEY_HERE</Inline> with your real key. Restart
        Cursor.
      </P>

      <H2 id="claude-code-cli">3. Claude Code (CLI)</H2>
      <P>If you live in the terminal, this is the fastest path.</P>
      <H3>Step 1 — Install Claude Code</H3>
      <CopyBlock value={CLI_INSTALL} />
      <P>
        Requires Node 20+ globally. On Linux/macOS the binary lands in your Node
        prefix. Verify with <Inline>claude --version</Inline>.
      </P>
      <H3>Step 2 — Register WorkBrain at user scope</H3>
      <CopyBlock value={CLI_REGISTER} />
      <P>
        Replace <Inline>wbk_PASTE_YOUR_KEY_HERE</Inline> with your real key.{" "}
        <Inline>--scope user</Inline> means the registration applies to{" "}
        <em>any folder</em> you open Claude Code in — you don't need to repeat it per
        project.
      </P>

      <H2 id="claude-code-vscode">4. Claude Code (VS Code extension)</H2>
      <P>
        The VS Code extension reads the same configuration as the CLI{" "}
        (<Inline>~/.claude.json</Inline>), so registering once via the CLI covers both.
      </P>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-zinc-300">
        <li>Install the extension from the VS Code Marketplace ("Claude Code").</li>
        <li>
          Run the CLI register command above, even if you only intend to use VS Code.
        </li>
        <li>
          Reload the VS Code window (<Inline>Cmd/Ctrl+Shift+P</Inline> → "Reload
          Window") so the extension picks up the new config.
        </li>
        <li>
          Open the Claude Code chat panel (right sidebar) and type <Inline>/mcp</Inline>{" "}
          — workbrain should be listed with ✓ Connected.
        </li>
      </ol>

      <H2 id="claude-desktop">5. Claude Desktop</H2>
      <P>
        Claude Desktop reads its MCP config from{" "}
        <Inline>claude_desktop_config.json</Inline>. To find the file:{" "}
        <strong>Settings → Developer → Edit Config</strong>.
      </P>
      <CopyBlock label="claude_desktop_config.json" value={CLAUDE_DESKTOP_JSON} />
      <P>
        Replace <Inline>wbk_PASTE_YOUR_KEY_HERE</Inline> with your real key. Save the
        file and restart Claude Desktop.
      </P>

      <H2 id="verify">6. Verify it works</H2>
      <P>From any folder (it's user-scoped, so any folder works):</P>
      <CopyBlock
        value={`cd /tmp && claude mcp list`}
      />
      <P>Expected output:</P>
      <CopyBlock
        label="output"
        value={`workbrain: ${MCP_URL} (HTTP) - ✓ Connected`}
      />
      <P>
        Inside Claude Code (CLI or VS Code chat), type <Inline>/mcp</Inline>. The
        workbrain server should be listed with five tools:
      </P>
      <ul className="ml-5 mt-2 list-disc space-y-0.5 text-sm text-zinc-400">
        <li>
          <Inline>ingest_paste</Inline>
        </li>
        <li>
          <Inline>search</Inline>
        </li>
        <li>
          <Inline>record_decision</Inline>
        </li>
        <li>
          <Inline>link_documents</Inline>
        </li>
        <li>
          <Inline>compose_context</Inline>
        </li>
      </ul>

      <H2 id="first-steps">7. First steps</H2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-zinc-300">
        <li>
          Create your first project at{" "}
          <Link href="/projects/new" className="text-indigo-300 hover:underline">
            /projects/new
          </Link>
          . Pick a client slug (e.g. your customer) and project slug (e.g. the system
          you're working on).
        </li>
        <li>
          Open the project in your IDE and ask Claude to ingest your first ticket. Plain
          text:
          <CopyBlock
            label="prompt"
            value={`Use workbrain.ingest_paste in projectSlug "<your-slug>" to save:\n\nTICKET-1234: <title>\n<paste body here>`}
          />
        </li>
        <li>
          Once you have 2-3 docs, run <Inline>compose_context</Inline> on one and ask
          for a plan. That's the moment WorkBrain pays off.
        </li>
      </ol>
      <P>
        Don't try to seed everything at once. Add tickets as you work, decisions as you
        make them, and canon (
        <Inline>/projects/&lt;client&gt;/&lt;project&gt;/canon</Inline>) when you have
        15 min between meetings.
      </P>

      <H2 id="troubleshooting">8. Troubleshooting</H2>

      <H3><Inline>claude mcp list</Inline> doesn't show workbrain</H3>
      <P>
        You may have run <Inline>claude mcp add</Inline> without{" "}
        <Inline>--scope user</Inline> — that registers it only for the current folder.
        Re-run the command with the flag. You can also inspect{" "}
        <Inline>~/.claude.json</Inline> to confirm the entry is in <Inline>mcpServers</Inline>.
      </P>

      <H3><Inline>workbrain</Inline> shows but says "Not connected" or 401</H3>
      <P>
        Your API key is rejected. Possible causes: revoked, mistyped, or extra
        whitespace when pasted. Verify the key is still active at{" "}
        <Link href="/account/api-keys" className="text-indigo-300 hover:underline">
          /account/api-keys
        </Link>
        ; if not, create a new one and re-run <Inline>claude mcp add</Inline> (Claude
        Code overwrites the existing entry on re-add).
      </P>

      <H3>Cursor "Add to Cursor" button doesn't open the app</H3>
      <P>
        Browser blocked the deep link, or Cursor isn't installed. Use the manual JSON
        fallback above (<Inline>~/.cursor/mcp.json</Inline>) and restart Cursor.
      </P>

      <H3>Tools call returns "project_not_found"</H3>
      <P>
        The <Inline>projectSlug</Inline> you passed doesn't match any project under
        your user. Check{" "}
        <Link href="/projects" className="text-indigo-300 hover:underline">
          /projects
        </Link>{" "}
        for the exact slugs (lowercase, dashes, no spaces). Cross-user projects are
        invisible by design.
      </P>

      <H3>The agent ignores my canon / doesn't reference my conventions</H3>
      <P>
        Make sure you populated canon at{" "}
        <Inline>/projects/&lt;client&gt;/&lt;project&gt;/canon</Inline>. The model
        respects it best when called via <Inline>compose_context</Inline> — that
        bundles canon explicitly. A bare <Inline>search</Inline> won't include it.
      </P>

      <hr className="my-12 border-zinc-800" />

      <p className="text-xs text-zinc-500">
        Something off in this guide? Tell Carlos. We'll keep it updated as the platform
        evolves.
      </p>
    </main>
  );
}
