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
  const maxScan = parseIntSafe(url.searchParams.get("maxScan"), 10000);

  if (!tillId) {
    return NextResponse.json({ status: "error", message: "tillId is required" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  const tillColumn = await detectTransactionsTillColumn(admin);

  const buildCountQuery = (tillColumn: string) => {
    let q = admin.from("transactions").select("amount", { count: "exact" }).eq(tillColumn, tillId);
    if (status) q = q.eq("status", status);
    if (startDate) q = q.gte("created_at", startDate);
    if (endDate) q = q.lte("created_at", endDate);
    return q;
  };

  let countRes = await buildCountQuery(tillColumn);
  let total = countRes.count || 0;

  if (countRes.error) {
    return NextResponse.json({ status: "error", message: countRes.error.message }, { status: 400 });
  }
  if (total === 0) {
    return NextResponse.json({ status: "success", total: 0, categories: [] });
  }

  if (total > maxScan) {
    return NextResponse.json(
      {
        status: "error",
        message: `Too many rows (${total}). Narrow date range or increase maxScan.`,
      },
      { status: 413 }
    );
  }

  const pageSize = 1000;
  const amounts: Record<string, number> = {};

  for (let offset = 0; offset < total; offset += pageSize) {
    let q = admin.from("transactions").select("amount").eq(tillColumn, tillId);
    if (status) q = q.eq("status", status);
    if (startDate) q = q.gte("created_at", startDate);
    if (endDate) q = q.lte("created_at", endDate);

    const { data, error: pageError } = await q.range(offset, Math.min(offset + pageSize - 1, total - 1));

    if (pageError) {
      return NextResponse.json({ status: "error", message: pageError.message }, { status: 400 });
    }

    for (const row of data || []) {
      const key = String(row.amount ?? "0");
      amounts[key] = (amounts[key] || 0) + 1;
    }
  }

  const categories = Object.entries(amounts)
    .map(([amount, count]) => ({ amount: Number(amount), count }))
    .sort((a, b) => b.amount - a.amount);

  return NextResponse.json({ status: "success", total, categories });
}
