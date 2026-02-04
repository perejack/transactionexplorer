import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isEmailAllowed } from "@/lib/auth";

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
      throw new Error(
        `TX_TILL_COLUMN='${override}' not found on transactions. Available columns: ${keys.join(", ")}`
      );
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
  const tillId = pickString(url.searchParams.get("tillId"));
  const status = pickString(url.searchParams.get("status"));
  const startDate = pickString(url.searchParams.get("startDate"));
  const endDate = pickString(url.searchParams.get("endDate"));
  const search = pickString(url.searchParams.get("search"));
  const amountRaw = pickString(url.searchParams.get("amount"));
  const page = Math.max(1, parseIntSafe(url.searchParams.get("page"), 1));
  const limit = Math.min(200, Math.max(10, parseIntSafe(url.searchParams.get("limit"), 50)));

  if (!tillId) {
    return NextResponse.json({ status: "error", message: "tillId is required" }, { status: 400 });
  }

  const offset = (page - 1) * limit;
  const admin = createSupabaseAdminClient();

  let tillColumn: string;
  try {
    tillColumn = await detectTransactionsTillColumn(admin);
  } catch (e: any) {
    return NextResponse.json({ status: "error", message: e?.message || "Failed to detect till column" }, { status: 500 });
  }

  let query = admin
    .from("transactions")
    .select(
      "id, phone_number, amount, status, reference, transaction_type, mpesa_request_id, checkout_request_id, created_at, completed_at, updated_at",
      { count: "exact" }
    )
    .eq(tillColumn, tillId)
    .order("created_at", { ascending: false });

  if (status) query = query.eq("status", status);
  if (startDate) query = query.gte("created_at", startDate);
  if (endDate) query = query.lte("created_at", endDate);

  if (amountRaw) {
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount)) {
      return NextResponse.json({ status: "error", message: "Invalid amount" }, { status: 400 });
    }
    query = query.eq("amount", amount);
  }

  if (search) {
    query = query.or(`phone_number.ilike.%${search}%,reference.ilike.%${search}%`);
  }

  const res = await query.range(offset, offset + limit - 1);

  if (res.error) {
    return NextResponse.json({ status: "error", message: res.error.message }, { status: 400 });
  }

  return NextResponse.json({
    status: "success",
    page,
    limit,
    total: res.count || 0,
    transactions: res.data || [],
  });
}
