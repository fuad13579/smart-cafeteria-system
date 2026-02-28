"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getMyOrders, type OrderDetails } from "@/lib/api";

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await getMyOrders();
        if (cancelled) return;
        setErr(null);
        setOrders(res.orders);
      } catch (e: any) {
        if (cancelled) return;
        setErr(e?.message ?? "Failed to load your orders");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    const t = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-white">My Orders</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Reload-safe order history from backend.</p>

      {loading && <div className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">Loading orders…</div>}
      {err && (
        <div className="mt-4 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {err}
        </div>
      )}

      <div className="mt-6 space-y-3">
        {orders.map((o) => (
          <Link
            key={o.order_id}
            href={`/orders/${o.order_id}`}
            className="block rounded-2xl border border-zinc-200 bg-zinc-50 p-4 hover:bg-zinc-100 dark:border-zinc-900 dark:bg-zinc-950 dark:hover:bg-zinc-900"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{o.order_id}</div>
              <div className="rounded-full bg-zinc-200 px-3 py-1 text-xs dark:bg-zinc-800">{o.status}</div>
            </div>
            <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
              ETA: {o.eta_minutes} min · Total: BDT {o.total_amount ?? 0}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
