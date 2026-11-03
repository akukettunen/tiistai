"use client";

import { CircleDollarSign, Inbox, Layers3, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/putkiajo/inbox", label: "Inbox", icon: Inbox },
  { href: "/putkiajo/pipelines", label: "Deals", icon: CircleDollarSign, also: "/putkiajo/deals" },
  {
    href: "/putkiajo/contacts",
    label: "Contacts",
    icon: Users,
    also: "/putkiajo/persons",
    alsoOrg: "/putkiajo/organizations",
  },
];

export function PutkiNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="PutkiAjo"
      className="flex w-18 shrink-0 flex-col items-center gap-1 bg-[#19172e] py-3 text-white"
    >
      <Link
        href="/putkiajo"
        aria-label="PutkiAjo"
        className="mb-4 grid size-10 place-items-center rounded-xl bg-[#6c63ff]"
      >
        <Layers3 size={19} />
      </Link>
      {ITEMS.map(({ href, label, icon: Icon, also, alsoOrg }) => {
        const active = [href, also, alsoOrg].some(
          (prefix) => prefix && pathname.startsWith(prefix),
        );
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex w-15 flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-medium ${
              active
                ? "bg-white/12 text-white"
                : "text-white/55 hover:bg-white/[0.07] hover:text-white"
            }`}
          >
            <Icon size={20} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
