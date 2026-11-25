import { removeBlock } from "@/lib/calendar/blocks";
import { UUID_RE, jsonError, readJson, requireUser } from "@/lib/calendar/http";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user || response) return response;

  const { blockId } = await readJson(request);
  if (typeof blockId !== "string" || !UUID_RE.test(blockId)) return jsonError("blockId is required.");
  try {
    await removeBlock(createAdminClient(), user.id, blockId);
    return Response.json({ ok: true });
  } catch (caught) {
    return jsonError(caught instanceof Error ? caught.message : "Could not remove the block.", 500);
  }
}
