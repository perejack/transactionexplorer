"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  RefreshCw,
  Send,
  MessageCircle,
  Wallet,
  Filter,
  Loader2,
  LogOut,
  Search,
  Calendar,
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { formatDateTime, formatMoney } from "@/lib/format";

type AmountCategory = {
  amount: number;
  count: number;
};

type AmountCoverageRow = {
  amount: number;
  tx_count: number;
  recipients_total: number;
  recipients_new: number;
  recipients_messaged: number;
};

type DailyAmountCoverageRow = {
  amount: number;
  tx_count: number;
  recipients_total: number;
  recipients_new_ever: number;
};

type SegmentStatusBreakdown = {
  total: number;
  success: number;
  failed: number;
  pending: number;
};

type SegmentCoverage = {
  recipients_total: number;
  recipients_messaged: number;
  recipients_new: number;
  recipients_delivered: number;
  recipients_failed_only: number;
  recipients_sent_only: number;
};

type SegmentPreview = {
  total_transactions: number;
  recipients_total: number;
  coverage?: SegmentCoverage;
  amountCoverage?: AmountCoverageRow[];
};

type DailyRecipientRow = {
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

type DailyRecipientsSummary = {
  totalTx: number;
  txSuccess: number;
  txFailed: number;
  txPending: number;
  recipients: number;
  recipientsMessagedEver: number;
  recipientsNewEver: number;
};

function AmountChip({
  active,
  amount,
  txCount,
  newCount,
  onClick,
}: {
  active: boolean;
  amount: number;
  txCount: number;
  newCount: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-semibold transition",
        active
          ? "border-indigo-400/40 bg-indigo-500/15 text-indigo-100 ring-1 ring-indigo-400/30"
          : "border-white/10 bg-white/5 text-zinc-100 hover:bg-white/10"
      )}
    >
      <span className="tabular-nums">{formatMoney(amount)}</span>
      <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[11px] font-bold text-zinc-200">
        {txCount}
      </span>
      <span
        className={cn(
          "rounded-full border px-2 py-0.5 text-[11px] font-bold tabular-nums",
          newCount > 0
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
            : "border-white/10 bg-black/20 text-zinc-400"
        )}
        title="Recipients with no previous SMS messages"
      >
        new {newCount}
      </span>
    </button>
  );
}

function parseAmountInput(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  const cleaned = raw.replace(/[,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

type Till = {
  id: string;
  till_name: string;
  till_number: string;
  created_at: string;
};

type Campaign = {
  id: string;
  created_at: string;
  created_by_email: string | null;
  name: string | null;
  sender_id: string;
  message: string;
  segment: any;
  status: string;
  target_count: number;
  sent_count: number;
  delivered_count: number;
  failed_count: number;
  last_dispatch_at: string | null;
  last_refresh_at: string | null;
};

type CampaignCounts = {
  queued?: number;
  sent?: number;
  delivered?: number;
  failed?: number;
};

type SmsMessageRow = {
  id: string;
  created_at: string;
  phone: string;
  phone_normalized: string;
  tx_id: string | null;
  tx_status: string | null;
  amount: number | null;
  status: string;
  flux_message_id: string | null;
  delivery_status_text: string | null;
  delivery_status_code: number | null;
};

function StatusPill({ value }: { value: string }) {
  const v = String(value || "").toLowerCase();
  const cls =
    v === "delivered" || v === "success"
      ? "bg-emerald-500/15 text-emerald-200 border-emerald-500/30"
      : v === "failed"
      ? "bg-rose-500/15 text-rose-200 border-rose-500/30"
      : v === "sent" || v === "sending"
      ? "bg-indigo-500/15 text-indigo-200 border-indigo-500/30"
      : "bg-amber-500/15 text-amber-200 border-amber-500/30";

  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold", cls)}>
      {v || "unknown"}
    </span>
  );
}

function IconButton({
  children,
  onClick,
  title,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-zinc-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60",
      )}
    >
      {children}
    </button>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">{label}</div>
      <div className="mt-1 text-sm text-zinc-100">{value}</div>
    </div>
  );
}

export default function SmsDashboardPage() {
  const router = useRouter();

  const [supabase, setSupabase] = useState<ReturnType<typeof createSupabaseBrowserClient> | null>(null);

  const [toast, setToast] = useState<string | null>(null);

  const [autoRefresh, setAutoRefresh] = useState(false);
  const [autoRefreshSec, setAutoRefreshSec] = useState(15);

  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  const [tills, setTills] = useState<Till[]>([]);
  const [tillsLoading, setTillsLoading] = useState(false);

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);

  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [selectedCounts, setSelectedCounts] = useState<CampaignCounts | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);

  const [messages, setMessages] = useState<SmsMessageRow[]>([]);
  const [messagesTotal, setMessagesTotal] = useState(0);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesPage, setMessagesPage] = useState(1);
  const [messagesLimit] = useState(50);
  const [messagesStatus, setMessagesStatus] = useState<string>("");

  const [formName, setFormName] = useState<string>("");
  const [formSenderId, setFormSenderId] = useState<string>("fluxsms");
  const [formMessage, setFormMessage] = useState<string>("");

  const [segTillId, setSegTillId] = useState<string>("");
  const [segStatus, setSegStatus] = useState<string>("");
  const [segStartDate, setSegStartDate] = useState<string>("");
  const [segEndDate, setSegEndDate] = useState<string>("");
  const [segAmount, setSegAmount] = useState<string>("");
  const [segSearch, setSegSearch] = useState<string>("");
  const [maxScan, setMaxScan] = useState<string>("50000");

  const [segmentBreakdown, setSegmentBreakdown] = useState<SegmentStatusBreakdown | null>(null);
  const [segmentBasePreview, setSegmentBasePreview] = useState<SegmentPreview | null>(null);
  const [segmentPreview, setSegmentPreview] = useState<SegmentPreview | null>(null);
  const [segmentPreviewLoading, setSegmentPreviewLoading] = useState(false);
  const [showOnlyNewAmounts, setShowOnlyNewAmounts] = useState(false);

  const [createLoading, setCreateLoading] = useState(false);

  const [dispatchLoading, setDispatchLoading] = useState(false);
  const [dispatchMaxRecipients, setDispatchMaxRecipients] = useState<string>("300");

  const [refreshLoading, setRefreshLoading] = useState(false);
  const [refreshLimit, setRefreshLimit] = useState<string>("20");

  const [amountCategories, setAmountCategories] = useState<AmountCategory[]>([]);

  const [dailyDate, setDailyDate] = useState<string>("");
  const [dailyStatus, setDailyStatus] = useState<string>("success");
  const [dailyTillId, setDailyTillId] = useState<string>("");
  const [dailyAmount, setDailyAmount] = useState<string>("");
  const [dailySearch, setDailySearch] = useState<string>("");
  const [dailyRows, setDailyRows] = useState<DailyRecipientRow[]>([]);
  const [dailyTotal, setDailyTotal] = useState(0);
  const [dailySummary, setDailySummary] = useState<DailyRecipientsSummary | null>(null);
  const [dailyAmountCoverage, setDailyAmountCoverage] = useState<DailyAmountCoverageRow[]>([]);
  const [dailyShowOnlyNewAmounts, setDailyShowOnlyNewAmounts] = useState(false);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyPage, setDailyPage] = useState(1);
  const [dailyLimit] = useState(50);
  const [dailySelected, setDailySelected] = useState<Record<string, true>>({});
  const [dailyCreateLoading, setDailyCreateLoading] = useState(false);

  useEffect(() => {
    try {
      setSupabase(createSupabaseBrowserClient());
    } catch (err: any) {
      setToast(err?.message || "Missing Supabase environment variables");
    }
  }, []);

  useEffect(() => {
    if (dailyDate) return;
    const kenyaNow = new Date(Date.now() + 3 * 60 * 60_000);
    const y = kenyaNow.getUTCFullYear();
    const m = String(kenyaNow.getUTCMonth() + 1).padStart(2, "0");
    const day = String(kenyaNow.getUTCDate()).padStart(2, "0");
    setDailyDate(`${y}-${m}-${day}`);
  }, [dailyDate]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const loadBalance = async (opts?: { silent?: boolean }) => {
    setBalanceLoading(true);
    try {
      const res = await fetch("/api/sms/balance", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          router.replace("/login");
          return;
        }

        if (!opts?.silent) setToast(json?.message || "Failed to load SMS balance");
        setBalance(null);
        return;
      }
      const v = json?.balance;
      setBalance(typeof v === "number" ? v : v === null ? null : Number(v));
    } finally {
      setBalanceLoading(false);
    }
  };

  const onCreateCampaignFromDailySelection = async (opts?: { dispatch?: boolean }) => {
    const recipients = Object.keys(dailySelected);
    if (recipients.length === 0) {
      setToast("Select at least one recipient");
      return;
    }

    if (!formMessage.trim()) {
      setToast("Message is required");
      return;
    }

    if (recipients.length > 1000) {
      setToast("Too many recipients selected (max 1000)");
      return;
    }

    setDailyCreateLoading(true);
    try {
      const baseName = formName || `Daily ${dailyDate} ${dailyStatus || "all"}`;

      const res = await fetch("/api/sms/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: baseName,
          senderId: formSenderId || undefined,
          message: formMessage,
          recipients,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast(json?.message || "Failed to create campaign");
        return;
      }

      const id = String(json?.campaign?.id || "");
      setToast("Campaign created");
      await loadCampaigns();
      if (id) setSelectedCampaignId(id);

      if (opts?.dispatch && id) {
        const mr = Math.min(1000, Math.max(1, recipients.length));
        const dres = await fetch(`/api/sms/campaigns/${id}/dispatch`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ maxRecipients: mr }),
        });
        const djson = await dres.json().catch(() => ({}));
        if (!dres.ok) {
          setToast(djson?.message || "Dispatch failed");
        } else {
          setToast(`Dispatched ${djson?.dispatched ?? 0}`);
        }
        await loadCampaigns();
      }
    } finally {
      setDailyCreateLoading(false);
    }
  };

  const loadTills = async (opts?: { silent?: boolean }) => {
    setTillsLoading(true);
    try {
      const url = new URL("/api/tills", window.location.origin);
      url.searchParams.set("view", "active");
      const res = await fetch(url.toString(), { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (!opts?.silent) setToast(json?.message || "Failed to load tills");
        setTills([]);
        return;
      }
      setTills((json?.tills || []) as Till[]);
    } finally {
      setTillsLoading(false);
    }
  };

  const loadCampaigns = async (opts?: { silent?: boolean }) => {
    setCampaignsLoading(true);
    try {
      const res = await fetch("/api/sms/campaigns", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (!opts?.silent) setToast(json?.message || "Failed to load campaigns");
        setCampaigns([]);
        return;
      }
      setCampaigns((json?.campaigns || []) as Campaign[]);
    } finally {
      setCampaignsLoading(false);
    }
  };

  const loadCampaignDetail = useCallback(
    async (campaignId: string, opts?: { silent?: boolean }) => {
      setSelectedLoading(true);
      try {
        const res = await fetch(`/api/sms/campaigns/${campaignId}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (res.status === 401) {
            router.replace("/login");
            return;
          }
          if (!opts?.silent) setToast(json?.message || "Failed to load campaign");
          setSelectedCampaign(null);
          setSelectedCounts(null);
          return;
        }
        setSelectedCampaign(json?.campaign || null);
        setSelectedCounts(json?.counts || null);
      } finally {
        setSelectedLoading(false);
      }
    },
    [router]
  );

  const loadMessagesForCampaign = useCallback(
    async (campaignId: string, opts?: { silent?: boolean }) => {
      setMessagesLoading(true);
      try {
        const url = new URL(`/api/sms/campaigns/${campaignId}/messages`, window.location.origin);
        url.searchParams.set("page", String(messagesPage));
        url.searchParams.set("limit", String(messagesLimit));
        if (messagesStatus) url.searchParams.set("status", messagesStatus);

        const res = await fetch(url.toString(), { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (res.status === 401) {
            router.replace("/login");
            return;
          }
          if (!opts?.silent) setToast(json?.message || "Failed to load messages");
          setMessages([]);
          setMessagesTotal(0);
          return;
        }
        setMessages((json?.messages || []) as SmsMessageRow[]);
        setMessagesTotal(Number(json?.total || 0));
      } finally {
        setMessagesLoading(false);
      }
    },
    [messagesLimit, messagesPage, messagesStatus, router]
  );

  useEffect(() => {
    loadBalance();
    loadTills();
    loadCampaigns();
  }, []);

  const dailyKey = useMemo(
    () =>
      JSON.stringify({
        dailyDate,
        dailyStatus,
        dailyTillId,
        dailyAmount,
        dailySearch,
        dailyPage,
        dailyLimit,
      }),
    [dailyAmount, dailyDate, dailyLimit, dailyPage, dailySearch, dailyStatus, dailyTillId]
  );

  useEffect(() => {
    if (!dailyDate) return;
    const load = async () => {
      setDailyLoading(true);
      try {
        const url = new URL("/api/sms/recipients", window.location.origin);
        url.searchParams.set("date", dailyDate);
        url.searchParams.set("tzOffsetMin", "-180");
        url.searchParams.set("includeAmountCoverage", "1");
        url.searchParams.set("page", String(dailyPage));
        url.searchParams.set("limit", String(dailyLimit));
        if (dailyStatus) url.searchParams.set("status", dailyStatus);
        if (dailyTillId) url.searchParams.set("tillId", dailyTillId);
        if (dailySearch) url.searchParams.set("search", dailySearch);

        const amountNum = parseAmountInput(dailyAmount);
        if (amountNum !== undefined) url.searchParams.set("amount", String(amountNum));

        const res = await fetch(url.toString(), { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setDailyRows([]);
          setDailyTotal(0);
          setDailySummary(null);
          setDailyAmountCoverage([]);
          setToast(json?.message || "Failed to load daily recipients");
          return;
        }

        setDailyRows((json?.recipients || []) as DailyRecipientRow[]);
        setDailyTotal(Number(json?.total || 0));
        setDailySummary((json?.summary || null) as any);
        setDailyAmountCoverage((json?.amountCoverage || []) as any);
      } finally {
        setDailyLoading(false);
      }
    };

    load();
  }, [dailyKey]);

  useEffect(() => {
    setDailyPage(1);
    setDailySelected({});
  }, [dailyDate, dailyStatus, dailyTillId, dailyAmount, dailySearch]);

  useEffect(() => {
    const load = async () => {
      try {
        const url = new URL("/api/amount-categories", window.location.origin);
        if (segTillId) url.searchParams.set("tillId", segTillId);
        if (segStatus) url.searchParams.set("status", segStatus);
        if (segStartDate) url.searchParams.set("startDate", segStartDate);
        if (segEndDate) url.searchParams.set("endDate", segEndDate);

        const res = await fetch(url.toString(), { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setAmountCategories([]);
          return;
        }
        setAmountCategories((json?.categories || []) as AmountCategory[]);
      } catch {
        setAmountCategories([]);
      }
    };

    load();
  }, [segTillId, segStatus, segStartDate, segEndDate]);

  const basePreviewKey = useMemo(
    () =>
      JSON.stringify({
        segTillId,
        segStatus,
        segStartDate,
        segEndDate,
        segSearch,
        maxScan,
      }),
    [segTillId, segStatus, segStartDate, segEndDate, segSearch, maxScan]
  );

  const previewKey = useMemo(
    () =>
      JSON.stringify({
        segTillId,
        segStatus,
        segStartDate,
        segEndDate,
        segSearch,
        segAmount,
        maxScan,
      }),
    [segTillId, segStatus, segStartDate, segEndDate, segSearch, segAmount, maxScan]
  );

  const loadSegmentPreview = useCallback(
    async (opts?: { silent?: boolean }) => {
      setSegmentPreviewLoading(true);
      try {
        const max = Number(maxScan || 50000);

        const baseBody = {
          segment: {
            tillId: segTillId || undefined,
            status: segStatus || undefined,
            startDate: segStartDate || undefined,
            endDate: segEndDate || undefined,
            search: segSearch || undefined,
          },
          maxScan: Number.isFinite(max) ? max : 50000,
          includeStatusBreakdown: true,
        };

        const baseRes = await fetch("/api/sms/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(baseBody),
        });
        const baseJson = await baseRes.json().catch(() => ({}));
        if (!baseRes.ok) {
          if (!opts?.silent) setToast(baseJson?.message || "Failed to load segment preview");
          if (baseJson?.statusBreakdown) {
            setSegmentBreakdown((baseJson.statusBreakdown || null) as any);
          }
          return;
        }

        setSegmentBreakdown((baseJson?.statusBreakdown || null) as any);
        setSegmentBasePreview((baseJson?.preview || null) as any);

        const amountValue = segAmount.trim();
        const amountNum = parseAmountInput(amountValue);
        const includeAmount = amountNum !== undefined;

        if (!includeAmount) {
          setSegmentPreview((baseJson?.preview || null) as any);
          return;
        }

        const res = await fetch("/api/sms/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...baseBody,
            segment: {
              ...baseBody.segment,
              amount: amountNum,
            },
          }),
        });

        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (!opts?.silent) setToast(json?.message || "Failed to load segment preview");
          if (json?.statusBreakdown) {
            setSegmentBreakdown((json.statusBreakdown || baseJson?.statusBreakdown || null) as any);
          }
          setSegmentPreview((baseJson?.preview || null) as any);
          return;
        }

        setSegmentBreakdown((json?.statusBreakdown || baseJson?.statusBreakdown || null) as any);
        setSegmentPreview((json?.preview || null) as any);
      } finally {
        setSegmentPreviewLoading(false);
      }
    },
    [maxScan, segAmount, segEndDate, segSearch, segStartDate, segStatus, segTillId]
  );

  useEffect(() => {
    loadSegmentPreview({ silent: true });
  }, [basePreviewKey, previewKey, loadSegmentPreview]);

  useEffect(() => {
    if (!selectedCampaignId) {
      setSelectedCampaign(null);
      setSelectedCounts(null);
      setMessages([]);
      setMessagesTotal(0);
      return;
    }

    loadCampaignDetail(selectedCampaignId);
  }, [selectedCampaignId]);

  const messagesKey = useMemo(
    () => JSON.stringify({ selectedCampaignId, messagesPage, messagesLimit, messagesStatus }),
    [selectedCampaignId, messagesPage, messagesLimit, messagesStatus]
  );

  useEffect(() => {
    if (!selectedCampaignId) return;

    loadMessagesForCampaign(selectedCampaignId);
  }, [messagesKey]);

  useEffect(() => {
    if (!autoRefresh) return;
    const intervalMs = Math.min(5 * 60_000, Math.max(5_000, Math.floor(Number(autoRefreshSec) || 15) * 1000));

    const t = setInterval(() => {
      loadCampaigns({ silent: true });
      if (selectedCampaignId) {
        loadCampaignDetail(selectedCampaignId, { silent: true });
        loadMessagesForCampaign(selectedCampaignId, { silent: true });
      }
    }, intervalMs);

    return () => clearInterval(t);
  }, [autoRefresh, autoRefreshSec, loadCampaignDetail, loadMessagesForCampaign, selectedCampaignId]);

  const onManualRefresh = async () => {
    await loadCampaigns();
    if (selectedCampaignId) {
      await loadCampaignDetail(selectedCampaignId);
      await loadMessagesForCampaign(selectedCampaignId);
    }
  };

  useEffect(() => {
    setMessagesPage(1);
  }, [selectedCampaignId, messagesStatus]);

  const onSignOut = async () => {
    if (!supabase) {
      setToast("Missing Supabase configuration");
      return;
    }
    await supabase.auth.signOut();
    router.replace("/login");
  };

  const onCreateCampaign = async () => {
    setCreateLoading(true);
    try {
      const amountValue = segAmount.trim();
      const amountNum = amountValue ? Number(amountValue) : undefined;
      if (amountValue && !Number.isFinite(amountNum)) {
        setToast("Amount must be a number");
        return;
      }

      const res = await fetch("/api/sms/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: formName || undefined,
          senderId: formSenderId || undefined,
          message: formMessage,
          segment: {
            tillId: segTillId || undefined,
            status: segStatus || undefined,
            startDate: segStartDate || undefined,
            endDate: segEndDate || undefined,
            amount: amountValue ? amountNum : undefined,
            search: segSearch || undefined,
          },
          maxScan: maxScan ? Number(maxScan) : undefined,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast(json?.message || "Failed to create campaign");
        return;
      }

      const id = String(json?.campaign?.id || "");
      setToast("Campaign created");
      await loadCampaigns();
      if (id) setSelectedCampaignId(id);
    } finally {
      setCreateLoading(false);
    }
  };

  const onDispatch = async () => {
    if (!selectedCampaignId) return;
    setDispatchLoading(true);
    try {
      const mr = Number(dispatchMaxRecipients || 300);
      const res = await fetch(`/api/sms/campaigns/${selectedCampaignId}/dispatch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxRecipients: Number.isFinite(mr) ? mr : 300 }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast(json?.message || "Dispatch failed");
        return;
      }

      setToast(`Dispatched ${json?.dispatched ?? 0}`);
      await loadCampaigns();
      const detailRes = await fetch(`/api/sms/campaigns/${selectedCampaignId}`, { cache: "no-store" });
      const detailJson = await detailRes.json().catch(() => ({}));
      if (detailRes.ok) {
        setSelectedCampaign(detailJson?.campaign || null);
        setSelectedCounts(detailJson?.counts || null);
      }
    } finally {
      setDispatchLoading(false);
    }
  };

  const onRefreshDelivery = async () => {
    if (!selectedCampaignId) return;
    setRefreshLoading(true);
    try {
      const lim = Number(refreshLimit || 20);
      const res = await fetch(`/api/sms/campaigns/${selectedCampaignId}/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: Number.isFinite(lim) ? lim : 20 }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast(json?.message || "Refresh failed");
        return;
      }

      setToast(`Refreshed ${json?.refreshed ?? 0}`);
      await loadCampaigns();
      const detailRes = await fetch(`/api/sms/campaigns/${selectedCampaignId}`, { cache: "no-store" });
      const detailJson = await detailRes.json().catch(() => ({}));
      if (detailRes.ok) {
        setSelectedCampaign(detailJson?.campaign || null);
        setSelectedCounts(detailJson?.counts || null);
      }
    } finally {
      setRefreshLoading(false);
    }
  };

  const selectedCampaignRow = useMemo(
    () => campaigns.find((c) => c.id === selectedCampaignId) || null,
    [campaigns, selectedCampaignId]
  );

  const totalMessagePages = Math.max(1, Math.ceil(messagesTotal / messagesLimit));

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-black text-zinc-50">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/30 backdrop-blur-xl md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/30 to-fuchsia-500/30 ring-1 ring-white/10">
                <MessageCircle className="h-6 w-6 text-indigo-200" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">SMS Dashboard</h1>
                <p className="mt-1 text-sm text-zinc-300">
                  Create recipient segments from transactions, send bulk SMS, and track delivery.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 py-2 text-sm text-zinc-200">
                <Wallet className="h-4 w-4 text-zinc-300" />
                <span className="font-semibold">Balance</span>
                <span className="text-zinc-300">·</span>
                <span className="font-semibold">
                  {balanceLoading ? "…" : balance === null || Number.isNaN(balance) ? "—" : String(balance)}
                </span>
              </div>

              <IconButton onClick={() => router.push("/explorer")} title="Back to explorer">
                <ArrowLeft className="h-4 w-4" />
                Explorer
              </IconButton>

              <label className="inline-flex h-10 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-zinc-100">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="h-4 w-4 accent-indigo-500"
                />
                Auto
              </label>

              <select
                value={String(autoRefreshSec)}
                onChange={(e) => setAutoRefreshSec(Number(e.target.value))}
                disabled={!autoRefresh}
                className="h-10 rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-zinc-100 outline-none focus:border-indigo-400/50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="5" className="bg-black">
                  5s
                </option>
                <option value="10" className="bg-black">
                  10s
                </option>
                <option value="15" className="bg-black">
                  15s
                </option>
                <option value="30" className="bg-black">
                  30s
                </option>
                <option value="60" className="bg-black">
                  60s
                </option>
              </select>

              <IconButton
                onClick={onManualRefresh}
                title="Refresh campaigns and selected campaign"
                disabled={campaignsLoading || selectedLoading || messagesLoading}
              >
                <RefreshCw
                  className={cn(
                    "h-4 w-4",
                    campaignsLoading || selectedLoading || messagesLoading ? "animate-spin" : ""
                  )}
                />
                Refresh
              </IconButton>

              <IconButton onClick={onSignOut} title="Sign out">
                <LogOut className="h-4 w-4" />
                Sign out
              </IconButton>
            </div>
          </header>

          <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-zinc-100">Create campaign</h2>
                  <div className="inline-flex items-center gap-2 text-xs text-zinc-400">
                    <Filter className="h-4 w-4" />
                    Segment
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3">
                  <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-zinc-100">Segment insights</div>
                        <div className="mt-1 text-xs text-zinc-400">Unique recipients, new vs messaged, and amount chips.</div>
                      </div>
                      <div className="text-xs text-zinc-400">
                        {segmentPreviewLoading ? "Updating…" : segmentPreview ? "Ready" : "—"}
                      </div>
                    </div>

                    {segmentBreakdown && (
                      <div className="mt-4 grid grid-cols-4 gap-2">
                        <button
                          type="button"
                          onClick={() => setSegStatus("")}
                          className={cn(
                            "rounded-2xl border border-white/10 bg-black/30 p-3 text-left transition hover:bg-white/5",
                            !segStatus ? "ring-1 ring-indigo-400/30" : ""
                          )}
                          title="Show all statuses"
                        >
                          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">All</div>
                          <div className="mt-1 text-lg font-semibold text-zinc-100 tabular-nums">{segmentBreakdown.total}</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setSegStatus("success")}
                          className={cn(
                            "rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-left transition hover:bg-emerald-500/10",
                            segStatus === "success" ? "ring-1 ring-emerald-400/30" : ""
                          )}
                          title="Target successful transactions"
                        >
                          <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/80">Success</div>
                          <div className="mt-1 text-lg font-semibold text-emerald-100 tabular-nums">{segmentBreakdown.success}</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setSegStatus("failed")}
                          className={cn(
                            "rounded-2xl border border-rose-500/20 bg-rose-500/5 p-3 text-left transition hover:bg-rose-500/10",
                            segStatus === "failed" ? "ring-1 ring-rose-400/30" : ""
                          )}
                          title="Target failed transactions"
                        >
                          <div className="text-[10px] font-bold uppercase tracking-wider text-rose-300/80">Failed</div>
                          <div className="mt-1 text-lg font-semibold text-rose-100 tabular-nums">{segmentBreakdown.failed}</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setSegStatus("pending")}
                          className={cn(
                            "rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 text-left transition hover:bg-amber-500/10",
                            segStatus === "pending" ? "ring-1 ring-amber-400/30" : ""
                          )}
                          title="Target pending transactions"
                        >
                          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300/80">Pending</div>
                          <div className="mt-1 text-lg font-semibold text-amber-100 tabular-nums">{segmentBreakdown.pending}</div>
                        </button>
                      </div>
                    )}

                    {segmentPreview?.coverage && (
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Recipients</div>
                          <div className="mt-1 text-lg font-semibold text-zinc-100 tabular-nums">{segmentPreview.recipients_total}</div>
                          <div className="mt-2 text-xs text-zinc-400 tabular-nums">Tx: {segmentPreview.total_transactions}</div>
                        </div>
                        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/80">New (no SMS yet)</div>
                          <div className="mt-1 text-lg font-semibold text-emerald-100 tabular-nums">
                            {segmentPreview.coverage.recipients_new}
                          </div>
                          <div className="mt-2 text-xs text-emerald-200/70 tabular-nums">
                            Messaged: {segmentPreview.coverage.recipients_messaged}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-3">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-300/80">Delivered</div>
                          <div className="mt-1 text-lg font-semibold text-indigo-100 tabular-nums">
                            {segmentPreview.coverage.recipients_delivered}
                          </div>
                          <div className="mt-2 text-xs text-indigo-200/70 tabular-nums">
                            Sent only: {segmentPreview.coverage.recipients_sent_only}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-3">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-rose-300/80">Not received</div>
                          <div className="mt-1 text-lg font-semibold text-rose-100 tabular-nums">
                            {segmentPreview.coverage.recipients_failed_only}
                          </div>
                          <div className="mt-2 text-xs text-rose-200/70">Failed only</div>
                        </div>
                      </div>
                    )}

                    <div className="mt-4 flex items-center justify-between gap-3">
                      <div className="text-xs font-semibold text-zinc-200">Unique amounts</div>
                      <label className="inline-flex items-center gap-2 text-xs text-zinc-300">
                        <input
                          type="checkbox"
                          checked={showOnlyNewAmounts}
                          onChange={(e) => setShowOnlyNewAmounts(e.target.checked)}
                          className="h-4 w-4 accent-emerald-500"
                        />
                        Show only with new
                      </label>
                    </div>

                    <div className="mt-3 flex max-h-[220px] flex-wrap gap-2 overflow-auto pr-1">
                      <button
                        type="button"
                        onClick={() => setSegAmount("")}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-semibold transition",
                          !segAmount.trim()
                            ? "border-indigo-400/40 bg-indigo-500/15 text-indigo-100 ring-1 ring-indigo-400/30"
                            : "border-white/10 bg-white/5 text-zinc-100 hover:bg-white/10"
                        )}
                        title="All amounts"
                      >
                        All amounts
                      </button>

                      {(segmentBasePreview?.amountCoverage || [])
                        .filter((r) => (showOnlyNewAmounts ? (r.recipients_new || 0) > 0 : true))
                        .slice(0, 60)
                        .map((r) => (
                          <AmountChip
                            key={r.amount}
                            active={parseAmountInput(segAmount) === r.amount}
                            amount={r.amount}
                            txCount={r.tx_count}
                            newCount={r.recipients_new || 0}
                            onClick={() => setSegAmount(String(r.amount))}
                          />
                        ))}
                    </div>

                    {amountCategories.length > 0 && (
                      <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-3">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">More amounts (fast list)</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {amountCategories.slice(0, 20).map((c) => (
                            <button
                              key={c.amount}
                              type="button"
                              onClick={() => setSegAmount(String(c.amount))}
                              className={cn(
                                "rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-white/10",
                                parseAmountInput(segAmount) === c.amount ? "ring-1 ring-indigo-400/30" : ""
                              )}
                              title={`${c.count} tx`}
                            >
                              {formatMoney(c.amount)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <label className="block">
                    <span className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-zinc-400">Name</span>
                    <input
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="e.g. February Promo"
                      className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-indigo-400/50"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-zinc-400">Sender ID</span>
                    <input
                      value={formSenderId}
                      onChange={(e) => setFormSenderId(e.target.value)}
                      placeholder="fluxsms"
                      className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-indigo-400/50"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-zinc-400">Message</span>
                    <textarea
                      value={formMessage}
                      onChange={(e) => setFormMessage(e.target.value)}
                      rows={4}
                      placeholder="Write your SMS message…"
                      className="w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-indigo-400/50"
                    />
                    <div className="mt-1 text-xs text-zinc-500">{formMessage.length}/1000</div>
                  </label>

                  <div className="mt-3 grid grid-cols-1 gap-3 rounded-3xl border border-white/10 bg-black/20 p-4">
                    <label className="block">
                      <span className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-zinc-400">Till</span>
                      <select
                        value={segTillId}
                        onChange={(e) => setSegTillId(e.target.value)}
                        disabled={tillsLoading || !tills.length}
                        className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-zinc-100 outline-none focus:border-indigo-400/50"
                      >
                        <option value="" className="bg-black">
                          All
                        </option>
                        {tills.map((t) => (
                          <option key={t.id} value={t.id} className="bg-black">
                            {t.till_name} ({t.till_number})
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="grid grid-cols-2 gap-3">
                      <label className="block">
                        <span className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-zinc-400">Tx status</span>
                        <select
                          value={segStatus}
                          onChange={(e) => setSegStatus(e.target.value)}
                          className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-zinc-100 outline-none focus:border-indigo-400/50"
                        >
                          <option value="" className="bg-black">
                            All
                          </option>
                          <option value="success" className="bg-black">
                            success
                          </option>
                          <option value="failed" className="bg-black">
                            failed
                          </option>
                          <option value="pending" className="bg-black">
                            pending
                          </option>
                        </select>
                      </label>

                      <label className="block">
                        <span className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-zinc-400">Amount</span>
                        <input
                          value={segAmount}
                          onChange={(e) => setSegAmount(e.target.value)}
                          placeholder="e.g. 250"
                          className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-indigo-400/50"
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <label className="block">
                        <span className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                          <Calendar className="h-3.5 w-3.5" />
                          Start
                        </span>
                        <input
                          value={segStartDate}
                          onChange={(e) => setSegStartDate(e.target.value)}
                          type="date"
                          className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-zinc-100 outline-none focus:border-indigo-400/50"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                          <Calendar className="h-3.5 w-3.5" />
                          End
                        </span>
                        <input
                          value={segEndDate}
                          onChange={(e) => setSegEndDate(e.target.value)}
                          type="date"
                          className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-zinc-100 outline-none focus:border-indigo-400/50"
                        />
                      </label>
                    </div>

                    <label className="block">
                      <span className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                        <Search className="h-3.5 w-3.5" />
                        Search
                      </span>
                      <input
                        value={segSearch}
                        onChange={(e) => setSegSearch(e.target.value)}
                        placeholder="Phone or reference"
                        className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-indigo-400/50"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-zinc-400">Max scan</span>
                      <input
                        value={maxScan}
                        onChange={(e) => setMaxScan(e.target.value)}
                        placeholder="10000"
                        className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-indigo-400/50"
                      />
                    </label>
                  </div>

                  <button
                    type="button"
                    disabled={createLoading || !formMessage.trim()}
                    onClick={onCreateCampaign}
                    className={cn(
                      "mt-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
                    )}
                  >
                    {createLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {createLoading ? "Creating…" : "Create campaign"}
                  </button>
                </div>
              </div>

              <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-100">Daily view</h2>
                    <p className="mt-1 text-xs text-zinc-400">Pick a day, select recipients, then create & dispatch.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="date"
                      value={dailyDate}
                      onChange={(e) => setDailyDate(e.target.value)}
                      className="h-10 rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-zinc-100 outline-none focus:border-indigo-400/50"
                    />
                    <select
                      value={dailyStatus}
                      onChange={(e) => setDailyStatus(e.target.value)}
                      className="h-10 rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-zinc-100 outline-none focus:border-indigo-400/50"
                    >
                      <option value="" className="bg-black">
                        all
                      </option>
                      <option value="success" className="bg-black">
                        success
                      </option>
                      <option value="failed" className="bg-black">
                        failed
                      </option>
                      <option value="pending" className="bg-black">
                        pending
                      </option>
                    </select>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-zinc-400">Till</span>
                      <select
                        value={dailyTillId}
                        onChange={(e) => setDailyTillId(e.target.value)}
                        disabled={tillsLoading || !tills.length}
                        className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-zinc-100 outline-none focus:border-indigo-400/50"
                      >
                        <option value="" className="bg-black">
                          All
                        </option>
                        {tills.map((t) => (
                          <option key={t.id} value={t.id} className="bg-black">
                            {t.till_name} ({t.till_number})
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-zinc-400">Amount</span>
                      <input
                        value={dailyAmount}
                        onChange={(e) => setDailyAmount(e.target.value)}
                        placeholder="e.g. 250"
                        className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-indigo-400/50"
                      />
                    </label>
                  </div>

                  <label className="block">
                    <span className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-zinc-400">Search</span>
                    <input
                      value={dailySearch}
                      onChange={(e) => setDailySearch(e.target.value)}
                      placeholder="Phone"
                      className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-indigo-400/50"
                    />
                  </label>
                </div>

                {dailyAmountCoverage.length > 0 && (
                  <div className="mt-4 rounded-3xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-semibold text-zinc-200">Amounts</div>
                      <label className="inline-flex items-center gap-2 text-xs text-zinc-300">
                        <input
                          type="checkbox"
                          checked={dailyShowOnlyNewAmounts}
                          onChange={(e) => setDailyShowOnlyNewAmounts(e.target.checked)}
                          className="h-4 w-4 accent-emerald-500"
                        />
                        Show only with new
                      </label>
                    </div>

                    <div className="mt-3 flex max-h-[220px] flex-wrap gap-2 overflow-auto pr-1">
                      <button
                        type="button"
                        onClick={() => setDailyAmount("")}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-semibold transition",
                          !dailyAmount.trim()
                            ? "border-indigo-400/40 bg-indigo-500/15 text-indigo-100 ring-1 ring-indigo-400/30"
                            : "border-white/10 bg-white/5 text-zinc-100 hover:bg-white/10"
                        )}
                        title="All amounts"
                      >
                        All amounts
                      </button>

                      {dailyAmountCoverage
                        .filter((r) => (dailyShowOnlyNewAmounts ? (r.recipients_new_ever || 0) > 0 : true))
                        .slice(0, 60)
                        .map((r) => (
                          <AmountChip
                            key={r.amount}
                            active={parseAmountInput(dailyAmount) === r.amount}
                            amount={r.amount}
                            txCount={r.tx_count}
                            newCount={r.recipients_new_ever || 0}
                            onClick={() => setDailyAmount(String(r.amount))}
                          />
                        ))}
                    </div>
                  </div>
                )}

                {dailySummary && (
                  <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Tx</div>
                      <div className="mt-1 text-lg font-semibold text-zinc-100 tabular-nums">{dailySummary.totalTx}</div>
                    </div>
                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/80">Success</div>
                      <div className="mt-1 text-lg font-semibold text-emerald-100 tabular-nums">{dailySummary.txSuccess}</div>
                    </div>
                    <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-rose-300/80">Failed</div>
                      <div className="mt-1 text-lg font-semibold text-rose-100 tabular-nums">{dailySummary.txFailed}</div>
                    </div>
                    <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-300/80">Recipients</div>
                      <div className="mt-1 text-lg font-semibold text-indigo-100 tabular-nums">{dailySummary.recipients}</div>
                      <div className="mt-1 text-[11px] text-indigo-200/70 tabular-nums">
                        New: {dailySummary.recipientsNewEver} · SMS’d: {dailySummary.recipientsMessagedEver}
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-4 overflow-hidden rounded-3xl border border-white/10">
                  <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-black/30 px-4 py-3">
                    <div className="text-xs font-semibold text-zinc-100">
                      Recipients
                      <span className="ml-2 text-xs text-zinc-400">{dailyLoading ? "Loading…" : `${dailyTotal}`}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const next: Record<string, true> = { ...dailySelected };
                          for (const r of dailyRows) next[r.phone_e164] = true;
                          setDailySelected(next);
                        }}
                        className="h-9 rounded-2xl border border-white/10 bg-white/5 px-3 text-xs font-semibold text-zinc-100 transition hover:bg-white/10"
                      >
                        Select page
                      </button>
                      <button
                        type="button"
                        onClick={() => setDailySelected({})}
                        className="h-9 rounded-2xl border border-white/10 bg-white/5 px-3 text-xs font-semibold text-zinc-100 transition hover:bg-white/10"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-12 gap-2 border-b border-white/10 bg-black/20 px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                    <div className="col-span-1">Pick</div>
                    <div className="col-span-4">Phone</div>
                    <div className="col-span-2">Tx</div>
                    <div className="col-span-2">SMS today</div>
                    <div className="col-span-3">SMS ever</div>
                  </div>

                  {dailyRows.length === 0 && !dailyLoading && (
                    <div className="bg-black/20 px-4 py-6 text-sm text-zinc-300">No recipients for this day.</div>
                  )}

                  {dailyRows.map((r) => {
                    const checked = Boolean(dailySelected[r.phone_e164]);
                    return (
                      <div
                        key={r.phone_e164}
                        className={cn(
                          "grid grid-cols-12 gap-2 border-b border-white/5 bg-black/10 px-4 py-3 text-sm text-zinc-100",
                          checked ? "bg-indigo-500/5" : ""
                        )}
                      >
                        <div className="col-span-1">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setDailySelected((cur) => {
                                const next = { ...cur };
                                if (e.target.checked) next[r.phone_e164] = true;
                                else delete next[r.phone_e164];
                                return next;
                              });
                            }}
                            className="mt-0.5 h-4 w-4 accent-indigo-500"
                          />
                        </div>
                        <div className="col-span-4">
                          <div className="font-semibold text-zinc-100">{r.phone_local}</div>
                          <div className="mt-1 text-xs text-zinc-500">{formatDateTime(r.last_tx_at)}</div>
                        </div>
                        <div className="col-span-2 text-xs text-zinc-200">
                          <div className="tabular-nums">{r.tx_count} tx</div>
                          <div className="mt-1 text-[11px] text-zinc-500 tabular-nums">
                            s:{r.success_count} f:{r.failed_count} p:{r.pending_count}
                          </div>
                        </div>
                        <div className="col-span-2 text-xs text-zinc-200">
                          <div className="tabular-nums">{r.sms_day_count}</div>
                          <div className="mt-1 text-[11px] text-zinc-500 tabular-nums">
                            d:{r.sms_day_delivered} s:{r.sms_day_sent} f:{r.sms_day_failed}
                          </div>
                        </div>
                        <div className="col-span-3 text-xs text-zinc-200">
                          <div className="flex items-center justify-between gap-2">
                            <span className="tabular-nums">{r.sms_ever_count}</span>
                            <StatusPill value={r.sms_ever_last_status || (r.sms_ever_count ? "sent" : "queued")} />
                          </div>
                          <div className="mt-1 text-[11px] text-zinc-500 tabular-nums">
                            d:{r.sms_ever_delivered} s:{r.sms_ever_sent} f:{r.sms_ever_failed}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-zinc-400">Selected {Object.keys(dailySelected).length}</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={dailyCreateLoading}
                      onClick={() => onCreateCampaignFromDailySelection({ dispatch: false })}
                      className={cn(
                        "h-10 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-zinc-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                      )}
                    >
                      {dailyCreateLoading ? "Working…" : "Create campaign"}
                    </button>
                    <button
                      type="button"
                      disabled={dailyCreateLoading}
                      onClick={() => onCreateCampaignFromDailySelection({ dispatch: true })}
                      className={cn(
                        "h-10 rounded-2xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-4 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
                      )}
                    >
                      {dailyCreateLoading ? "Working…" : "Create + Dispatch"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-zinc-100">Campaigns</h2>
                  <div className="text-xs text-zinc-400">{campaignsLoading ? "Loading…" : `${campaigns.length}`}</div>
                </div>

                <div className="mt-4 space-y-2">
                  {campaigns.length === 0 && !campaignsLoading && (
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-zinc-300">
                      No campaigns yet.
                    </div>
                  )}

                  {campaigns.map((c) => {
                    const active = c.id === selectedCampaignId;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelectedCampaignId(c.id)}
                        className={cn(
                          "w-full rounded-2xl border border-white/10 bg-black/20 p-4 text-left transition hover:bg-white/5",
                          active ? "ring-1 ring-indigo-400/40" : ""
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-zinc-100">{c.name || "Untitled"}</div>
                            <div className="mt-1 text-xs text-zinc-400">{formatDateTime(c.created_at)}</div>
                          </div>
                          <StatusPill value={c.status} />
                        </div>
                        <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                          <div className="rounded-xl border border-white/10 bg-black/30 px-2 py-2">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Target</div>
                            <div className="mt-1 text-sm font-semibold text-zinc-100">{c.target_count || 0}</div>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-black/30 px-2 py-2">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Sent</div>
                            <div className="mt-1 text-sm font-semibold text-zinc-100">{c.sent_count || 0}</div>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-black/30 px-2 py-2">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Deliv.</div>
                            <div className="mt-1 text-sm font-semibold text-zinc-100">{c.delivered_count || 0}</div>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-black/30 px-2 py-2">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Failed</div>
                            <div className="mt-1 text-sm font-semibold text-zinc-100">{c.failed_count || 0}</div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="lg:col-span-8">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-100">Campaign details</h2>
                    <p className="mt-1 text-xs text-zinc-400">Select a campaign to dispatch and monitor delivery.</p>
                  </div>

                  {selectedCampaignId && (
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                        <input
                          value={dispatchMaxRecipients}
                          onChange={(e) => setDispatchMaxRecipients(e.target.value)}
                          className="h-8 w-20 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-zinc-100 outline-none focus:border-indigo-400/50"
                        />
                        <IconButton onClick={onDispatch} title="Dispatch queued" disabled={dispatchLoading}>
                          {dispatchLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                          Dispatch
                        </IconButton>
                      </div>

                      <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                        <input
                          value={refreshLimit}
                          onChange={(e) => setRefreshLimit(e.target.value)}
                          className="h-8 w-20 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-zinc-100 outline-none focus:border-indigo-400/50"
                        />
                        <IconButton onClick={onRefreshDelivery} title="Refresh delivery status" disabled={refreshLoading}>
                          {refreshLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                          Refresh
                        </IconButton>
                      </div>
                    </div>
                  )}
                </div>

                {!selectedCampaignId && (
                  <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-6 text-sm text-zinc-300">
                    Pick a campaign from the left.
                  </div>
                )}

                {selectedCampaignId && (
                  <div className="mt-6">
                    {selectedLoading && (
                      <div className="flex items-center gap-2 text-sm text-zinc-300">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading…
                      </div>
                    )}

                    {(selectedCampaign || selectedCampaignRow) && (
                      <div className="grid grid-cols-1 gap-4 rounded-3xl border border-white/10 bg-black/20 p-5 md:grid-cols-3">
                        <div className="md:col-span-2">
                          <Field label="Name" value={(selectedCampaign?.name || selectedCampaignRow?.name || "Untitled") as any} />
                          <div className="mt-4">
                            <Field
                              label="Message"
                              value={<div className="whitespace-pre-wrap text-sm text-zinc-100">{(selectedCampaign?.message || selectedCampaignRow?.message) as any}</div>}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 md:grid-cols-1">
                          <Field label="Status" value={<StatusPill value={String(selectedCampaign?.status || selectedCampaignRow?.status || "")} />} />
                          <Field
                            label="Created"
                            value={formatDateTime(String(selectedCampaign?.created_at || selectedCampaignRow?.created_at || ""))}
                          />
                          <Field label="Sender" value={String(selectedCampaign?.sender_id || selectedCampaignRow?.sender_id || "fluxsms")} />
                        </div>
                      </div>
                    )}

                    {selectedCounts && (
                      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                          <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Queued</div>
                          <div className="mt-1 text-2xl font-semibold text-zinc-100">{selectedCounts.queued || 0}</div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                          <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Sent</div>
                          <div className="mt-1 text-2xl font-semibold text-zinc-100">{selectedCounts.sent || 0}</div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                          <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Delivered</div>
                          <div className="mt-1 text-2xl font-semibold text-zinc-100">{selectedCounts.delivered || 0}</div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                          <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Failed</div>
                          <div className="mt-1 text-2xl font-semibold text-zinc-100">{selectedCounts.failed || 0}</div>
                        </div>
                      </div>
                    )}

                    <div className="mt-6">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <h3 className="text-sm font-semibold text-zinc-100">Messages</h3>
                        <div className="flex flex-wrap items-center gap-3">
                          <select
                            value={messagesStatus}
                            onChange={(e) => setMessagesStatus(e.target.value)}
                            className="h-10 rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-zinc-100 outline-none focus:border-indigo-400/50"
                          >
                            <option value="" className="bg-black">
                              All
                            </option>
                            <option value="queued" className="bg-black">
                              queued
                            </option>
                            <option value="sent" className="bg-black">
                              sent
                            </option>
                            <option value="delivered" className="bg-black">
                              delivered
                            </option>
                            <option value="failed" className="bg-black">
                              failed
                            </option>
                          </select>

                          <div className="text-xs text-zinc-400">
                            {messagesLoading ? "Loading…" : `${messagesTotal} total`}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 overflow-hidden rounded-3xl border border-white/10">
                        <div className="grid grid-cols-12 gap-2 border-b border-white/10 bg-black/30 px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                          <div className="col-span-3">Phone</div>
                          <div className="col-span-2">Status</div>
                          <div className="col-span-2">Amount</div>
                          <div className="col-span-3">Delivery</div>
                          <div className="col-span-2">Created</div>
                        </div>

                        {messages.length === 0 && !messagesLoading && (
                          <div className="bg-black/20 px-4 py-6 text-sm text-zinc-300">No messages found.</div>
                        )}

                        {messages.map((m) => (
                          <div
                            key={m.id}
                            className="grid grid-cols-12 gap-2 border-b border-white/5 bg-black/20 px-4 py-3 text-sm text-zinc-100"
                          >
                            <div className="col-span-3 font-medium text-zinc-100">{m.phone}</div>
                            <div className="col-span-2">
                              <StatusPill value={m.status} />
                            </div>
                            <div className="col-span-2 text-zinc-200">
                              {m.amount === null || m.amount === undefined || Number.isNaN(Number(m.amount))
                                ? "—"
                                : formatMoney(Number(m.amount))}
                            </div>
                            <div className="col-span-3 text-xs text-zinc-300">
                              <div className="truncate">{m.delivery_status_text || "—"}</div>
                              <div className="mt-1 text-[11px] text-zinc-500">{m.flux_message_id || ""}</div>
                            </div>
                            <div className="col-span-2 text-xs text-zinc-300">{formatDateTime(m.created_at)}</div>
                          </div>
                        ))}
                      </div>

                      {selectedCampaignId && (
                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                          <div className="text-xs text-zinc-400">
                            Page {messagesPage} of {totalMessagePages}
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={messagesPage <= 1}
                              onClick={() => setMessagesPage((p) => Math.max(1, p - 1))}
                              className="h-10 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-zinc-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Prev
                            </button>
                            <button
                              type="button"
                              disabled={messagesPage >= totalMessagePages}
                              onClick={() => setMessagesPage((p) => Math.min(totalMessagePages, p + 1))}
                              className="h-10 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-zinc-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Next
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          {toast && (
            <div className="fixed bottom-6 left-1/2 z-50 w-[min(560px,calc(100vw-48px))] -translate-x-1/2 rounded-2xl border border-white/10 bg-black/70 px-4 py-3 text-sm text-zinc-200 shadow-2xl shadow-black/40 backdrop-blur-xl">
              {toast}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
