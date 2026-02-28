"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createWalletTopup,
  getWalletBalance,
  getWalletTransactions,
  me,
  postWalletWebhook,
  type WalletMethod,
  type WalletTransaction,
} from "@/lib/api";
import { getUser, setUser } from "@/lib/storage";
import { useToast } from "@/components/ToastProvider";

type TxFilter = "all" | "success" | "pending" | "failed";

function MethodLogo({ method }: { method: WalletMethod }) {
  const style =
    method === "BKASH"
      ? "bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-300"
      : method === "NAGAD"
      ? "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300"
      : "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300";
  const label = method === "BKASH" ? "bK" : method === "NAGAD" ? "Ng" : "Bk";
  return <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ${style}`}>{label}</span>;
}

export default function WalletPage() {
  const { showToast } = useToast();
  const [amount, setAmount] = useState("100");
  const [method, setMethod] = useState<WalletMethod>("BKASH");
  const [balance, setBalance] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [filter, setFilter] = useState<TxFilter>("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [showAddMoney, setShowAddMoney] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [status, setStatus] = useState<"idle" | "processing" | "success" | "failed">("idle");
  const [pendingTopup, setPendingTopup] = useState<{ topup_id: string; reference_id?: string } | null>(null);

  const fee = 0;
  const parsedAmount = useMemo(() => Number(amount), [amount]);
  const totalPayable = (Number.isFinite(parsedAmount) ? parsedAmount : 0) + fee;

  const refreshAll = async (nextFilter: TxFilter = filter) => {
    const [balanceRes, txRes] = await Promise.all([getWalletBalance(), getWalletTransactions(nextFilter, 30)]);
    setBalance(balanceRes.account_balance);
    setTransactions(txRes.transactions);
    setLastUpdated(new Date().toLocaleString());
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        await refreshAll("all");
      } catch (e: any) {
        if (cancelled) return;
        setErr(e?.message ?? "Failed to load wallet");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refreshAll(filter).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const validateAmount = (): string | null => {
    const n = Number(amount);
    if (!Number.isFinite(n) || !/^\d+$/.test(amount.trim())) return "Amount must be numeric";
    if (n < 50 || n > 10000) return "Amount must be between BDT 50 and BDT 10,000";
    return null;
  };

  const onContinue = (e: React.FormEvent) => {
    e.preventDefault();
    const msg = validateAmount();
    if (msg) {
      setErr(msg);
      showToast(msg, "error");
      return;
    }
    setErr(null);
    setStep(2);
  };

  const onConfirmPay = async () => {
    const n = Number(amount);
    if (!Number.isFinite(n)) return;
    try {
      setBusy(true);
      setErr(null);
      setStep(3);
      setStatus("processing");
      const intent = await createWalletTopup(Math.floor(n), method);
      setPendingTopup({ topup_id: intent.topup.topup_id, reference_id: intent.topup.reference_id });

      // Simulate provider callback in demo mode while preserving webhook handshake contract.
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const provider = method.toLowerCase() as "bkash" | "nagad" | "bank";
      const hook = await postWalletWebhook(provider, {
        topup_id: intent.topup.topup_id,
        status: "SUCCESS",
        provider_txn_id: `${provider.toUpperCase()}-${Date.now()}`,
      });

      if (hook.status === "SUCCESS") {
        if (typeof hook.account_balance === "number") setBalance(hook.account_balance);
        const user = getUser();
        if (user && typeof hook.account_balance === "number") {
          setUser({ ...user, account_balance: hook.account_balance });
        }
        try {
          const current = await me();
          setUser(current.user);
        } catch {
          // keep locally updated user balance
        }
        await refreshAll(filter);
        setStatus("success");
        showToast("Balance updated", "success");
      } else {
        setStatus("failed");
        showToast("Payment failed", "error");
      }
    } catch (e: any) {
      setStatus("failed");
      setErr(e?.message ?? "Payment failed");
      showToast(e?.message ?? "Payment failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const resetAddMoney = () => {
    setShowAddMoney(false);
    setStep(1);
    setStatus("idle");
    setErr(null);
    setPendingTopup(null);
  };

  const copyTxnId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      showToast("Transaction ID copied", "success");
    } catch {
      showToast("Could not copy ID", "error");
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-white">Wallet</h1>

      <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-900 dark:bg-zinc-950">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm text-zinc-600 dark:text-zinc-400">Current Balance (BDT)</div>
            <div className="mt-1 text-3xl font-semibold text-zinc-900 dark:text-zinc-100">{loading ? "Loading..." : `${balance ?? 0}`}</div>
            <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Last updated: {lastUpdated ?? "—"}</div>
          </div>
          <button
            onClick={() => refreshAll(filter)}
            className="rounded-lg border border-zinc-300 px-2 py-1 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
            title="Refresh"
          >
            ↻
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => {
            setShowAddMoney(true);
            setStep(1);
            setStatus("idle");
            setErr(null);
          }}
          className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:hover:bg-zinc-800"
        >
          Add Money
        </button>
      </div>

      {showAddMoney && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-xl rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-900 dark:bg-zinc-950">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Add Money</h2>
              <button
                onClick={resetAddMoney}
                className="rounded-lg border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                Close
              </button>
            </div>

            {step === 1 && (
              <form onSubmit={onContinue} className="mt-4">
                <label className="text-sm text-zinc-700 dark:text-zinc-300">
                  Amount (BDT)
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
                    inputMode="numeric"
                    className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-white dark:focus:border-zinc-600"
                  />
                </label>

                <div className="mt-3 flex flex-wrap gap-2">
                  {[100, 200, 500, 1000].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setAmount(String(v))}
                      className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                    >
                      BDT {v}
                    </button>
                  ))}
                </div>

                <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900/40">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-600 dark:text-zinc-400">Top-up fee</span>
                    <span className="text-zinc-900 dark:text-zinc-100">BDT {fee}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">Total payable</span>
                    <span className="font-semibold text-zinc-900 dark:text-zinc-100">BDT {totalPayable || 0}</span>
                  </div>
                </div>

                <button className="mt-4 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:hover:bg-zinc-800">Continue</button>
              </form>
            )}

            {step === 2 && (
              <div className="mt-4">
                <div className="text-sm text-zinc-700 dark:text-zinc-300">Select Payment Method</div>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {[
                    { value: "BKASH" as WalletMethod, name: "bKash", subtitle: "Instant top-up" },
                    { value: "NAGAD" as WalletMethod, name: "Nagad", subtitle: "Instant top-up" },
                    { value: "BANK" as WalletMethod, name: "Bank", subtitle: "Manual verification (5–30 mins)" },
                  ].map((m) => (
                    <button
                      key={m.value}
                      onClick={() => setMethod(m.value)}
                      className={[
                        "rounded-xl border p-3 text-left",
                        method === m.value
                          ? "border-zinc-900 bg-zinc-100 dark:border-zinc-100 dark:bg-zinc-900"
                          : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900",
                      ].join(" ")}
                    >
                      <div className="flex items-center gap-2">
                        <MethodLogo method={m.value} />
                        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{m.name}</div>
                      </div>
                      <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{m.subtitle}</div>
                    </button>
                  ))}
                </div>

                <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900/40">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-600 dark:text-zinc-400">Amount</span>
                    <span className="text-zinc-900 dark:text-zinc-100">BDT {parsedAmount || 0}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-zinc-600 dark:text-zinc-400">Fee</span>
                    <span className="text-zinc-900 dark:text-zinc-100">BDT {fee}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">Total payable</span>
                    <span className="font-semibold text-zinc-900 dark:text-zinc-100">BDT {totalPayable || 0}</span>
                  </div>
                </div>

                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => setStep(1)}
                    className="rounded-xl border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                  >
                    Back
                  </button>
                  <button
                    onClick={onConfirmPay}
                    disabled={busy}
                    className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:hover:bg-zinc-800"
                  >
                    {busy ? "Processing..." : method === "BANK" ? "Proceed" : "Confirm & Pay"}
                  </button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="mt-4">
                {status === "processing" && (
                  <div className="rounded-xl border border-blue-300 bg-blue-50 px-3 py-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
                    Processing payment. Do not close this window. If payment is completed, balance updates automatically within 10–30 seconds.
                  </div>
                )}
                {status === "success" && (
                  <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                    Balance updated.
                  </div>
                )}
                {status === "failed" && (
                  <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                    Payment failed. Please retry.
                  </div>
                )}
                <div className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
                  Top-up ID: <span className="font-mono">{pendingTopup?.topup_id ?? "—"}</span>
                  {pendingTopup?.reference_id ? ` · Reference: ${pendingTopup.reference_id}` : ""}
                </div>
                <a href="mailto:support@smartcafeteria.local" className="mt-3 inline-block text-xs text-blue-700 underline dark:text-blue-300">
                  Support: Payment stuck?
                </a>
                <div className="mt-4 flex gap-2">
                  {status !== "success" && (
                    <button
                      onClick={() => {
                        setStep(2);
                        setStatus("idle");
                      }}
                      className="rounded-xl border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                    >
                      Retry
                    </button>
                  )}
                  <button onClick={resetAddMoney} className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:hover:bg-zinc-800">
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div id="wallet-transactions" className="mt-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Transaction History</h2>
          <div className="flex flex-wrap gap-2">
            {(["all", "success", "pending", "failed"] as const).map((x) => (
              <button
                key={x}
                onClick={() => setFilter(x)}
                className={[
                  "rounded-full border px-3 py-1 text-xs",
                  filter === x
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                    : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900",
                ].join(" ")}
              >
                {x === "all" ? "All" : x === "success" ? "Success" : x === "pending" ? "Pending" : "Failed"}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-900">
          <div className="grid grid-cols-12 gap-2 bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
            <div className="col-span-3">Date/Time</div>
            <div className="col-span-2">Method</div>
            <div className="col-span-2">Amount</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-3">Transaction ID</div>
          </div>
          {transactions.length === 0 && <div className="px-3 py-3 text-sm text-zinc-600 dark:text-zinc-400">No transactions found.</div>}
          {transactions.map((t) => (
            <div key={`${t.transaction_id}-${t.created_at ?? ""}`} className="grid grid-cols-12 gap-2 border-t border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-900 dark:bg-zinc-950">
              <div className="col-span-3 text-zinc-700 dark:text-zinc-300">{t.created_at ? new Date(t.created_at).toLocaleString() : "—"}</div>
              <div className="col-span-2 flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                <MethodLogo method={t.method} />
                <span>{t.method === "BKASH" ? "bKash" : t.method === "NAGAD" ? "Nagad" : "Bank"}</span>
              </div>
              <div className="col-span-2 font-medium text-zinc-900 dark:text-zinc-100">BDT {t.amount}</div>
              <div className="col-span-2">
                <span
                  className={[
                    "rounded-full px-2 py-1",
                    t.status === "Success"
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : t.status === "Failed"
                      ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
                  ].join(" ")}
                >
                  {t.status}
                </span>
              </div>
              <div className="col-span-3 flex items-center gap-2">
                <span className="truncate font-mono text-zinc-700 dark:text-zinc-300">{t.transaction_id}</span>
                <button
                  onClick={() => copyTxnId(t.transaction_id)}
                  className="rounded-md border border-zinc-300 px-2 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                >
                  Copy
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {err && (
        <div className="mt-4 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {err}
        </div>
      )}
    </div>
  );
}
