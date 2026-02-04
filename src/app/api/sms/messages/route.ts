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

export async function GET(req: Request) {
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

  const url = new URL(req.url);
  const status = pickString(url.searchParams.get("status"));
  const campaignId = pickString(url.searchParams.get("campaignId"));
  const search = pickString(url.searchParams.get("search"));
  const page = Math.max(1, parseIntSafe(url.searchParams.get("page"), 1));
  const limit = Math.min(200, Math.max(10, parseIntSafe(url.searchParams.get("limit"), 50)));
  const offset = (page - 1) * limit;

  const admin = createSupabaseAdminClient();

  let q = admin
    .from("sms_messages")
    .select(
      "id, created_at, campaign_id, phone, phone_normalized, tx_id, tx_status, amount, status, flux_message_id, delivery_status_text, delivery_status_code",
      { count: "exact" }
    )
    .order("created_at", { ascending: false });

  if (campaignId) q = q.eq("campaign_id", campaignId);
  if (status) q = q.eq("status", status);

  if (search) {
    const term = search.replace(/%/g, "");
    q = q.or(
      `phone.ilike.%${term}%,phone_normalized.ilike.%${term}%,flux_message_id.ilike.%${term}%`
    );
  }

  const res = await q.range(offset, offset + limit - 1);
  if (res.error) {
    return NextResponse.json({ status: "error", message: res.error.message }, { status: 500 });
  }

  const rows = (res.data || []) as Array<{ campaign_id: string }>;
  const campaignIds = Array.from(new Set(rows.map((r) => String((r as any)?.campaign_id || "")).filter(Boolean)));

  let campaignsById: Record<string, { id: string; name: string | null }> = {};
  if (campaignIds.length > 0) {
    const cRes = await admin.from("sms_campaigns").select("id, name").in("id", campaignIds);
    if (!cRes.error) {
      for (const c of cRes.data || []) {
        const id = String((c as any)?.id || "");
        if (!id) continue;
        campaignsById[id] = { id, name: ((c as any)?.name ?? null) as any };
      }
    }
  }

  return NextResponse.json({
    status: "success",
    page,
    limit,
    total: res.count || 0,
    messages: res.data || [],
    campaignsById,
  });
}
