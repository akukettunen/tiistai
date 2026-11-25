import { accountView, requireUser } from "@/lib/calendar/http";

export const runtime = "nodejs";

export async function GET() {
  const { user, response } = await requireUser();
  if (!user || response) return response;
  return Response.json(await accountView(user.id));
}
