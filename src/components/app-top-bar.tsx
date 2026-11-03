"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const TABS = [
  { href: "/board", label: "Tiistai" },
  { href: "/putkiajo", label: "PutkiAjo" },
];

export function AppTopBar({
  leading,
  search,
}: {
  leading?: ReactNode;
  search?: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-[#e5e5ec] bg-white px-4 md:px-7">
      {leading}
      <nav className="flex h-full items-stretch gap-1" aria-label="Apps">
        {TABS.map((tab) => {
          const active =
            pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex items-center px-3 text-sm font-semibold transition-colors ${
                active
                  ? "text-[#29283a] after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[#6c63ff]"
                  : "text-[#8b8998] hover:text-[#29283a]"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {search && <div className="relative ml-auto w-full max-w-90">{search}</div>}
    </header>
  );
}
