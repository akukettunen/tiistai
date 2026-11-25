import { timingSafeEqual } from "node:crypto";
import { errorMessage } from "@/lib/calendar/account";
import { env } from "@/lib/calendar/google";
import { ensureWatches } from "@/lib/calendar/watch";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function authorized(request: Request) {
  const secret = env("CRON_SECRET");
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Renews watch channels expiring within 24h for every connected account. */
async function handle(request: Request) {
  if (!authorized(request)) return new Response(null, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin.from("calendar_accounts").select("owner_id").neq("status", "revoked");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const results = [];
  for (const row of data ?? []) {
    const ownerId = row.owner_id as string;
    try {
      const result = await ensureWatches(admin, ownerId);
      results.push({ owner_id: ownerId, ...result });
    } catch (caught) {
      results.push({ owner_id: ownerId, renewed: 0, errors: [errorMessage(caught)] });
    }
  }
  return Response.json({ accounts: results.length, results });
}

export const GET = handle;
export const POST = handle;
