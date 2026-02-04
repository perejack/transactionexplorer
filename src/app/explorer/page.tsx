"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  Copy,
  ExternalLink,
  Loader2,
  LogOut,
  Phone,
  Search,
  ShieldCheck,
  MessageCircle,
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { formatDateTime, formatMoney, normalizePhoneForLinks } from "@/lib/format";

type Till = {
  id: string;
  till_name: string;
  till_number: string;
  created_at: string;
};

type AmountCategory = {
  amount: number;
  count: number;
};

type TxRow = {
  id: string;
  till_id: string;
  phone_number: string;
  amount: number;
  status: string;
  reference: string | null;
  transaction_type: string | null;
  mpesa_request_id: string | null;
  checkout_request_id: string | null;
  created_at: string;
  completed_at: string | null;
  updated_at: string | null;
};

function StatusPill({ value }: { value: string }) {
  const normalized = String(value || "").toLowerCase();
  const cls =
    normalized === "success" || normalized === "completed"
      ? "bg-emerald-500/15 text-emerald-200 border-emerald-500/30"
      : normalized === "failed"
      ? "bg-rose-500/15 text-rose-200 border-rose-500/30"
      : "bg-amber-500/15 text-amber-200 border-amber-500/30";

  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold", cls)}>
      {normalized || "unknown"}
    </span>
  );
}

function IconButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-zinc-100 transition hover:bg-white/10"
    >
      {children}
    </button>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
        {label}
      </div>
      <div className="mt-1 text-sm text-zinc-100">{value}</div>
    </div>
  );
}

export default function ExplorerPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [tills, setTills] = useState<Till[]>([]);
  const [selectedTillId, setSelectedTillId] = useState<string>("");

  const [status, setStatus] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);

  const [categories, setCategories] = useState<AmountCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);

  const [txRows, setTxRows] = useState<TxRow[]>([]);
  const [txTotal, setTxTotal] = useState(0);
  const [txLoading, setTxLoading] = useState(false);
  const [txPage, setTxPage] = useState(1);
  const [txLimit] = useState(50);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerTx, setDrawerTx] = useState<any>(null);

  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const load = async () => {
      const url = new URL("/api/tills", window.location.origin);
      url.searchParams.set("view", "active");

      const res = await fetch(url.toString(), { cache: "no-store" });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 401) {
          router.replace("/login");
          return;
        }

        setTills([]);
        setSelectedTillId("");
        setToast(json?.message || "Failed to load tills");
        return;
      }

      const list = (json.tills || []) as Till[];
      setTills(list);

      const stillExists = selectedTillId && list.some((t) => t.id === selectedTillId);
      if (stillExists) return;

      if (list.length) {
        setSelectedTillId(list[0].id);
        return;
      }

      setSelectedTillId("");
    };
    load();
  }, [router]);

  const filtersKey = useMemo(
    () =>
      JSON.stringify({
        selectedTillId,
        status,
        startDate,
        endDate,
      }),
    [selectedTillId, status, startDate, endDate]
  );

  useEffect(() => {
    const loadCategories = async () => {
      if (!selectedTillId) return;
      setCategoriesLoading(true);
      try {
        const url = new URL("/api/amount-categories", window.location.origin);
        url.searchParams.set("tillId", selectedTillId);
        if (status) url.searchParams.set("status", status);
        if (startDate) url.searchParams.set("startDate", startDate);
        if (endDate) url.searchParams.set("endDate", endDate);

        const res = await fetch(url.toString(), { cache: "no-store" });
        const json = await res.json();

        if (!res.ok) {
          setCategories([]);
          setToast(json?.message || "Failed to load amount categories");
          return;
        }

        setCategories(json.categories || []);
      } finally {
        setCategoriesLoading(false);
      }
    };

    loadCategories();
  }, [filtersKey, selectedTillId, status, startDate, endDate]);

  const txFiltersKey = useMemo(
    () =>
      JSON.stringify({
        selectedTillId,
        status,
        startDate,
        endDate,
        search,
        selectedAmount,
        txPage,
        txLimit,
      }),
    [selectedTillId, status, startDate, endDate, search, selectedAmount, txPage, txLimit]
  );

  useEffect(() => {
    const loadTx = async () => {
      if (!selectedTillId) return;
      setTxLoading(true);
      try {
        const url = new URL("/api/transactions", window.location.origin);
        url.searchParams.set("tillId", selectedTillId);
        url.searchParams.set("page", String(txPage));
        url.searchParams.set("limit", String(txLimit));
        if (status) url.searchParams.set("status", status);
        if (startDate) url.searchParams.set("startDate", startDate);
        if (endDate) url.searchParams.set("endDate", endDate);
        if (search) url.searchParams.set("search", search);
        if (selectedAmount !== null) url.searchParams.set("amount", String(selectedAmount));

        const res = await fetch(url.toString(), { cache: "no-store" });
        const json = await res.json();

        if (!res.ok) {
          setTxRows([]);
          setTxTotal(0);
          setToast(json?.message || "Failed to load transactions");
          return;
        }

        setTxRows(json.transactions || []);
        setTxTotal(json.total || 0);
      } finally {
        setTxLoading(false);
      }
    };

    loadTx();
  }, [txFiltersKey, selectedTillId, status, startDate, endDate, search, selectedAmount, txPage, txLimit]);

  useEffect(() => {
    setTxPage(1);
  }, [selectedTillId, status, startDate, endDate, selectedAmount, search]);

  const onSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  const openTx = async (id: string) => {
    setDrawerOpen(true);
    setDrawerLoading(true);
    setDrawerTx(null);

    try {
      const res = await fetch(`/api/transactions/${id}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setToast(json?.message || "Failed to load transaction");
        return;
      }
      setDrawerTx(json.transaction);
    } finally {
      setDrawerLoading(false);
    }
  };

  const onCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setToast("Copied");
    } catch {
      setToast("Copy failed");
    }
  };

  const selectedTill = useMemo(() => tills.find((t) => t.id === selectedTillId) || null, [tills, selectedTillId]);
  const totalPages = Math.max(1, Math.ceil(txTotal / txLimit));

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-black text-zinc-50">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/30 backdrop-blur-xl md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/30 to-fuchsia-500/30 ring-1 ring-white/10">
                <ShieldCheck className="h-6 w-6 text-indigo-200" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Transactions Explorer</h1>
                <p className="mt-1 text-sm text-zinc-300">
                  Pick a till, browse unique amount categories, then drill down to customer payments.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
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
                  <h2 className="text-sm font-semibold text-zinc-100">Till</h2>
                </div>

                <div className="mt-3">
                  <select
                    value={selectedTillId}
                    onChange={(e) => setSelectedTillId(e.target.value)}
                    disabled={!tills.length}
                    className="h-12 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-zinc-100 outline-none focus:border-indigo-400/50"
                  >
                    {tills.map((t) => (
                      <option key={t.id} value={t.id} className="bg-black">
                        {t.till_name} ({t.till_number})
                      </option>
                    ))}
                  </select>

                  {selectedTill && (
                    <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-4 text-xs text-zinc-300">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-zinc-100">{selectedTill.till_name}</span>
                        <span className="text-zinc-400">{selectedTill.till_number}</span>
                      </div>
                      <div className="mt-1 text-zinc-400">Till ID: {selectedTill.id}</div>
                    </div>
                  )}
                </div>

                <div className="mt-6 border-t border-white/10 pt-6">
                  <h2 className="text-sm font-semibold text-zinc-100">Filters</h2>

                  <div className="mt-3 grid grid-cols-1 gap-3">
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block">
                        <span className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                          Status
                        </span>
                        <select
                          value={status}
                          onChange={(e) => setStatus(e.target.value)}
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
                        <span className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                          Amount
                        </span>
                        <input
                          value={selectedAmount === null ? "" : String(selectedAmount)}
                          onChange={(e) => {
                            const v = e.target.value.trim();
                            if (!v) {
                              setSelectedAmount(null);
                              return;
                            }
                            const n = Number(v);
                            if (Number.isFinite(n)) setSelectedAmount(n);
                          }}
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
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
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
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                          type="date"
                          className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-zinc-100 outline-none focus:border-indigo-400/50"
                        />
                      </label>
                    </div>

                    <label className="block">
                      <span className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                        Search
                      </span>
                      <div className="relative">
                        <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                        <input
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Phone or reference…"
                          className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 pl-11 pr-4 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-indigo-400/50"
                        />
                      </div>
                    </label>

                    <button
                      type="button"
                      onClick={() => {
                        setStatus("");
                        setStartDate("");
                        setEndDate("");
                        setSearch("");
                        setSelectedAmount(null);
                      }}
                      className="h-11 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-zinc-100 transition hover:bg-white/10"
                    >
                      Reset filters
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-zinc-100">Unique Amounts</h2>
                  {categoriesLoading && <Loader2 className="h-4 w-4 animate-spin text-zinc-300" />}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  {categories.map((c) => {
                    const active = selectedAmount !== null && Number(selectedAmount) === Number(c.amount);
                    return (
                      <button
                        key={String(c.amount)}
                        type="button"
                        onClick={() => setSelectedAmount(c.amount)}
                        className={cn(
                          "rounded-2xl border px-4 py-3 text-left transition",
                          active
                            ? "border-indigo-400/40 bg-indigo-500/15"
                            : "border-white/10 bg-black/20 hover:bg-white/5"
                        )}
                      >
                        <div className="text-lg font-semibold">{formatMoney(c.amount)}</div>
                        <div className="mt-1 text-xs text-zinc-400">{c.count} payments</div>
                      </button>
                    );
                  })}

                  {!categoriesLoading && categories.length === 0 && (
                    <div className="col-span-2 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-zinc-300">
                      No categories yet. Try changing the date range or status.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="lg:col-span-8">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-100">Transactions</h2>
                    <p className="mt-1 text-xs text-zinc-400">
                      Showing {txRows.length} of {txTotal}
                      {selectedAmount !== null ? ` • amount = ${formatMoney(selectedAmount)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setTxPage((p) => Math.max(1, p - 1))}
                      disabled={txPage <= 1}
                      className="inline-flex h-10 items-center justify-center rounded-2xl border border-white/10 bg-black/20 px-4 text-sm font-semibold text-zinc-100 disabled:opacity-50"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                    <div className="text-xs text-zinc-300">
                      Page {txPage} / {totalPages}
                    </div>
                    <button
                      type="button"
                      onClick={() => setTxPage((p) => Math.min(totalPages, p + 1))}
                      disabled={txPage >= totalPages}
                      className="inline-flex h-10 items-center justify-center rounded-2xl border border-white/10 bg-black/20 px-4 text-sm font-semibold text-zinc-100 disabled:opacity-50"
                    >
                      <span className="rotate-180">
                        <ArrowLeft className="h-4 w-4" />
                      </span>
                    </button>
                  </div>
                </div>

                <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
                  <div className="grid grid-cols-12 bg-black/30 px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                    <div className="col-span-3">Date</div>
                    <div className="col-span-3">Phone</div>
                    <div className="col-span-2">Amount</div>
                    <div className="col-span-2">Status</div>
                    <div className="col-span-2">Reference</div>
                  </div>

                  {txLoading ? (
                    <div className="flex items-center gap-3 px-4 py-6 text-sm text-zinc-300">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading…
                    </div>
                  ) : (
                    <div className="divide-y divide-white/5">
                      {txRows.map((tx) => (
                        <button
                          key={tx.id}
                          type="button"
                          onClick={() => openTx(tx.id)}
                          className="grid w-full grid-cols-12 items-center px-4 py-3 text-left text-sm text-zinc-100 transition hover:bg-white/5"
                        >
                          <div className="col-span-3 text-zinc-200">{formatDateTime(tx.created_at)}</div>
                          <div className="col-span-3 font-medium">{tx.phone_number}</div>
                          <div className="col-span-2">{formatMoney(tx.amount)}</div>
                          <div className="col-span-2">
                            <StatusPill value={tx.status} />
                          </div>
                          <div className="col-span-2 truncate text-zinc-300">
                            {tx.reference || "—"}
                          </div>
                        </button>
                      ))}

                      {!txLoading && txRows.length === 0 && (
                        <div className="px-4 py-6 text-sm text-zinc-300">No transactions found.</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-white/10 bg-black/60 px-4 py-2 text-sm text-zinc-100 shadow-xl backdrop-blur">
          {toast}
        </div>
      )}

      {drawerOpen && (
        <div className="fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setDrawerOpen(false)}
          />

          <div className="absolute right-0 top-0 h-full w-full max-w-xl border-l border-white/10 bg-gradient-to-b from-zinc-950 via-zinc-900 to-black p-6 shadow-2xl shadow-black/40">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold">Transaction Details</h3>
                <p className="mt-1 text-xs text-zinc-400">Tap actions to contact or copy.</p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-zinc-100 hover:bg-white/10"
              >
                Close
              </button>
            </div>

            <div className="mt-5 rounded-3xl border border-white/10 bg-white/5 p-5">
              {drawerLoading ? (
                <div className="flex items-center gap-3 text-sm text-zinc-300">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading…
                </div>
              ) : drawerTx ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill value={drawerTx.status} />
                    <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-xs text-zinc-300">
                      {drawerTx.transaction_type || "transaction"}
                    </span>
                    <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-xs text-zinc-300">
                      {formatMoney(drawerTx.amount)}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-4">
                    <Field label="Phone" value={drawerTx.phone_number || ""} />
                    <Field label="Reference" value={drawerTx.reference || "—"} />
                    <Field label="Created" value={formatDateTime(drawerTx.created_at)} />
                    <Field label="Completed" value={drawerTx.completed_at ? formatDateTime(drawerTx.completed_at) : "—"} />
                    <Field label="M-Pesa Request ID" value={drawerTx.mpesa_request_id || "—"} />
                    <Field label="Checkout Request ID" value={drawerTx.checkout_request_id || "—"} />
                  </div>

                  <div className="mt-6 grid grid-cols-2 gap-3">
                    <IconButton
                      title="Copy phone"
                      onClick={() => onCopy(String(drawerTx.phone_number || ""))}
                    >
                      <Copy className="h-4 w-4" />
                      Copy
                    </IconButton>

                    <a
                      href={`tel:${normalizePhoneForLinks(drawerTx.phone_number)}`}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-zinc-100 transition hover:bg-white/10"
                    >
                      <Phone className="h-4 w-4" />
                      Call
                    </a>

                    <a
                      href={`https://wa.me/${normalizePhoneForLinks(drawerTx.phone_number)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-zinc-100 transition hover:bg-white/10"
                    >
                      <MessageCircle className="h-4 w-4" />
                      WhatsApp
                      <ExternalLink className="h-3.5 w-3.5 opacity-70" />
                    </a>

                    <a
                      href={`sms:${normalizePhoneForLinks(drawerTx.phone_number)}`}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-zinc-100 transition hover:bg-white/10"
                    >
                      <MessageCircle className="h-4 w-4" />
                      SMS
                    </a>
                  </div>
                </>
              ) : (
                <div className="text-sm text-zinc-300">No data.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
