"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getOrder, type OrderStatus } from "@/lib/api";

const steps: OrderStatus[] = [
  "QUEUED",
  "IN_PROGRESS",
  "READY",
  "COMPLETED",
  "CANCELLED",
];
const terminalStates: OrderStatus[] = ["READY", "COMPLETED", "CANCELLED"];

function Step({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className={["h-3 w-3 rounded-full", active ? "bg-zinc-900 dark:bg-white" : "bg-zinc-300 dark:bg-zinc-800"].join(" ")} />
      <div className={["text-sm", active ? "text-zinc-900 dark:text-white" : "text-zinc-600 dark:text-zinc-500"].join(" ")}>{label}</div>
    </div>
  );
}

export default function OrderPage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;
  const [status, setStatus] = useState<OrderStatus>("QUEUED");
  const [eta, setEta] = useState<number>(12);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let pollRef: ReturnType<typeof setInterval> | null = null;

    const load = async (showLoading = false) => {
      if (!orderId) return;
      if (showLoading) setLoading(true);
      try {
        const res = await getOrder(orderId);
        if (cancelled) return;
        setErr(null);
        setStatus(res.status);
        setEta(Math.max(0, res.eta_minutes ?? 0));
        if (terminalStates.includes(res.status) && pollRef) {
          clearInterval(pollRef);
          pollRef = null;
        }
      } catch (e: any) {
        if (cancelled) return;
        setErr(e?.message ?? "Failed to load order status");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load(true);
    pollRef = setInterval(() => {
      if (terminalStates.includes(status)) return;
      load(false);
    }, 4000);

    return () => {
      cancelled = true;
      if (pollRef) clearInterval(pollRef);
    };
  }, [orderId, status]);

  const activeIndex = steps.indexOf(status);
  const retry = () => {
    if (!orderId) return;
    setLoading(true);
    getOrder(orderId)
      .then((res) => {
        setErr(null);
        setStatus(res.status);
        setEta(Math.max(0, res.eta_minutes ?? 0));
      })
      .catch((e: any) => setErr(e?.message ?? "Failed to load order status"))
      .finally(() => setLoading(false));
  };

  return (
    <div className="mx-auto max-w-xl">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-white">Order tracking</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Order ID <span className="text-zinc-900 dark:text-zinc-200">{params.id}</span>
          </p>
        </div>
        <Link href="/menu" className="text-sm text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white">New order</Link>
      </div>

      <div className="mt-6 rounded-2xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-900 dark:bg-zinc-950">
        {loading && (
          <div className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">Loading order status…</div>
        )}
        {err && (
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <div>{err}</div>
            <button
              onClick={retry}
              className="mt-2 rounded-lg border border-amber-400 px-3 py-1 text-xs hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900/40"
            >
              Retry now
            </button>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Current status</div>
          <div className="rounded-full bg-zinc-200 px-3 py-1 text-xs text-zinc-900 dark:bg-zinc-900 dark:text-zinc-200">{status}</div>
        </div>

        <div className="mt-4 space-y-3">
          {steps.map((s, idx) => (
            <Step key={s} label={s.replace("_", " ")} active={idx <= activeIndex} />
          ))}
        </div>

        <div className="mt-5 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
          Estimated time: <span className="font-medium text-zinc-900 dark:text-white">{eta} min</span>
        </div>

        <div className="mt-3 text-xs text-zinc-600 dark:text-zinc-500">
          Updates every 4 seconds while order is active.
        </div>
      </div>
    </div>
  );
}
