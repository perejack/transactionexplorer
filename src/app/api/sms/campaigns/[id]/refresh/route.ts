import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isEmailAllowed } from "@/lib/auth";
import { fluxSmsStatus } from "@/lib/fluxsms";

export const runtime = "nodejs";

function pickString(value: unknown) {
  const s = String(value ?? "").trim();
  return s.length ? s : undefined;
}

function parseIntSafe(value: unknown, fallback: number) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function mapDeliveryToMessageStatus(code: number | null | undefined, description: string | null | undefined) {
  if (code === 32) return "delivered";
  const d = String(description || "").toLowerCase();
  if (d.includes("delivered")) return "delivered";
  if (d.includes("failed") || d.includes("undeliver")) return "failed";
  return "sent";
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
      last_refresh_at: new Date().toISOString(),
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

  const limit = Math.min(50, Math.max(1, parseIntSafe(body?.limit, 20)));

  const admin = createSupabaseAdminClient();

  const { data: rows, error: fetchError } = await admin
    .from("sms_messages")
    .select("id, flux_message_id, status")
    .eq("campaign_id", campaignId)
    .in("status", ["sent"])
    .not("flux_message_id", "is", null)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (fetchError) {
    return NextResponse.json({ status: "error", message: fetchError.message }, { status: 500 });
  }

  const results: any[] = [];
  for (const row of rows || []) {
    const messageId = pickString((row as any).flux_message_id);
    if (!messageId) continue;

    try {
      const r = await fluxSmsStatus({ messageId });
      const code = (r as any)?.["delivery-status"];
      const desc = (r as any)?.["delivery-description"];
      const nextStatus = mapDeliveryToMessageStatus(
        typeof code === "number" ? code : Number(code),
        desc ? String(desc) : null
      );

      await admin
        .from("sms_messages")
        .update({
          status: nextStatus,
          delivery_status_code: typeof code === "number" ? code : (Number.isFinite(Number(code)) ? Number(code) : null),
          delivery_status_text: desc ? String(desc) : null,
          delivery_response: r as any,
          last_checked_at: new Date().toISOString(),
        })
        .eq("id", (row as any).id);

      results.push({ id: (row as any).id, status: nextStatus, raw: r });
    } catch (e: any) {
      await admin
        .from("sms_messages")
        .update({
          last_checked_at: new Date().toISOString(),
        })
        .eq("id", (row as any).id);

      results.push({ id: (row as any).id, error: e?.message || "Failed" });
    }
  }

  const counts = await recomputeCounts(admin, campaignId);

  return NextResponse.json({ status: "success", refreshed: results.length, counts, results });
}
