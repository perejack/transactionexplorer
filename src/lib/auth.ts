export function normalizeEmailsList(value: string | undefined) {
  return (value || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isEmailAllowed(email: string | null | undefined) {
  const allowlist = normalizeEmailsList(process.env.TX_ALLOWED_EMAILS);
  if (allowlist.length === 0) return true;
  const normalized = String(email || "").trim().toLowerCase();
  return Boolean(normalized) && allowlist.includes(normalized);
}
