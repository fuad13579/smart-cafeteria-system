"use client";

import { useEffect, useState } from "react";

type KitchenItem = { name: string; qty: number };
type KitchenOrder = {
  order_id: string;
  token_no: number;
  pickup_counter: number;
  pickup_extend_count: number;
  status: "QUEUED" | "IN_PROGRESS" | "READY" | "COMPLETED" | "CANCELLED";
  eta_minutes: number;
  total_amount: number;
  ready_until?: string | null;
  is_expired?: boolean;
  created_at?: string | null;
  items: KitchenItem[];
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8002";
const API_PREFIX = process.env.NEXT_PUBLIC_API_PREFIX || "/api";
const API_ROOT = `${API_BASE.replace(/\/+$/, "")}/${API_PREFIX.replace(/^\/+|\/+$/g, "")}`;

async function apiGetOrders(): Promise<KitchenOrder[]> {
  const res = await fetch(`${API_ROOT}/admin/kitchen/orders`, {
    credentials: "include",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.detail ?? "Failed to load kitchen orders");
  return data.orders ?? [];
}

async function apiGetPeakMode(): Promise<boolean> {
  const res = await fetch(`${API_ROOT}/admin/kitchen/peak-mode`, {
    credentials: "include",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.detail ?? "Failed to load kitchen mode");
  return !!data.peak_mode;
}

async function apiSetStatus(orderId: string, action: "start" | "ready" | "complete" | "extend" | "cancel"): Promise<void> {
  const res = await fetch(`${API_ROOT}/admin/kitchen/orders/${encodeURIComponent(orderId)}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ action }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.detail ?? "Failed to update order");
}

export default function KitchenPage() {
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [peakMode, setPeakMode] = useState(false);
  const [nowTs, setNowTs] = useState<number>(Date.now());

  const load = async () => {
    try {
      const [data, mode] = await Promise.all([apiGetOrders(), apiGetPeakMode()]);
      setOrders(data);
      setPeakMode(mode);
      setErr(null);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load kitchen data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const changeStatus = async (orderId: string, action: "start" | "ready" | "complete" | "extend" | "cancel") => {
    try {
      setBusy(`${orderId}:${action}`);
      await apiSetStatus(orderId, action);
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to update order");
    } finally {
      setBusy(null);
    }
  };

  const withMeta = orders.map((o) => {
    const readyUntilDate = o.ready_until ? new Date(o.ready_until) : null;
    const remainingSec = readyUntilDate ? Math.floor((readyUntilDate.getTime() - nowTs) / 1000) : null;
    const expired = o.status === "READY" && (o.is_expired || (remainingSec !== null && remainingSec <= 0));
    return { ...o, readyUntilDate, remainingSec, expired };
  });

  const sortedOrders = [...withMeta].sort((a, b) => {
    const aReady = a.status === "READY";
    const bReady = b.status === "READY";
    if (aReady && bReady) {
      if (a.expired !== b.expired) return a.expired ? -1 : 1;
      const at = a.readyUntilDate ? a.readyUntilDate.getTime() : Number.MAX_SAFE_INTEGER;
      const bt = b.readyUntilDate ? b.readyUntilDate.getTime() : Number.MAX_SAFE_INTEGER;
      if (at !== bt) return at - bt;
    }
    const ac = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bc = b.created_at ? new Date(b.created_at).getTime() : 0;
    return ac - bc;
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-white">Kitchen Board</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Token + counter operations</p>
      <div
        className={[
          "mt-3 inline-block rounded-full border px-3 py-1 text-xs",
          peakMode
            ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
            : "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
        ].join(" ")}
      >
        {peakMode ? "Peak mode ON - manual controls enabled" : "Peak mode OFF - auto kitchen flow"}
      </div>

      {loading && <div className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">Loading…</div>}
      {err && (
        <div className="mt-4 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {err}
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
        {sortedOrders.map((o) => (
          <div
            key={o.order_id}
            className={[
              "rounded-2xl border bg-zinc-50 p-4 dark:bg-zinc-950",
              o.expired ? "border-amber-300 dark:border-amber-900" : "border-zinc-200 dark:border-zinc-900",
            ].join(" ")}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="text-3xl font-bold text-zinc-900 dark:text-white">#{o.token_no}</div>
                <div className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">Counter {o.pickup_counter}</div>
                <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-500">Extensions used: {o.pickup_extend_count}/1</div>
                <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-500">{o.order_id}</div>
              </div>
              <div className="rounded-full bg-zinc-200 px-3 py-1 text-xs dark:bg-zinc-800">{o.status}</div>
            </div>

            <div className="mt-3 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
              {o.items.map((item, idx) => (
                <div key={`${o.order_id}-${idx}`}>
                  {item.name} x{item.qty}
                </div>
              ))}
            </div>

            {o.ready_until && (
              <div className={["mt-3 text-xs", o.expired ? "text-amber-700 dark:text-amber-300" : "text-zinc-600 dark:text-zinc-400"].join(" ")}>
                {!o.expired ? (
                  <>
                    Pickup before {new Date(o.ready_until).toLocaleTimeString()}{" "}
                    {o.remainingSec !== null && o.remainingSec > 0
                      ? `(${Math.floor(o.remainingSec / 60)}m ${o.remainingSec % 60}s left)`
                      : ""}
                  </>
                ) : (
                  "Pickup window expired"
                )}
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => changeStatus(o.order_id, "start")}
                disabled={!peakMode || o.status !== "QUEUED" || busy === `${o.order_id}:start`}
                className="rounded-lg border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Start
              </button>
              <button
                onClick={() => changeStatus(o.order_id, "ready")}
                disabled={!peakMode || o.status !== "IN_PROGRESS" || busy === `${o.order_id}:ready`}
                className="rounded-lg border border-amber-300 px-3 py-1 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-40 dark:border-amber-900 dark:text-amber-300 dark:hover:bg-amber-950/40"
              >
                Ready
              </button>
              <button
                onClick={() => changeStatus(o.order_id, "complete")}
                disabled={!peakMode || o.status !== "READY" || busy === `${o.order_id}:complete`}
                className="rounded-lg border border-emerald-300 px-3 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:border-emerald-900 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
              >
                Complete
              </button>
              <button
                onClick={() => changeStatus(o.order_id, "extend")}
                disabled={!peakMode || o.status !== "READY" || !o.expired || o.pickup_extend_count >= 1 || busy === `${o.order_id}:extend`}
                className="rounded-lg border border-blue-300 px-3 py-1 text-xs text-blue-700 hover:bg-blue-50 disabled:opacity-40 dark:border-blue-900 dark:text-blue-300 dark:hover:bg-blue-950/40"
              >
                Extend +10m
              </button>
              <button
                onClick={() => changeStatus(o.order_id, "cancel")}
                disabled={!peakMode || o.status !== "READY" || busy === `${o.order_id}:cancel`}
                className="rounded-lg border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-40 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
              >
                No-show / Cancel
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
