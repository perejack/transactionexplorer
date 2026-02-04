import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isEmailAllowed } from "@/lib/auth";
import { normalizePhoneE164 } from "@/lib/fluxsms";

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

type StatusBreakdown = {
  total: number;
  success: number;
  failed: number;
  pending: number;
};

type Coverage = {
  recipients_total: number;
  recipients_messaged: number;
  recipients_new: number;
  recipients_delivered: number;
  recipients_failed_only: number;
  recipients_sent_only: number;
};

type AmountCoverageRow = {
  amount: number;
  tx_count: number;
  recipients_total: number;
  recipients_new: number;
  recipients_messaged: number;
};

async function countTransactions(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  tillColumn: string,
  filters: {
    tillId?: string;
    startDate?: string;
    endDate?: string;
    amount?: number;
    search?: string;
    status?: string;
  }
) {
  let q = admin.from("transactions").select("id", { count: "exact", head: true });
  if (filters.tillId) q = q.eq(tillColumn, filters.tillId);
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.startDate) q = q.gte("created_at", filters.startDate);
  if (filters.endDate) q = q.lte("created_at", filters.endDate);
  if (filters.amount !== undefined) q = q.eq("amount", filters.amount);
  if (filters.search) q = q.or(`phone_number.ilike.%${filters.search}%,reference.ilike.%${filters.search}%`);

  const res = await q;
  if (res.error) throw new Error(res.error.message);
  return res.count || 0;
}

async function fetchSmsStatusesForPhones(admin: ReturnType<typeof createSupabaseAdminClient>, phones: string[]) {
  const delivered = new Set<string>();
  const messaged = new Set<string>();
  const failed = new Set<string>();
  const sent = new Set<string>();

  const chunkSize = 500;
  for (let i = 0; i < phones.length; i += chunkSize) {
    const chunk = phones.slice(i, i + chunkSize);

    const { data, error } = await admin
      .from("sms_messages")
      .select("phone_normalized, status")
      .in("phone_normalized", chunk);

    if (error) throw new Error(error.message);

    for (const row of data || []) {
      const p = String((row as any).phone_normalized || "");
      const st = String((row as any).status || "").toLowerCase();
      if (!p) continue;
      messaged.add(p);
      if (st === "delivered") delivered.add(p);
      if (st === "failed") failed.add(p);
      if (st === "sent") sent.add(p);
    }
  }

  const failedOnly = new Set<string>();
  const sentOnly = new Set<string>();

  for (const p of messaged) {
    if (delivered.has(p)) continue;
    if (failed.has(p)) failedOnly.add(p);
    if (sent.has(p)) sentOnly.add(p);
  }

  return {
    delivered,
    messaged,
    failedOnly,
    sentOnly,
  };
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

  const segment = body?.segment && typeof body.segment === "object" ? body.segment : {};

  const tillId = pickString(segment?.tillId);
  const txStatus = pickString(segment?.status);
  const startDate = pickString(segment?.startDate);
  const endDate = pickString(segment?.endDate);
  const amount = pickNumber(segment?.amount);
  const search = pickString(segment?.search);

  const includeStatusBreakdown = Boolean(body?.includeStatusBreakdown ?? true);

  const maxScan = Math.min(50000, Math.max(100, Number(body?.maxScan ?? 10000)));

  const admin = createSupabaseAdminClient();

  let tillColumn: string;
  try {
    tillColumn = await detectTransactionsTillColumn(admin);
  } catch (e: any) {
    return NextResponse.json({ status: "error", message: e?.message || "Failed to detect till column" }, { status: 500 });
  }

  let statusBreakdown: StatusBreakdown | null = null;
  try {
    if (includeStatusBreakdown) {
      const baseFilters = { tillId, startDate, endDate, amount, search };
      const total = await countTransactions(admin, tillColumn, baseFilters);
      const success = await countTransactions(admin, tillColumn, { ...baseFilters, status: "success" });
      const failed = await countTransactions(admin, tillColumn, { ...baseFilters, status: "failed" });
      const pending = await countTransactions(admin, tillColumn, { ...baseFilters, status: "pending" });
      statusBreakdown = { total, success, failed, pending };
    }
  } catch (e: any) {
    return NextResponse.json({ status: "error", message: e?.message || "Failed to compute status breakdown" }, { status: 500 });
  }

  let totalMatching: number;
  try {
    totalMatching = await countTransactions(admin, tillColumn, {
      tillId,
      startDate,
      endDate,
      amount,
      search,
      status: txStatus,
    });
  } catch (e: any) {
    return NextResponse.json({ status: "error", message: e?.message || "Failed to count transactions" }, { status: 400 });
  }

  if (totalMatching === 0) {
    return NextResponse.json({
      status: "success",
      preview: {
        total_transactions: 0,
        recipients_total: 0,
        coverage: {
          recipients_total: 0,
          recipients_messaged: 0,
          recipients_new: 0,
          recipients_delivered: 0,
          recipients_failed_only: 0,
          recipients_sent_only: 0,
        },
        amountCoverage: [],
      },
      statusBreakdown,
    });
  }

  if (totalMatching > maxScan) {
    return NextResponse.json(
      {
        status: "error",
        message: `Too many transactions (${totalMatching}). Narrow filters or increase maxScan.`,
        statusBreakdown,
      },
      { status: 413 }
    );
  }

  const pageSize = 1000;

  const recipients = new Set<string>();
  const amountTxCount = new Map<number, number>();
  const amountPhones = new Map<number, Set<string>>();

  for (let offset = 0; offset < totalMatching; offset += pageSize) {
    let q = admin
      .from("transactions")
      .select("id, phone_number, status, amount, created_at")
      .order("created_at", { ascending: false })
      .range(offset, Math.min(offset + pageSize - 1, totalMatching - 1));

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

      recipients.add(phoneE164);

      const amtRaw = (row as any)?.amount;
      const amt = amtRaw === null || amtRaw === undefined ? null : Number(amtRaw);
      if (amt === null || !Number.isFinite(amt)) continue;

      amountTxCount.set(amt, (amountTxCount.get(amt) || 0) + 1);

      let set = amountPhones.get(amt);
      if (!set) {
        set = new Set<string>();
        amountPhones.set(amt, set);
      }
      set.add(phoneE164);
    }
  }

  const recipientsArr = Array.from(recipients);
  const sms = await fetchSmsStatusesForPhones(admin, recipientsArr);

  const coverage: Coverage = {
    recipients_total: recipientsArr.length,
    recipients_messaged: sms.messaged.size,
    recipients_new: recipientsArr.length - sms.messaged.size,
    recipients_delivered: sms.delivered.size,
    recipients_failed_only: sms.failedOnly.size,
    recipients_sent_only: sms.sentOnly.size,
  };

  const amountCoverage: AmountCoverageRow[] = [];
  for (const [amt, phones] of amountPhones.entries()) {
    const total = phones.size;
    let messaged = 0;
    let newly = 0;
    for (const p of phones) {
      if (sms.messaged.has(p)) messaged += 1;
      else newly += 1;
    }

    amountCoverage.push({
      amount: amt,
      tx_count: amountTxCount.get(amt) || 0,
      recipients_total: total,
      recipients_new: newly,
      recipients_messaged: messaged,
    });
  }

  amountCoverage.sort((a, b) => b.tx_count - a.tx_count);

  return NextResponse.json({
    status: "success",
    statusBreakdown,
    preview: {
      total_transactions: totalMatching,
      recipients_total: recipientsArr.length,
      coverage,
      amountCoverage: amountCoverage.slice(0, 100),
    },
  });
}
