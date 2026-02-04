import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth";
import { fluxSmsSendSingle, normalizePhoneE164, toKenyanLocalPhone } from "@/lib/fluxsms";

export const runtime = "nodejs";

function pickString(value: unknown) {
  const s = String(value ?? "").trim();
  return s.length ? s : undefined;
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

  const phoneRaw = pickString(body?.phone);
  const message = pickString(body?.message);
  const senderId = pickString(body?.senderId);

  if (!phoneRaw) {
    return NextResponse.json({ status: "error", message: "phone is required" }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ status: "error", message: "message is required" }, { status: 400 });
  }
  if (message.length > 1000) {
    return NextResponse.json({ status: "error", message: "message too long (max 1000 chars)" }, { status: 400 });
  }

  const phoneE164 = normalizePhoneE164(phoneRaw);
  const phoneLocal = toKenyanLocalPhone(phoneE164);
  const looksKenyanE164 = phoneE164.startsWith("254") && (phoneE164.length === 12 || phoneE164.length === 13);
  const looksKenyanLocal = phoneLocal.startsWith("0") && phoneLocal.length === 10;
  if (!phoneE164 || !phoneLocal || !looksKenyanE164 || !looksKenyanLocal) {
    return NextResponse.json({ status: "error", message: "Invalid phone number" }, { status: 400 });
  }

  let res: any = null;
  try {
    res = await fluxSmsSendSingle({ phone: phoneLocal, message, senderId: senderId || undefined });
  } catch (e: any) {
    return NextResponse.json({ status: "error", message: e?.message || "Failed to send SMS" }, { status: 500 });
  }

  return NextResponse.json({
    status: "success",
    phone: { raw: phoneRaw, e164: phoneE164, local: phoneLocal },
    response: res,
  });
}
