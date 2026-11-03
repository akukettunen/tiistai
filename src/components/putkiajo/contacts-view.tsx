"use client";

import { ArrowDown, ArrowUp, Building2, Pencil, Plus, Search, Trash2, User } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { primaryValue, type Deal, type Organization, type Person } from "@/lib/crm";
import { OrganizationFormModal, PersonFormModal } from "./contact-forms";
import { Avatar, Button, Toast } from "./ui";

type Tab = "people" | "organizations";
type DealRef = Pick<Deal, "id" | "person_id" | "organization_id" | "status">;
type SortDir = "asc" | "desc";
const PAGE_SIZE = 50;

type Column<T> = {
  key: string;
  label: string;
  value: (row: T) => string | number;
  render?: (row: T) => ReactNode;
};

export function ContactsView({
  ownerId,
  initialTab,
  initialPersons,
  initialOrganizations,
  deals,
}: {
  ownerId: string;
  initialTab: Tab;
  initialPersons: Person[];
  initialOrganizations: Organization[];
  deals: DealRef[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [persons, setPersons] = useState(initialPersons);
  const [organizations, setOrganizations] = useState(initialOrganizations);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: "name", dir: "asc" });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingPerson, setEditingPerson] = useState<Person | "new" | null>(null);
  const [editingOrg, setEditingOrg] = useState<Organization | "new" | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const orgById = useMemo(() => new Map(organizations.map((o) => [o.id, o])), [organizations]);
  const openDeals = useMemo(() => deals.filter((deal) => deal.status === "open"), [deals]);

  const personColumns: Column<Person>[] = [
    {
      key: "name",
      label: "Name",
      value: (p) => p.name.toLowerCase(),
      render: (p) => (
        <Link href={`/putkiajo/persons/${p.id}`} className="flex items-center gap-2 font-medium hover:text-[#5148df]">
          <Avatar name={p.name} size={26} />
          <span className="truncate">{p.name}</span>
          {p.label && (
            <span className="rounded bg-[#efeefe] px-1.5 py-0.5 text-[10px] font-semibold text-[#5148df]">
              {p.label}
            </span>
          )}
        </Link>
      ),
    },
    {
      key: "organization",
      label: "Organization",
      value: (p) => (p.organization_id ? orgById.get(p.organization_id)?.name ?? "" : "").toLowerCase(),
      render: (p) => {
        const org = p.organization_id ? orgById.get(p.organization_id) : undefined;
        return org ? (
          <Link href={`/putkiajo/organizations/${org.id}`} className="hover:text-[#5148df]">
            {org.name}
          </Link>
        ) : null;
      },
    },
    {
      key: "email",
      label: "Email",
      value: (p) => primaryValue(p.emails),
      render: (p) => {
        const email = primaryValue(p.emails);
        return email ? (
          <a href={`mailto:${email}`} className="text-[#5148df] hover:underline">
            {email}
          </a>
        ) : null;
      },
    },
    { key: "phone", label: "Phone", value: (p) => primaryValue(p.phones) },
    {
      key: "open_deals",
      label: "Open deals",
      value: (p) => openDeals.filter((d) => d.person_id === p.id).length,
    },
    { key: "owner", label: "Owner", value: () => "You" },
  ];

  const orgColumns: Column<Organization>[] = [
    {
      key: "name",
      label: "Name",
      value: (o) => o.name.toLowerCase(),
      render: (o) => (
        <Link
          href={`/putkiajo/organizations/${o.id}`}
          className="flex items-center gap-2 font-medium hover:text-[#5148df]"
        >
          <span className="grid size-6.5 place-items-center rounded-md bg-[#eef0f5] text-[#6b6979]">
            <Building2 size={14} />
          </span>
          <span className="truncate">{o.name}</span>
        </Link>
      ),
    },
    {
      key: "people",
      label: "People",
      value: (o) => persons.filter((p) => p.organization_id === o.id).length,
    },
    {
      key: "open_deals",
      label: "Open deals",
      value: (o) => openDeals.filter((d) => d.organization_id === o.id).length,
    },
    { key: "address", label: "Address", value: (o) => o.address },
    { key: "owner", label: "Owner", value: () => "You" },
  ];

  function switchTab(next: Tab) {
    setTab(next);
    setSelected(new Set());
    setPage(0);
    setSort({ key: "name", dir: "asc" });
    router.replace(next === "people" ? "/putkiajo/contacts" : "/putkiajo/contacts?tab=organizations", {
      scroll: false,
    });
  }

  async function deleteSelected() {
    const ids = [...selected];
    if (!ids.length) return;
    const noun =
      tab === "people"
        ? ids.length === 1 ? "person" : "people"
        : ids.length === 1 ? "organization" : "organizations";
    if (!confirm(`Delete ${ids.length} ${noun}?`)) return;
    const table = tab === "people" ? "crm_persons" : "crm_organizations";
    const { error } = await supabase.from(table).delete().in("id", ids);
    if (error) return setToast(error.message);
    if (tab === "people") setPersons((current) => current.filter((p) => !selected.has(p.id)));
    else {
      setOrganizations((current) => current.filter((o) => !selected.has(o.id)));
      setPersons((current) =>
        current.map((p) =>
          p.organization_id && selected.has(p.organization_id) ? { ...p, organization_id: null } : p,
        ),
      );
    }
    setSelected(new Set());
    setToast(`Deleted ${ids.length}`);
  }

  const table =
    tab === "people" ? (
      <ContactTable
        rows={persons}
        columns={personColumns}
        search={(p) =>
          [p.name, ...p.emails.map((e) => e.value), ...p.phones.map((e) => e.value), p.organization_id ? orgById.get(p.organization_id)?.name : ""].join(" ")
        }
        onEdit={(p) => setEditingPerson(p)}
        {...{ query, sort, setSort, page, setPage, selected, setSelected }}
      />
    ) : (
      <ContactTable
        rows={organizations}
        columns={orgColumns}
        search={(o) => [o.name, o.address, o.website].join(" ")}
        onEdit={(o) => setEditingOrg(o)}
        {...{ query, sort, setSort, page, setPage, selected, setSelected }}
      />
    );

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-[#e5e5ec] bg-white px-5 py-3">
        <div className="flex rounded-lg border border-[#dedde7] p-0.5 text-sm font-medium">
          <TabButton active={tab === "people"} onClick={() => switchTab("people")}>
            <User size={15} /> People
          </TabButton>
          <TabButton active={tab === "organizations"} onClick={() => switchTab("organizations")}>
            <Building2 size={15} /> Organizations
          </TabButton>
        </div>
        <Button
          variant="success"
          onClick={() => (tab === "people" ? setEditingPerson("new") : setEditingOrg("new"))}
        >
          <Plus size={16} strokeWidth={2.4} /> {tab === "people" ? "Person" : "Organization"}
        </Button>
        {selected.size > 0 && (
          <Button variant="ghost" className="text-[#d63c41]" onClick={deleteSelected}>
            <Trash2 size={15} /> Delete {selected.size}
          </Button>
        )}
        <div className="relative ml-auto w-full max-w-72">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9997a5]" />
          <input
            className="h-9 w-full rounded-lg border border-[#e4e3eb] bg-[#fafafd] pl-9 pr-3 text-sm outline-none focus:border-[#6c63ff]"
            placeholder={tab === "people" ? "Search people" : "Search organizations"}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-5">{table}</div>

      {editingPerson && (
        <PersonFormModal
          ownerId={ownerId}
          person={editingPerson === "new" ? undefined : editingPerson}
          organizations={organizations}
          onClose={() => setEditingPerson(null)}
          onSaved={(person, org) => {
            if (org) setOrganizations((current) => [...current, org]);
            setPersons((current) =>
              current.some((p) => p.id === person.id)
                ? current.map((p) => (p.id === person.id ? person : p))
                : [...current, person],
            );
            setEditingPerson(null);
          }}
        />
      )}
      {editingOrg && (
        <OrganizationFormModal
          ownerId={ownerId}
          organization={editingOrg === "new" ? undefined : editingOrg}
          onClose={() => setEditingOrg(null)}
          onSaved={(org) => {
            setOrganizations((current) =>
              current.some((o) => o.id === org.id)
                ? current.map((o) => (o.id === org.id ? org : o))
                : [...current, org],
            );
            setEditingOrg(null);
          }}
        />
      )}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 ${
        active ? "bg-[#efeefe] text-[#5148df]" : "text-[#6b6979] hover:text-[#29283a]"
      }`}
    >
      {children}
    </button>
  );
}

function ContactTable<T extends { id: string }>({
  rows,
  columns,
  search,
  onEdit,
  query,
  sort,
  setSort,
  page,
  setPage,
  selected,
  setSelected,
}: {
  rows: T[];
  columns: Column<T>[];
  search: (row: T) => string;
  onEdit: (row: T) => void;
  query: string;
  sort: { key: string; dir: SortDir };
  setSort: (sort: { key: string; dir: SortDir }) => void;
  page: number;
  setPage: (page: number) => void;
  selected: Set<string>;
  setSelected: (selected: Set<string>) => void;
}) {
  const needle = query.trim().toLowerCase();
  const filtered = needle ? rows.filter((row) => search(row).toLowerCase().includes(needle)) : rows;
  const sortColumn = columns.find((column) => column.key === sort.key) ?? columns[0];
  const sorted = [...filtered].sort((a, b) => {
    const left = sortColumn.value(a);
    const right = sortColumn.value(b);
    const result =
      typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left).localeCompare(String(right), "fi");
    return sort.dir === "asc" ? result : -result;
  });
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = sorted.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const allVisibleSelected = visible.length > 0 && visible.every((row) => selected.has(row.id));

  return (
    <div className="overflow-hidden rounded-xl border border-[#e3e2e9] bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-180 text-left text-sm">
          <thead className="border-b border-[#ecebf1] bg-[#fafafd] text-xs text-[#6b6979]">
            <tr>
              <th className="w-10 px-3 py-2.5">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allVisibleSelected}
                  onChange={() => {
                    const next = new Set(selected);
                    for (const row of visible) {
                      if (allVisibleSelected) next.delete(row.id);
                      else next.add(row.id);
                    }
                    setSelected(next);
                  }}
                />
              </th>
              {columns.map((column) => (
                <th key={column.key} className="px-3 py-2.5 font-medium">
                  <button
                    className="inline-flex items-center gap-1 hover:text-[#29283a]"
                    onClick={() =>
                      setSort({
                        key: column.key,
                        dir: sort.key === column.key && sort.dir === "asc" ? "desc" : "asc",
                      })
                    }
                  >
                    {column.label}
                    {sort.key === column.key &&
                      (sort.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                  </button>
                </th>
              ))}
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0eff4]">
            {visible.map((row) => (
              <tr key={row.id} className="group hover:bg-[#fafafd]">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select row"
                    checked={selected.has(row.id)}
                    onChange={() => {
                      const next = new Set(selected);
                      if (next.has(row.id)) next.delete(row.id);
                      else next.add(row.id);
                      setSelected(next);
                    }}
                  />
                </td>
                {columns.map((column) => (
                  <td key={column.key} className="max-w-64 truncate px-3 py-2">
                    {column.render ? column.render(row) : column.value(row)}
                  </td>
                ))}
                <td className="px-2">
                  <button
                    aria-label="Edit"
                    onClick={() => onEdit(row)}
                    className="rounded-md p-1.5 text-[#aaa8b4] opacity-0 hover:bg-[#f2f2f7] hover:text-[#29283a] group-hover:opacity-100"
                  >
                    <Pencil size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={columns.length + 2} className="p-10 text-center text-sm text-[#9997a5]">
                  {needle ? "No matches." : "Nothing here yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-[#ecebf1] px-4 py-2.5 text-xs text-[#6b6979]">
        <span>
          {sorted.length} {sorted.length === 1 ? "result" : "results"}
        </span>
        {pageCount > 1 && (
          <div className="flex items-center gap-2">
            <Button className="h-7! px-2!" disabled={current === 0} onClick={() => setPage(current - 1)}>
              Previous
            </Button>
            <span>
              {current + 1} / {pageCount}
            </span>
            <Button
              className="h-7! px-2!"
              disabled={current >= pageCount - 1}
              onClick={() => setPage(current + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
