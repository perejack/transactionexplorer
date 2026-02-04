import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isEmailAllowed } from "@/lib/auth";
import { fluxSmsSendBulk, normalizePhoneE164 } from "@/lib/fluxsms";

export const runtime = "nodejs";

function pickString(value: unknown) {
  const s = String(value ?? "").trim();
  return s.length ? s : undefined;
}

function parseIntSafe(value: unknown, fallback: number) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

async function recomputeCounts(admin: ReturnType<typeof createSupabaseAdminClient>, campaignId: string) {
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

  await admin
    .from("sms_campaigns")
    .update({
      target_count: (counts.queued || 0) + (counts.sent || 0) + (counts.delivered || 0) + (counts.failed || 0),
      sent_count: (counts.sent || 0) + (counts.delivered || 0),
      delivered_count: counts.delivered || 0,
      failed_count: counts.failed || 0,
      last_dispatch_at: new Date().toISOString(),
    })
    .eq("id", campaignId);

  return counts;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
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

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const maxRecipients = Math.min(1000, Math.max(1, parseIntSafe(body?.maxRecipients, 300)));

  const admin = createSupabaseAdminClient();
  const { data: campaign, error: fetchError } = await admin.from("sms_campaigns").select("*").eq("id", campaignId).single();
  if (fetchError || !campaign) {
    return NextResponse.json({ status: "error", message: fetchError?.message || "Not found" }, { status: 404 });
  }

  const message = pickString((campaign as any)?.message);
  const senderId = pickString((campaign as any)?.sender_id) || "fluxsms";

  if (!message) {
    return NextResponse.json({ status: "error", message: "Campaign has no message" }, { status: 400 });
  }

  const { data: queued, error: qErr } = await admin
    .from("sms_messages")
    .select("id, phone, phone_normalized")
    .eq("campaign_id", campaignId)
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(maxRecipients);

  if (qErr) {
    return NextResponse.json({ status: "error", message: qErr.message }, { status: 500 });
  }

  const recipients = (queued || []).filter((r) => pickString((r as any)?.phone));
  if (recipients.length === 0) {
    const counts = await recomputeCounts(admin, campaignId);
    return NextResponse.json({ status: "success", message: "No queued recipients", counts, dispatched: 0 });
  }

  let bulkRes: any = null;
  try {
    bulkRes = await fluxSmsSendBulk({
      phones: recipients.map((r) => String((r as any).phone)),
      message,
      senderId,
    });
  } catch (e: any) {
    return NextResponse.json({ status: "error", message: e?.message || "Failed to send bulk SMS" }, { status: 500 });
  }

  const byMobile = new Map<string, any>();
  for (const r of bulkRes?.responses || []) {
    const mobileE164 = normalizePhoneE164(String(r?.mobile ?? ""));
    if (!mobileE164) continue;
    byMobile.set(mobileE164, r);
  }

  await Promise.all(
    recipients.map(async (row) => {
      const phoneE164 = normalizePhoneE164(String((row as any).phone_normalized || (row as any).phone));
      const r = phoneE164 ? byMobile.get(phoneE164) : null;

      const ok =
        Number(r?.["response-code"]) === 200 ||
        String(r?.["response-description"] || "").toLowerCase() === "success";
      const fluxId = pickString(r?.messageid);

      await admin
        .from("sms_messages")
        .update({
          status: ok ? "sent" : "failed",
          flux_message_id: fluxId || null,
          send_response: r || bulkRes || null,
        })
        .eq("id", (row as any).id);
    })
  );
  await admin.from("sms_campaigns").update({ status: "sending" }).eq("id", campaignId);

  const counts = await recomputeCounts(admin, campaignId);

  return NextResponse.json({
    status: "success",
    dispatched: recipients.length,
    counts,
    raw: bulkRes,
  });
}
