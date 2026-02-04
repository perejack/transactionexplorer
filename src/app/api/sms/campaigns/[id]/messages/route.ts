import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isEmailAllowed } from "@/lib/auth";

export const runtime = "nodejs";

function pickString(value: string | null) {
  const s = (value || "").trim();
  return s.length ? s : undefined;
}

function parseIntSafe(value: string | null, fallback: number) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
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
  const campaignId = String(id || "").trim();
  if (!campaignId) {
    return NextResponse.json({ status: "error", message: "Invalid id" }, { status: 400 });
  }

  const url = new URL(req.url);
  const status = pickString(url.searchParams.get("status"));
  const page = Math.max(1, parseIntSafe(url.searchParams.get("page"), 1));
  const limit = Math.min(200, Math.max(10, parseIntSafe(url.searchParams.get("limit"), 50)));
  const offset = (page - 1) * limit;

  const admin = createSupabaseAdminClient();

  let q = admin
    .from("sms_messages")
    .select("id, created_at, phone, phone_normalized, tx_id, tx_status, amount, status, flux_message_id, delivery_status_text, delivery_status_code", {
      count: "exact",
    })
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false });

  if (status) q = q.eq("status", status);

  const res = await q.range(offset, offset + limit - 1);
  if (res.error) {
    return NextResponse.json({ status: "error", message: res.error.message }, { status: 500 });
  }

  return NextResponse.json({
    status: "success",
    page,
    limit,
    total: res.count || 0,
    messages: res.data || [],
  });
}
