import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth";
import { fluxSmsBalance } from "@/lib/fluxsms";

export const runtime = "nodejs";

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

  try {
    const data = await fluxSmsBalance();
    return NextResponse.json({ status: "success", balance: data?.sms_balance ?? null, raw: data });
  } catch (e: any) {
    return NextResponse.json({ status: "error", message: e?.message || "Failed to fetch balance" }, { status: 500 });
  }
}
