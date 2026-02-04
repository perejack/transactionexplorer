import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isEmailAllowed } from "@/lib/auth";

export const runtime = "nodejs";

function pickString(value: unknown) {
  const s = String(value ?? "").trim();
  return s.length ? s : undefined;
}

async function getCounts(admin: ReturnType<typeof createSupabaseAdminClient>, campaignId: string) {
  const statuses = ["queued", "sent", "delivered", "failed"] as const;
  const counts: Record<string, number> = {};

  for (const st of statuses) {
    const res = await admin
      .from("sms_messages")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", st);

    if (res.error) throw new Error(res.error.message);
    counts[st] = res.count || 0;
  }

  return counts;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
  }

  if (!isEmailAllowed(user.email)) {
    return NextResponse.json({ status: "error", message: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const campaignId = pickString(id);
  if (!campaignId) {
    return NextResponse.json({ status: "error", message: "Invalid id" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: campaign, error: fetchError } = await admin.from("sms_campaigns").select("*").eq("id", campaignId).single();

  if (fetchError || !campaign) {
    return NextResponse.json({ status: "error", message: fetchError?.message || "Not found" }, { status: 404 });
  }

  try {
    const counts = await getCounts(admin, campaignId);
    return NextResponse.json({ status: "success", campaign, counts });
  } catch (e: any) {
    return NextResponse.json({ status: "error", message: e?.message || "Failed" }, { status: 500 });
  }
}
