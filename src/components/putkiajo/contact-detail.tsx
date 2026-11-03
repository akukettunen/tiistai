"use client";

import { ArrowLeft, Building2, Globe, Mail, MapPin, Pencil, Phone, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  Deal,
  EmailThread,
  Note,
  Organization,
  Person,
  Pipeline,
  Stage,
} from "@/lib/crm";
import { OrganizationFormModal, PersonFormModal } from "./contact-forms";
import { DealFormModal } from "./deal-form";
import { DealsList, NotesPanel, ThreadList } from "./timeline";
import { Avatar, Button, Toast } from "./ui";

function DetailShell({
  backHref,
  backLabel,
  icon,
  title,
  badge,
  onEdit,
  onDelete,
  side,
  main,
}: {
  backHref: string;
  backLabel: string;
  icon: ReactNode;
  title: string;
  badge?: string | null;
  onEdit: () => void;
  onDelete: () => void;
  side: ReactNode;
  main: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl px-5 py-5">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 text-sm text-[#6b6979] hover:text-[#29283a]"
      >
        <ArrowLeft size={15} /> {backLabel}
      </Link>
      <div className="mt-3 flex items-center gap-3">
        {icon}
        <h1 className="min-w-0 truncate text-2xl font-semibold tracking-tight">{title}</h1>
        {badge && (
          <span className="rounded bg-[#efeefe] px-2 py-0.5 text-xs font-semibold text-[#5148df]">
            {badge}
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <Button onClick={onEdit}>
            <Pencil size={14} /> Edit
          </Button>
          <Button variant="ghost" aria-label="Delete" onClick={onDelete}>
            <Trash2 size={16} />
          </Button>
        </div>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[340px_1fr]">
        <aside className="space-y-5">{side}</aside>
        <div className="space-y-5">{main}</div>
      </div>
    </div>
  );
}

function InfoRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <span className="mt-0.5 text-[#9997a5]">{icon}</span>
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  );
}

export function PersonDetail({
  ownerId,
  initialPerson,
  persons,
  initialOrganizations,
  pipelines,
  stages,
  initialDeals,
  notes,
  threads,
}: {
  ownerId: string;
  initialPerson: Person;
  persons: Person[];
  initialOrganizations: Organization[];
  pipelines: Pipeline[];
  stages: Stage[];
  initialDeals: Deal[];
  notes: Note[];
  threads: EmailThread[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [person, setPerson] = useState(initialPerson);
  const [organizations, setOrganizations] = useState(initialOrganizations);
  const [deals, setDeals] = useState(initialDeals);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const organization = organizations.find((o) => o.id === person.organization_id);

  async function remove() {
    if (!confirm(`Delete ${person.name}? Their deals are kept.`)) return;
    const { error } = await supabase.from("crm_persons").delete().eq("id", person.id);
    if (error) return setToast(error.message);
    router.push("/putkiajo/contacts");
  }

  return (
    <>
      <DetailShell
        backHref="/putkiajo/contacts"
        backLabel="People"
        icon={<Avatar name={person.name} size={44} />}
        title={person.name}
        badge={person.label}
        onEdit={() => setEditing(true)}
        onDelete={remove}
        side={
          <>
            <section className="space-y-3 rounded-xl border border-[#e3e2e9] bg-white p-4">
              <h3 className="text-sm font-semibold">Details</h3>
              {organization && (
                <InfoRow icon={<Building2 size={15} />}>
                  <Link
                    href={`/putkiajo/organizations/${organization.id}`}
                    className="text-[#5148df] hover:underline"
                  >
                    {organization.name}
                  </Link>
                </InfoRow>
              )}
              {person.emails.map((email) => (
                <InfoRow key={email.value} icon={<Mail size={15} />}>
                  <a href={`mailto:${email.value}`} className="text-[#5148df] hover:underline">
                    {email.value}
                  </a>{" "}
                  <span className="text-xs text-[#9997a5]">({email.label})</span>
                </InfoRow>
              ))}
              {person.phones.map((phone) => (
                <InfoRow key={phone.value} icon={<Phone size={15} />}>
                  <a href={`tel:${phone.value}`}>{phone.value}</a>{" "}
                  <span className="text-xs text-[#9997a5]">({phone.label})</span>
                </InfoRow>
              ))}
              {!organization && !person.emails.length && !person.phones.length && (
                <p className="text-sm text-[#9997a5]">No details yet.</p>
              )}
            </section>
            <DealsList deals={deals} stages={stages} onAdd={() => setAdding(true)} />
          </>
        }
        main={
          <>
            <NotesPanel ownerId={ownerId} target={{ person_id: person.id }} initialNotes={notes} />
            <ThreadList threads={threads} />
          </>
        }
      />
      {editing && (
        <PersonFormModal
          ownerId={ownerId}
          person={person}
          organizations={organizations}
          onClose={() => setEditing(false)}
          onSaved={(next, org) => {
            if (org) setOrganizations((current) => [...current, org]);
            setPerson(next);
            setEditing(false);
            router.refresh();
          }}
        />
      )}
      {adding && pipelines[0] && (
        <DealFormModal
          ownerId={ownerId}
          pipelines={pipelines}
          stages={stages}
          persons={persons}
          organizations={organizations}
          defaults={{ pipelineId: pipelines[0].id, personId: person.id }}
          onClose={() => setAdding(false)}
          onCreated={({ deal, organization: org }) => {
            if (org) setOrganizations((current) => [...current, org]);
            if (deal.person_id === person.id) setDeals((current) => [...current, deal]);
            setAdding(false);
          }}
        />
      )}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </>
  );
}

export function OrganizationDetail({
  ownerId,
  initialOrganization,
  initialPersons,
  organizations,
  pipelines,
  stages,
  initialDeals,
  notes,
  threads,
}: {
  ownerId: string;
  initialOrganization: Organization;
  initialPersons: Person[];
  organizations: Organization[];
  pipelines: Pipeline[];
  stages: Stage[];
  initialDeals: Deal[];
  notes: Note[];
  threads: EmailThread[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [organization, setOrganization] = useState(initialOrganization);
  const [persons, setPersons] = useState(initialPersons);
  const [deals, setDeals] = useState(initialDeals);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addingPerson, setAddingPerson] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const people = persons.filter((person) => person.organization_id === organization.id);
  const website = organization.website
    ? organization.website.startsWith("http")
      ? organization.website
      : `https://${organization.website}`
    : "";

  async function remove() {
    if (!confirm(`Delete ${organization.name}? People and deals are kept.`)) return;
    const { error } = await supabase.from("crm_organizations").delete().eq("id", organization.id);
    if (error) return setToast(error.message);
    router.push("/putkiajo/contacts?tab=organizations");
  }

  return (
    <>
      <DetailShell
        backHref="/putkiajo/contacts?tab=organizations"
        backLabel="Organizations"
        icon={
          <span className="grid size-11 place-items-center rounded-xl bg-[#eef0f5] text-[#6b6979]">
            <Building2 size={22} />
          </span>
        }
        title={organization.name}
        onEdit={() => setEditing(true)}
        onDelete={remove}
        side={
          <>
            <section className="space-y-3 rounded-xl border border-[#e3e2e9] bg-white p-4">
              <h3 className="text-sm font-semibold">Details</h3>
              {organization.address && (
                <InfoRow icon={<MapPin size={15} />}>{organization.address}</InfoRow>
              )}
              {website && (
                <InfoRow icon={<Globe size={15} />}>
                  <a href={website} target="_blank" rel="noreferrer" className="text-[#5148df] hover:underline">
                    {organization.website}
                  </a>
                </InfoRow>
              )}
              {!organization.address && !website && (
                <p className="text-sm text-[#9997a5]">No details yet.</p>
              )}
            </section>
            <section className="rounded-xl border border-[#e3e2e9] bg-white">
              <h3 className="flex items-center gap-2 border-b border-[#ecebf1] px-4 py-3 text-sm font-semibold">
                People <span className="text-xs font-normal text-[#8b8998]">{people.length}</span>
                <button
                  className="ml-auto text-xs font-medium text-[#5148df]"
                  onClick={() => setAddingPerson(true)}
                >
                  + Add
                </button>
              </h3>
              <ul className="divide-y divide-[#f0eff4]">
                {people.map((person) => (
                  <li key={person.id}>
                    <Link
                      href={`/putkiajo/persons/${person.id}`}
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-[#fafafd]"
                    >
                      <Avatar name={person.name} size={26} />
                      <span className="truncate">{person.name}</span>
                    </Link>
                  </li>
                ))}
                {people.length === 0 && (
                  <li className="p-6 text-center text-sm text-[#9997a5]">No people yet.</li>
                )}
              </ul>
            </section>
            <DealsList deals={deals} stages={stages} onAdd={() => setAdding(true)} />
          </>
        }
        main={
          <>
            <NotesPanel
              ownerId={ownerId}
              target={{ organization_id: organization.id }}
              initialNotes={notes}
            />
            <ThreadList threads={threads} />
          </>
        }
      />
      {editing && (
        <OrganizationFormModal
          ownerId={ownerId}
          organization={organization}
          onClose={() => setEditing(false)}
          onSaved={(next) => {
            setOrganization(next);
            setEditing(false);
          }}
        />
      )}
      {addingPerson && (
        <PersonFormModal
          ownerId={ownerId}
          organizations={organizations}
          defaults={{ organizationId: organization.id }}
          onClose={() => setAddingPerson(false)}
          onSaved={(person) => {
            setPersons((current) => [...current, person]);
            setAddingPerson(false);
          }}
        />
      )}
      {adding && pipelines[0] && (
        <DealFormModal
          ownerId={ownerId}
          pipelines={pipelines}
          stages={stages}
          persons={persons}
          organizations={organizations}
          defaults={{ pipelineId: pipelines[0].id, organizationId: organization.id }}
          onClose={() => setAdding(false)}
          onCreated={({ deal, person }) => {
            if (person) setPersons((current) => [...current, person]);
            if (deal.organization_id === organization.id) setDeals((current) => [...current, deal]);
            setAdding(false);
          }}
        />
      )}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </>
  );
}
