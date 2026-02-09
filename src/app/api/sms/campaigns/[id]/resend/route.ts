import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isEmailAllowed } from "@/lib/auth";

export const runtime = "nodejs";

function pickString(value: unknown) {
  const s = String(value ?? "").trim();
  return s.length ? s : undefined;
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
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

  // Update all failed messages for this campaign back to queued status
  const { data: updated, error: updateError } = await admin
    .from("sms_messages")
    .update({
      status: "queued",
      flux_message_id: null,
      send_response: null,
      delivery_status_text: null,
    })
    .eq("campaign_id", campaignId)
    .eq("status", "failed")
    .select("id");

  if (updateError) {
    return NextResponse.json({ status: "error", message: updateError.message }, { status: 500 });
  }

  const rescheduledCount = updated?.length || 0;

  if (rescheduledCount === 0) {
    return NextResponse.json({ status: "success", message: "No failed messages to resend", rescheduled: 0 });
  }

  // Update campaign status to sending if we rescheduled any
  await admin.from("sms_campaigns").update({ status: "sending" }).eq("id", campaignId);

  return NextResponse.json({
    status: "success",
    message: `Rescheduled ${rescheduledCount} failed message(s) for resend`,
    rescheduled: rescheduledCount,
  });
}
