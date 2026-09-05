"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  label: string;
  href: string;
  disabled?: boolean;
  badge?: string;
}

export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5 px-2 py-3">
      {items.map((item) => {
        const isActive = item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);
        if (item.disabled) {
          return (
            <span
              key={item.href}
              className="flex items-center justify-between rounded-md px-3 py-1.5 text-sm text-zinc-600"
              title="Coming in a later task"
            >
              <span>{item.label}</span>
              {item.badge ? (
                <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
                  {item.badge}
                </span>
              ) : null}
            </span>
          );
        }
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center justify-between rounded-md px-3 py-1.5 text-sm transition ${
              isActive
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            }`}
          >
            <span>{item.label}</span>
            {item.badge ? (
              <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-indigo-300">
                {item.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
