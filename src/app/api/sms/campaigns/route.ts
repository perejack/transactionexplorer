import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isEmailAllowed } from "@/lib/auth";
import { normalizePhoneE164, toKenyanLocalPhone } from "@/lib/fluxsms";

export const runtime = "nodejs";

async function detectTransactionsTillColumn(admin: ReturnType<typeof createSupabaseAdminClient>) {
  const override = (process.env.TX_TILL_COLUMN || "").trim();

  const { data, error } = await admin.from("transactions").select("*").limit(1);
  if (error) throw new Error(error.message);

  const row = (data || [])[0] as Record<string, any> | undefined;
  if (!row) {
    throw new Error("transactions table has no rows; cannot query by till");
  }

  const keys = Object.keys(row);
  const keyMap = new Map(keys.map((k) => [k.toLowerCase(), k] as const));

  if (override) {
    const match = keyMap.get(override.toLowerCase());
    if (!match) {
      throw new Error(`TX_TILL_COLUMN='${override}' not found on transactions. Available columns: ${keys.join(", ")}`);
    }
    return match;
  }

  const preferred = [
    "till_id",
    "tillid",
    "till_number",
    "tillnumber",
    "till_no",
    "tillno",
    "till",
    "short_code",
    "shortcode",
    "business_short_code",
    "business_shortcode",
    "businessshortcode",
    "paybill",
    "paybill_number",
    "paybillnumber",
  ];

  for (const k of preferred) {
    const match = keyMap.get(k);
    if (match) return match;
  }

  const fuzzy = keys.find((k) => {
    const kk = k.toLowerCase();
    return kk.includes("till") || kk.includes("shortcode") || kk.includes("paybill");
  });
  if (fuzzy) return fuzzy;

  throw new Error(`Could not detect till column. Set TX_TILL_COLUMN. Available columns: ${keys.join(", ")}`);
}

function pickString(value: unknown) {
  const s = String(value ?? "").trim();
  return s.length ? s : undefined;
}

function pickNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export async function GET() {
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

  const admin = createSupabaseAdminClient();
  const { data, error: fetchError } = await admin
    .from("sms_campaigns")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (fetchError) {
    return NextResponse.json({ status: "error", message: fetchError.message }, { status: 500 });
  }

  return NextResponse.json({ status: "success", campaigns: data || [] });
}

export async function POST(req: Request) {
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

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const message = pickString(body?.message);
  if (!message) {
    return NextResponse.json({ status: "error", message: "message is required" }, { status: 400 });
  }
  if (message.length > 1000) {
    return NextResponse.json({ status: "error", message: "message too long (max 1000 chars)" }, { status: 400 });
  }

  const name = pickString(body?.name) || `Campaign ${new Date().toISOString()}`;
  const senderId = pickString(body?.senderId) || "fluxsms";

  const segment = (body?.segment && typeof body.segment === "object") ? body.segment : {};
  const tillId = pickString(segment?.tillId);
  const txStatus = pickString(segment?.status);
  const startDate = pickString(segment?.startDate);
  const endDate = pickString(segment?.endDate);
  const amount = pickNumber(segment?.amount);
  const search = pickString(segment?.search);

  const maxScan = Math.min(50000, Math.max(100, Number(body?.maxScan ?? 10000)));

  const admin = createSupabaseAdminClient();

  let tillColumn: string;
  try {
    tillColumn = await detectTransactionsTillColumn(admin);
  } catch (e: any) {
    return NextResponse.json({ status: "error", message: e?.message || "Failed to detect till column" }, { status: 500 });
  }

  let countQuery = admin.from("transactions").select("id", { count: "exact", head: true });
  if (tillId) countQuery = countQuery.eq(tillColumn, tillId);
  if (txStatus) countQuery = countQuery.eq("status", txStatus);
  if (startDate) countQuery = countQuery.gte("created_at", startDate);
  if (endDate) countQuery = countQuery.lte("created_at", endDate);
  if (amount !== undefined) countQuery = countQuery.eq("amount", amount);
  if (search) countQuery = countQuery.or(`phone_number.ilike.%${search}%,reference.ilike.%${search}%`);

  const countRes = await countQuery;
  if (countRes.error) {
    return NextResponse.json({ status: "error", message: countRes.error.message }, { status: 400 });
  }

  const total = countRes.count || 0;
  if (total === 0) {
    return NextResponse.json({ status: "error", message: "No matching transactions" }, { status: 404 });
  }

  if (total > maxScan) {
    return NextResponse.json(
      { status: "error", message: `Too many transactions (${total}). Narrow filters or increase maxScan.` },
      { status: 413 }
    );
  }

  const pageSize = 1000;
  const byPhone = new Map<string, { phoneLocal: string; phoneE164: string; txId: string | null; txStatus: string | null; amount: number | null }>();

  for (let offset = 0; offset < total; offset += pageSize) {
    let q = admin
      .from("transactions")
      .select("id, phone_number, status, amount, created_at")
      .order("created_at", { ascending: false })
      .range(offset, Math.min(offset + pageSize - 1, total - 1));

    if (tillId) q = q.eq(tillColumn, tillId);
    if (txStatus) q = q.eq("status", txStatus);
    if (startDate) q = q.gte("created_at", startDate);
    if (endDate) q = q.lte("created_at", endDate);
    if (amount !== undefined) q = q.eq("amount", amount);
    if (search) q = q.or(`phone_number.ilike.%${search}%,reference.ilike.%${search}%`);

    const { data, error: pageError } = await q;
    if (pageError) {
      return NextResponse.json({ status: "error", message: pageError.message }, { status: 400 });
    }

    for (const row of data || []) {
      const phoneE164 = normalizePhoneE164((row as any)?.phone_number);
      if (!phoneE164) continue;
      if (byPhone.has(phoneE164)) continue;

      const local = toKenyanLocalPhone(phoneE164);
      if (!local) continue;

      byPhone.set(phoneE164, {
        phoneLocal: local,
        phoneE164,
        txId: (row as any)?.id ? String((row as any)?.id) : null,
        txStatus: (row as any)?.status ? String((row as any)?.status) : null,
        amount: (row as any)?.amount === null || (row as any)?.amount === undefined ? null : Number((row as any)?.amount),
      });
    }
  }

  if (byPhone.size === 0) {
    return NextResponse.json({ status: "error", message: "No valid phone numbers found" }, { status: 404 });
  }

  const insertCampaign = await admin
    .from("sms_campaigns")
    .insert({
      name,
      sender_id: senderId,
      message,
      segment: {
        tillId: tillId || null,
        status: txStatus || null,
        startDate: startDate || null,
        endDate: endDate || null,
        amount: amount ?? null,
        search: search || null,
        totalTransactions: total,
      },
      created_by_email: user.email || null,
      status: "draft",
      target_count: byPhone.size,
    })
    .select("*")
    .single();

  if (insertCampaign.error || !insertCampaign.data) {
    return NextResponse.json(
      { status: "error", message: insertCampaign.error?.message || "Failed to create campaign" },
      { status: 500 }
    );
  }

  const campaign = insertCampaign.data as any;

  const rows = Array.from(byPhone.values()).map((p) => ({
    campaign_id: campaign.id,
    phone: p.phoneLocal,
    phone_normalized: p.phoneE164,
    tx_id: p.txId,
    tx_status: p.txStatus,
    amount: p.amount,
    status: "queued",
  }));

  const batchSize = 500;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const ins = await admin.from("sms_messages").insert(chunk);
    if (ins.error) {
      return NextResponse.json({ status: "error", message: ins.error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ status: "success", campaign });
}
