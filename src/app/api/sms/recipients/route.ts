import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isEmailAllowed } from "@/lib/auth";
import { normalizePhoneE164, toKenyanLocalPhone } from "@/lib/fluxsms";

export const runtime = "nodejs";

function pickString(value: unknown) {
  const s = String(value ?? "").trim();
  return s.length ? s : undefined;
}

function pickNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseIntSafe(value: unknown, fallback: number) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

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

function parseUtcDateRange(date: string) {
  const start = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime())) return null;
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function parseLocalDateRange(date: string, tzOffsetMin: number) {
  const startLocal = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(startLocal.getTime())) return null;

  const startUtcMs = startLocal.getTime() + tzOffsetMin * 60_000;
  const endUtcMs = startUtcMs + 24 * 60 * 60_000;
  return { startIso: new Date(startUtcMs).toISOString(), endIso: new Date(endUtcMs).toISOString() };
}

type RecipientRow = {
  phone_e164: string;
  phone_local: string;
  last_tx_at: string;
  tx_count: number;
  success_count: number;
  failed_count: number;
  pending_count: number;
  amount_sum: number;
  sms_ever_count: number;
  sms_ever_delivered: number;
  sms_ever_failed: number;
  sms_ever_sent: number;
  sms_ever_last_status: string | null;
  sms_ever_last_at: string | null;
  sms_day_count: number;
  sms_day_delivered: number;
  sms_day_failed: number;
  sms_day_sent: number;
  sms_day_last_status: string | null;
  sms_day_last_at: string | null;
};

async function fetchSmsStats(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  phones: string[],
  dateRange: { startIso: string; endIso: string } | null
) {
  const chunkSize = 500;
  const ever = new Map<
    string,
    {
      count: number;
      delivered: number;
      failed: number;
      sent: number;
      lastStatus: string | null;
      lastAt: string | null;
    }
  >();

  const day = new Map<
    string,
    {
      count: number;
      delivered: number;
      failed: number;
      sent: number;
      lastStatus: string | null;
      lastAt: string | null;
    }
  >();

  for (let i = 0; i < phones.length; i += chunkSize) {
    const chunk = phones.slice(i, i + chunkSize);

    const { data, error } = await admin
      .from("sms_messages")
      .select("phone_normalized, status, created_at")
      .in("phone_normalized", chunk);

    if (error) throw new Error(error.message);

    for (const row of data || []) {
      const p = String((row as any).phone_normalized || "");
      if (!p) continue;
      const st = String((row as any).status || "").toLowerCase();
      const at = (row as any).created_at ? String((row as any).created_at) : null;

      const e = ever.get(p) || {
        count: 0,
        delivered: 0,
        failed: 0,
        sent: 0,
        lastStatus: null,
        lastAt: null,
      };

      e.count += 1;
      if (st === "delivered") e.delivered += 1;
      if (st === "failed") e.failed += 1;
      if (st === "sent") e.sent += 1;

      if (at && (!e.lastAt || at > e.lastAt)) {
        e.lastAt = at;
        e.lastStatus = st;
      }

      ever.set(p, e);

      if (dateRange && at && at >= dateRange.startIso && at < dateRange.endIso) {
        const d = day.get(p) || {
          count: 0,
          delivered: 0,
          failed: 0,
          sent: 0,
          lastStatus: null,
          lastAt: null,
        };

        d.count += 1;
        if (st === "delivered") d.delivered += 1;
        if (st === "failed") d.failed += 1;
        if (st === "sent") d.sent += 1;

        if (at && (!d.lastAt || at > d.lastAt)) {
          d.lastAt = at;
          d.lastStatus = st;
        }

        day.set(p, d);
      }
    }
  }

  return { ever, day };
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
  const date = pickString(url.searchParams.get("date"));
  const tzOffsetMin = Math.max(-14 * 60, Math.min(14 * 60, parseIntSafe(url.searchParams.get("tzOffsetMin"), -180)));
  const startDate = pickString(url.searchParams.get("startDate"));
  const endDate = pickString(url.searchParams.get("endDate"));
  const txStatus = pickString(url.searchParams.get("status"));
  const tillId = pickString(url.searchParams.get("tillId"));
  const amount = pickNumber(url.searchParams.get("amount"));
  const search = pickString(url.searchParams.get("search"));

  const page = Math.max(1, parseIntSafe(url.searchParams.get("page"), 1));
  const limit = Math.min(200, Math.max(10, parseIntSafe(url.searchParams.get("limit"), 50)));
  const maxScan = Math.min(50000, Math.max(100, parseIntSafe(url.searchParams.get("maxScan"), 20000)));

  let dateRange: { startIso: string; endIso: string } | null = null;
  if (date) {
    dateRange = tzOffsetMin ? parseLocalDateRange(date, tzOffsetMin) : parseUtcDateRange(date);
    if (!dateRange) {
      return NextResponse.json({ status: "error", message: "Invalid date" }, { status: 400 });
    }
  } else if (startDate && endDate) {
    dateRange = { startIso: startDate, endIso: endDate };
  }

  if (!dateRange) {
    return NextResponse.json({ status: "error", message: "date or startDate/endDate is required" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  let tillColumn: string;
  try {
    tillColumn = await detectTransactionsTillColumn(admin);
  } catch (e: any) {
    return NextResponse.json({ status: "error", message: e?.message || "Failed to detect till column" }, { status: 500 });
  }

  let countQuery = admin.from("transactions").select("id", { count: "exact", head: true });
  countQuery = countQuery.gte("created_at", dateRange.startIso).lt("created_at", dateRange.endIso);
  if (tillId) countQuery = countQuery.eq(tillColumn, tillId);
  if (txStatus) countQuery = countQuery.eq("status", txStatus);
  if (amount !== undefined) countQuery = countQuery.eq("amount", amount);
  if (search) countQuery = countQuery.or(`phone_number.ilike.%${search}%,reference.ilike.%${search}%`);

  const countRes = await countQuery;
  if (countRes.error) {
    return NextResponse.json({ status: "error", message: countRes.error.message }, { status: 400 });
  }

  const totalTx = countRes.count || 0;
  if (totalTx === 0) {
    return NextResponse.json({ status: "success", total: 0, recipients: [], summary: { totalTx: 0, recipients: 0 } });
  }

  if (totalTx > maxScan) {
    return NextResponse.json(
      { status: "error", message: `Too many transactions (${totalTx}). Narrow filters or increase maxScan.` },
      { status: 413 }
    );
  }

  const pageSize = 1000;
  const byPhone = new Map<
    string,
    {
      phone_e164: string;
      phone_local: string;
      last_tx_at: string;
      tx_count: number;
      success_count: number;
      failed_count: number;
      pending_count: number;
      amount_sum: number;
    }
  >();

  let txSuccess = 0;
  let txFailed = 0;
  let txPending = 0;

  for (let offset = 0; offset < totalTx; offset += pageSize) {
    let q = admin
      .from("transactions")
      .select("id, phone_number, status, amount, created_at")
      .order("created_at", { ascending: false })
      .range(offset, Math.min(offset + pageSize - 1, totalTx - 1));

    q = q.gte("created_at", dateRange.startIso).lt("created_at", dateRange.endIso);
    if (tillId) q = q.eq(tillColumn, tillId);
    if (txStatus) q = q.eq("status", txStatus);
    if (amount !== undefined) q = q.eq("amount", amount);
    if (search) q = q.or(`phone_number.ilike.%${search}%,reference.ilike.%${search}%`);

    const { data, error: pageError } = await q;
    if (pageError) {
      return NextResponse.json({ status: "error", message: pageError.message }, { status: 400 });
    }

    for (const row of data || []) {
      const st = String((row as any)?.status || "").toLowerCase();
      if (st === "success") txSuccess += 1;
      if (st === "failed") txFailed += 1;
      if (st === "pending") txPending += 1;

      const phoneE164 = normalizePhoneE164((row as any)?.phone_number);
      if (!phoneE164) continue;
      const local = toKenyanLocalPhone(phoneE164);
      if (!local) continue;

      const createdAt = (row as any)?.created_at ? String((row as any)?.created_at) : "";
      const amtRaw = (row as any)?.amount;
      const amt = amtRaw === null || amtRaw === undefined ? 0 : Number(amtRaw);

      const cur = byPhone.get(phoneE164) || {
        phone_e164: phoneE164,
        phone_local: local,
        last_tx_at: createdAt,
        tx_count: 0,
        success_count: 0,
        failed_count: 0,
        pending_count: 0,
        amount_sum: 0,
      };

      cur.tx_count += 1;
      if (createdAt && (!cur.last_tx_at || createdAt > cur.last_tx_at)) cur.last_tx_at = createdAt;
      if (st === "success") cur.success_count += 1;
      if (st === "failed") cur.failed_count += 1;
      if (st === "pending") cur.pending_count += 1;
      if (Number.isFinite(amt)) cur.amount_sum += amt;

      byPhone.set(phoneE164, cur);
    }
  }

  const phones = Array.from(byPhone.keys());
  let smsStats: Awaited<ReturnType<typeof fetchSmsStats>>;
  try {
    smsStats = await fetchSmsStats(admin, phones, dateRange);
  } catch (e: any) {
    return NextResponse.json({ status: "error", message: e?.message || "Failed to load SMS stats" }, { status: 500 });
  }

  const rows: RecipientRow[] = [];
  let recipientsMessagedEver = 0;
  let recipientsNewEver = 0;

  for (const [phone, base] of byPhone.entries()) {
    const ever = smsStats.ever.get(phone) || {
      count: 0,
      delivered: 0,
      failed: 0,
      sent: 0,
      lastStatus: null,
      lastAt: null,
    };

    const day = smsStats.day.get(phone) || {
      count: 0,
      delivered: 0,
      failed: 0,
      sent: 0,
      lastStatus: null,
      lastAt: null,
    };

    if (ever.count > 0) recipientsMessagedEver += 1;
    else recipientsNewEver += 1;

    rows.push({
      ...base,
      sms_ever_count: ever.count,
      sms_ever_delivered: ever.delivered,
      sms_ever_failed: ever.failed,
      sms_ever_sent: ever.sent,
      sms_ever_last_status: ever.lastStatus,
      sms_ever_last_at: ever.lastAt,
      sms_day_count: day.count,
      sms_day_delivered: day.delivered,
      sms_day_failed: day.failed,
      sms_day_sent: day.sent,
      sms_day_last_status: day.lastStatus,
      sms_day_last_at: day.lastAt,
    });
  }

  rows.sort((a, b) => (a.last_tx_at > b.last_tx_at ? -1 : a.last_tx_at < b.last_tx_at ? 1 : 0));

  const totalRecipients = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRecipients / limit));
  const safePage = Math.min(totalPages, Math.max(1, page));
  const startIdx = (safePage - 1) * limit;
  const pageRows = rows.slice(startIdx, startIdx + limit);

  return NextResponse.json({
    status: "success",
    total: totalRecipients,
    page: safePage,
    limit,
    recipients: pageRows,
    summary: {
      totalTx,
      txSuccess,
      txFailed,
      txPending,
      recipients: totalRecipients,
      recipientsMessagedEver,
      recipientsNewEver,
    },
  });
}
