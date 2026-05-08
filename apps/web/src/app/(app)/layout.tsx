import type { ReactNode } from "react";
import { logoutAction } from "../login/actions";
import { countPendingDraftsForUser } from "@/lib/drafts";
import { requireSession } from "@/lib/webapp-auth";
import { type NavItem, SidebarNav } from "./_components/sidebar-nav";

export const dynamic = "force-dynamic";

function buildNavItems(pendingDrafts: number): NavItem[] {
  return [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Projects", href: "/projects" },
    {
      label: "Drafts",
      href: "/drafts",
      badge: pendingDrafts > 0 ? String(pendingDrafts) : undefined,
    },
    { label: "Audit", href: "/audit" },
    { label: "Canons", href: "/account/canons" },
    { label: "API keys", href: "/account/api-keys" },
    { label: "Invite", href: "/account/invite-tokens" },
    { label: "Setup guide", href: "/setup" },
  ];
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const pendingDrafts = await countPendingDraftsForUser(session.userId);
  const items = buildNavItems(pendingDrafts);

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950/40">
        <div className="flex items-center gap-2 px-4 py-4">
          <span className="text-base font-semibold text-zinc-100">WorkBrain</span>
        </div>
        <SidebarNav items={items} />
        <div className="mt-auto border-t border-zinc-800 px-3 py-3">
          <p className="px-1 text-xs text-zinc-500">Signed in as</p>
          <p className="px-1 font-mono text-xs text-zinc-300" title={session.email}>
            {session.email}
          </p>
          <form action={logoutAction} className="mt-2">
            <button
              type="submit"
              className="w-full rounded-md border border-zinc-800 px-2 py-1 text-xs text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
