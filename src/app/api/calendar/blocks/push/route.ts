import { pushBlock } from "@/lib/calendar/blocks";
import { UUID_RE, jsonError, readJson, requireUser } from "@/lib/calendar/http";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user || response) return response;

  const { blockId } = await readJson(request);
  if (typeof blockId !== "string" || !UUID_RE.test(blockId)) return jsonError("blockId is required.");
  try {
    return Response.json(await pushBlock(createAdminClient(), user.id, blockId));
  } catch (caught) {
    return Response.json({ sync_status: "error", error: caught instanceof Error ? caught.message : "Push failed." });
  }
}
