import { redirect } from "next/navigation";
import { AppTopBar } from "@/components/app-top-bar";
import { PutkiNav } from "@/components/putkiajo/putki-nav";
import { createClient } from "@/lib/supabase/server";

export default async function PutkiAjoLayout({ children }: LayoutProps<"/putkiajo">) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/auth");

  await supabase.rpc("crm_ensure_default_pipeline");

  return (
    <div className="flex h-screen bg-[#f7f7fa] text-[#29283a]">
      <PutkiNav />
      <main className="flex min-w-0 flex-1 flex-col">
        <AppTopBar />
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </main>
    </div>
  );
}
