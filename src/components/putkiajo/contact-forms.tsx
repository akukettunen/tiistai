"use client";

import { Plus, X } from "lucide-react";
import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { normalizeEmail, type ContactValue, type Organization, type Person } from "@/lib/crm";
import { ensureOrganization } from "./deal-form";
import { Button, EntityCombo, Field, Modal, Select, TextInput, type ComboValue } from "./ui";

export const PERSON_LABELS = ["", "Hot lead", "Warm lead", "Cold lead", "Customer"];

function cleanValues(values: ContactValue[], isEmail: boolean): ContactValue[] {
  const cleaned = values
    .map((v) => ({ ...v, value: isEmail ? normalizeEmail(v.value) : v.value.trim() }))
    .filter((v) => v.value);
  if (cleaned.length && !cleaned.some((v) => v.primary)) cleaned[0].primary = true;
  return cleaned;
}

function ValueList({
  label,
  values,
  onChange,
  type,
}: {
  label: string;
  values: ContactValue[];
  onChange: (values: ContactValue[]) => void;
  type: "email" | "tel";
}) {
  const rows = values.length ? values : [{ value: "", label: "work", primary: true }];
  return (
    <Field label={label}>
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={index} className="flex gap-2">
            <TextInput
              type={type}
              value={row.value}
              onChange={(event) =>
                onChange(rows.map((r, i) => (i === index ? { ...r, value: event.target.value } : r)))
              }
            />
            <Select
              className="w-28! shrink-0"
              value={row.label}
              onChange={(event) =>
                onChange(rows.map((r, i) => (i === index ? { ...r, label: event.target.value } : r)))
              }
            >
              <option value="work">Work</option>
              <option value="home">Home</option>
              <option value="mobile">Mobile</option>
              <option value="other">Other</option>
            </Select>
            {rows.length > 1 && (
              <button
                type="button"
                aria-label="Remove"
                className="rounded-md px-2 text-[#9997a5] hover:bg-[#f2f2f7]"
                onClick={() => onChange(rows.filter((_, i) => i !== index))}
              >
                <X size={15} />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs font-medium text-[#5148df]"
          onClick={() => onChange([...rows, { value: "", label: "work", primary: false }])}
        >
          <Plus size={13} /> Add one more
        </button>
      </div>
    </Field>
  );
}

export function PersonFormModal({
  ownerId,
  person,
  organizations,
  defaults,
  onClose,
  onSaved,
}: {
  ownerId: string;
  person?: Person;
  organizations: Organization[];
  defaults?: { name?: string; email?: string; organizationId?: string | null };
  onClose: () => void;
  onSaved: (person: Person, organization?: Organization) => void;
}) {
  const supabase = createClient();
  const initialOrg = organizations.find(
    (o) => o.id === (person?.organization_id ?? defaults?.organizationId),
  );
  const [name, setName] = useState(person?.name ?? defaults?.name ?? "");
  const [org, setOrg] = useState<ComboValue>({
    id: initialOrg?.id ?? null,
    name: initialOrg?.name ?? "",
  });
  const [emails, setEmails] = useState<ContactValue[]>(
    person?.emails ??
      (defaults?.email ? [{ value: defaults.email, label: "work", primary: true }] : []),
  );
  const [phones, setPhones] = useState<ContactValue[]>(person?.phones ?? []);
  const [label, setLabel] = useState(person?.label ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError("Name is required.");
    setSaving(true);
    setError(null);
    try {
      const orgResult = await ensureOrganization(supabase, ownerId, org);
      const values = {
        name: name.trim().slice(0, 200),
        organization_id: orgResult.id,
        emails: cleanValues(emails, true),
        phones: cleanValues(phones, false),
        label: label || null,
      };
      const query = person
        ? supabase.from("crm_persons").update(values).eq("id", person.id).select().single()
        : supabase
            .from("crm_persons")
            .insert({ ...values, owner_id: ownerId })
            .select()
            .single();
      const { data, error: saveError } = await query;
      if (saveError) throw saveError;
      onSaved(data as Person, orgResult.created);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={person ? "Edit person" : "Add person"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="person-form" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form id="person-form" onSubmit={submit} className="space-y-4">
        <Field label="Name">
          <TextInput autoFocus value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Organization">
          <EntityCombo
            options={organizations.map((o) => ({ id: o.id, name: o.name }))}
            value={org}
            onChange={setOrg}
            placeholder="Organization"
          />
        </Field>
        <ValueList label="Email" type="email" values={emails} onChange={setEmails} />
        <ValueList label="Phone" type="tel" values={phones} onChange={setPhones} />
        <Field label="Label">
          <Select value={label} onChange={(event) => setLabel(event.target.value)}>
            {PERSON_LABELS.map((option) => (
              <option key={option} value={option}>
                {option || "No label"}
              </option>
            ))}
          </Select>
        </Field>
        {error && <p className="text-sm text-[#d63c41]">{error}</p>}
      </form>
    </Modal>
  );
}

export function OrganizationFormModal({
  ownerId,
  organization,
  onClose,
  onSaved,
}: {
  ownerId: string;
  organization?: Organization;
  onClose: () => void;
  onSaved: (organization: Organization) => void;
}) {
  const supabase = createClient();
  const [name, setName] = useState(organization?.name ?? "");
  const [address, setAddress] = useState(organization?.address ?? "");
  const [website, setWebsite] = useState(organization?.website ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError("Name is required.");
    setSaving(true);
    const values = {
      name: name.trim().slice(0, 200),
      address: address.trim(),
      website: website.trim(),
    };
    const { data, error: saveError } = await (organization
      ? supabase.from("crm_organizations").update(values).eq("id", organization.id).select().single()
      : supabase
          .from("crm_organizations")
          .insert({ ...values, owner_id: ownerId })
          .select()
          .single());
    if (saveError) {
      setError(saveError.message);
      setSaving(false);
      return;
    }
    onSaved(data as Organization);
  }

  return (
    <Modal
      title={organization ? "Edit organization" : "Add organization"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="org-form" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form id="org-form" onSubmit={submit} className="space-y-4">
        <Field label="Name">
          <TextInput autoFocus value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Address">
          <TextInput value={address} onChange={(event) => setAddress(event.target.value)} />
        </Field>
        <Field label="Website">
          <TextInput
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            placeholder="https://"
          />
        </Field>
        {error && <p className="text-sm text-[#d63c41]">{error}</p>}
      </form>
    </Modal>
  );
}
