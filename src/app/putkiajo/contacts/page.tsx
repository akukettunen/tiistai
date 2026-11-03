import { redirect } from "next/navigation";
import { ContactsView } from "@/components/putkiajo/contacts-view";
import { createClient } from "@/lib/supabase/server";
import type { Deal, Organization, Person } from "@/lib/crm";

export default async function ContactsPage({ searchParams }: PageProps<"/putkiajo/contacts">) {
  const { tab } = await searchParams;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/auth");

  const [persons, organizations, deals] = await Promise.all([
    supabase.from("crm_persons").select("*").order("name"),
    supabase.from("crm_organizations").select("*").order("name"),
    supabase.from("crm_deals").select("id, person_id, organization_id, status"),
  ]);
  const error = persons.error ?? organizations.error ?? deals.error;
  if (error) throw new Error(error.message);

  return (
    <ContactsView
      ownerId={auth.user.id}
      initialTab={tab === "organizations" ? "organizations" : "people"}
      initialPersons={persons.data as Person[]}
      initialOrganizations={organizations.data as Organization[]}
      deals={deals.data as Pick<Deal, "id" | "person_id" | "organization_id" | "status">[]}
    />
  );
}
