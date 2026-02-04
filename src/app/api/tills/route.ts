import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isEmailAllowed } from "@/lib/auth";

 function pickString(value: string | null) {
   const s = (value || "").trim();
   return s.length ? s : undefined;
 }

 async function detectTransactionsTillColumn(admin: ReturnType<typeof createSupabaseAdminClient>) {
  const override = (process.env.TX_TILL_COLUMN || "").trim();

  const { data, error } = await admin.from("transactions").select("*").limit(1);
  if (error) throw new Error(error.message);

  const row = (data || [])[0] as Record<string, any> | undefined;
  if (!row) {
    throw new Error("transactions table has no rows; cannot derive tills");
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

  throw new Error(
    `Could not detect a till column in transactions table. Set TX_TILL_COLUMN in .env.local. Available columns: ${keys.join(", ")}`
  );
 }

 async function deriveTillsFromTransactions(params: {
   admin: ReturnType<typeof createSupabaseAdminClient>;
   view: string;
 }) {
   const { admin, view } = params;

   if (view === "suspended") {
     return [] as Array<{ id: string; till_name: string; till_number: string; created_at: string | null }>;
   }

   const tillColumn = await detectTransactionsTillColumn(admin);

   let countQuery = admin.from("transactions").select(tillColumn, { count: "exact" }).not(tillColumn, "is", null);
   const { count, error: countError } = await countQuery;
   if (countError) {
     throw new Error(countError.message);
   }

   const total = count || 0;
   if (total === 0) return [];

   const maxScan = 20000;
   if (total > maxScan) {
     throw new Error(
       `Too many transactions (${total}) to derive tills. Create a public.tills table or reduce data volume.`
     );
   }

   const pageSize = 1000;
   const unique = new Set<string>();

   for (let offset = 0; offset < total; offset += pageSize) {
     const { data, error } = await admin
       .from("transactions")
       .select(tillColumn)
       .not(tillColumn, "is", null)
       .range(offset, Math.min(offset + pageSize - 1, total - 1));

     if (error) throw new Error(error.message);
     for (const row of data || []) {
       const value = (row as any)?.[tillColumn];
       if (value === null || value === undefined) continue;
       unique.add(String(value));
     }
   }

   return Array.from(unique)
     .sort()
     .map((v) => ({
       id: v,
       till_name: `Till ${v}`,
       till_number: v,
       created_at: null,
     }));
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

  const admin = createSupabaseAdminClient();
 const url = new URL(req.url);
 const view = (pickString(url.searchParams.get("view")) || "all").toLowerCase();

  let data: any[] | null = null;
  let fetchError: any = null;

  const initial = await admin
    .from("tills")
    .select("id, till_name, till_number, created_at, status")
    .order("created_at", { ascending: false });
  data = (initial as any).data;
  fetchError = (initial as any).error;

  if (fetchError) {
    let msg = String(fetchError.message || "").toLowerCase();
    if (msg.includes("column") && msg.includes("status") && msg.includes("does not exist")) {
      const retry = await admin
        .from("tills")
        .select("id, till_name, till_number, created_at, is_suspended")
        .order("created_at", { ascending: false });
      data = (retry as any).data;
      fetchError = (retry as any).error;
      msg = String(fetchError?.message || "").toLowerCase();

      if (fetchError && msg.includes("column") && msg.includes("is_suspended") && msg.includes("does not exist")) {
        const retry2 = await admin
          .from("tills")
          .select("id, till_name, till_number, created_at")
          .order("created_at", { ascending: false });
        data = (retry2 as any).data;
        fetchError = (retry2 as any).error;
      }
    }
  }

  if (fetchError) {
    const msg = String(fetchError.message || "").toLowerCase();
    if (msg.includes("could not find") && msg.includes("tills") && msg.includes("schema cache")) {
      try {
        const tills = await deriveTillsFromTransactions({ admin, view });
        return NextResponse.json({ status: "success", tills, source: "transactions" });
      } catch (e: any) {
        return NextResponse.json(
          { status: "error", message: e?.message || "Failed to derive tills from transactions" },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ status: "error", message: fetchError.message }, { status: 500 });
  }

  const raw = (data || []) as any[];
  const tills = raw.filter((t) => {
    const isSuspended = Boolean(t?.is_suspended) || String(t?.status || "").toLowerCase() === "suspended";
    if (view === "active") return !isSuspended;
    if (view === "suspended") return isSuspended;
    return true;
  });

  return NextResponse.json({ status: "success", tills, source: "tills" });
}
