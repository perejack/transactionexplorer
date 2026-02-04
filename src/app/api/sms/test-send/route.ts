import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
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

  const desc = String(res?.["response-description"] || "").toLowerCase();
  const ok = Number(res?.["response-code"]) === 200 || desc === "success" || desc.includes("success");

  let loggedCampaignId: string | null = null;
  try {
    const admin = createSupabaseAdminClient();
    const now = new Date().toISOString();

    const campRes = await admin
      .from("sms_campaigns")
      .insert({
        created_by_email: user.email || null,
        name: `Test SMS ${phoneLocal}`,
        sender_id: senderId || "fluxsms",
        message,
        segment: { mode: "test", phone: phoneE164 },
        status: ok ? "sent" : "failed",
        target_count: 1,
        sent_count: ok ? 1 : 0,
        delivered_count: 0,
        failed_count: ok ? 0 : 1,
        last_dispatch_at: now,
      })
      .select("id")
      .single();

    if (!campRes.error && campRes.data) {
      loggedCampaignId = String((campRes.data as any).id || "") || null;
      if (loggedCampaignId) {
        await admin.from("sms_messages").insert({
          campaign_id: loggedCampaignId,
          phone: phoneLocal,
          phone_normalized: phoneE164,
          tx_id: null,
          tx_status: null,
          amount: null,
          status: ok ? "sent" : "failed",
          flux_message_id: String(res?.messageid || "").trim() || null,
          send_response: res || null,
        });
      }
    }
  } catch {
    loggedCampaignId = null;
  }

  return NextResponse.json({
    status: "success",
    phone: { raw: phoneRaw, e164: phoneE164, local: phoneLocal },
    response: res,
    campaignId: loggedCampaignId,
  });
}
