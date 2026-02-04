type FluxSmsErrorPayload = {
  error?: string;
  [key: string]: unknown;
};

function pickString(value: unknown) {
  const s = String(value ?? "").trim();
  return s.length ? s : undefined;
}

export function getFluxSmsConfig() {
  const apiKey = pickString(process.env.FLUXSMS_API_KEY);
  const senderId = pickString(process.env.FLUXSMS_SENDER_ID) || "fluxsms";

  if (!apiKey) {
    throw new Error("Missing FLUXSMS_API_KEY");
  }

  return { apiKey, senderId, baseUrl: "https://api.fluxsms.co.ke" } as const;
}

async function postJson<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const cfg = getFluxSmsConfig();
  const url = `${cfg.baseUrl}${path}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...payload, api_key: cfg.apiKey }),
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const msg = (json as FluxSmsErrorPayload | null)?.error || `FluxSMS request failed (${res.status})`;
    throw new Error(msg);
  }

  if (json && typeof json === "object" && "error" in json && (json as any).error) {
    throw new Error(String((json as any).error));
  }

  return json as T;
}

export type FluxSmsSendSingleResponse = {
  "response-code"?: number;
  "response-description"?: string;
  mobile?: string | number;
  messageid?: string;
  networkid?: number;
  error?: string;
  [key: string]: unknown;
};

export async function fluxSmsSendSingle(params: { phone: string; message: string; senderId?: string }) {
  const cfg = getFluxSmsConfig();
  return postJson<FluxSmsSendSingleResponse>("/sendsms", {
    phone: params.phone,
    message: params.message,
    sender_id: params.senderId || cfg.senderId,
  });
}

export type FluxSmsBulkResponse = {
  success?: boolean;
  sent?: number;
  responses?: Array<{
    "response-code"?: number;
    "response-description"?: string;
    mobile?: string | number;
    messageid?: string;
    clientsmsid?: number;
    networkid?: number;
    error?: string;
    [key: string]: unknown;
  }>;
  error?: string;
  [key: string]: unknown;
};

export async function fluxSmsSendBulk(params: { phones: string[]; message: string; senderId?: string }) {
  const cfg = getFluxSmsConfig();
  return postJson<FluxSmsBulkResponse>("/bulksms", {
    phones: params.phones,
    message: params.message,
    sender_id: params.senderId || cfg.senderId,
  });
}

export type FluxSmsStatusResponse = {
  "response-code"?: number;
  "message-id"?: string;
  "response-description"?: string;
  "delivery-status"?: number;
  "delivery-description"?: string;
  "delivery-tat"?: string;
  "delivery-networkid"?: number;
  "delivery-time"?: string;
  [key: string]: unknown;
};

export async function fluxSmsStatus(params: { messageId: string }) {
  return postJson<FluxSmsStatusResponse>("/smsstatus", {
    message_id: params.messageId,
  });
}

export type FluxSmsBalanceResponse = {
  success?: boolean;
  sms_balance?: number;
  error?: string;
  [key: string]: unknown;
};

export async function fluxSmsBalance() {
  return postJson<FluxSmsBalanceResponse>("/check_sms_balance", {});
}

export function normalizePhoneDigits(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/\D/g, "");
}

export function normalizePhoneE164(value: string | null | undefined) {
  const digits = normalizePhoneDigits(value);
  if (!digits) return "";
  if (digits.startsWith("254") && (digits.length === 12 || digits.length === 13)) return digits;
  if (digits.startsWith("0") && digits.length === 10) return `254${digits.slice(1)}`;
  if ((digits.startsWith("7") || digits.startsWith("1")) && digits.length === 9) return `254${digits}`;
  return digits;
}

export function toKenyanLocalPhone(value: string | null | undefined) {
  const e164 = normalizePhoneE164(value);
  if (!e164) return "";
  if (e164.startsWith("254") && e164.length >= 12) return `0${e164.slice(3)}`;
  if (e164.startsWith("0")) return e164;
  return e164;
}
