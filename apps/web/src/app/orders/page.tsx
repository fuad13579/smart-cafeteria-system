"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { deleteOrder, getMyOrders, type OrderDetails } from "@/lib/api";
import { useToast } from "@/components/ToastProvider";

export default function OrdersPage() {
  const { showToast } = useToast();
  const [orders, setOrders] = useState<OrderDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState(false);

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

  const toggleSelect = (orderId: string) => {
    setSelected((prev) => ({ ...prev, [orderId]: !prev[orderId] }));
  };

  const applySelectionAction = (action: string) => {
    if (action === "all") {
      const next: Record<string, boolean> = {};
      for (const order of orders) next[order.order_id] = true;
      setSelected(next);
      return;
    }
    if (action === "none") {
      setSelected({});
    }
  };

  const selectedIds = orders.filter((o) => selected[o.order_id]).map((o) => o.order_id);

  const onDeleteSelected = async () => {
    if (selectedIds.length === 0) {
      showToast("Select order(s) first", "info");
      return;
    }
    try {
      setDeleting(true);
      await Promise.all(selectedIds.map((id) => deleteOrder(id)));
      setOrders((prev) => prev.filter((o) => !selected[o.order_id]));
      setSelected({});
      showToast("Selected orders deleted", "success");
    } catch (e: any) {
      showToast(e?.message ?? "Failed to delete selected orders", "error");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-white">My Orders</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Order History</p>

      {loading && <div className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">Loading orders…</div>}
      {err && (
        <div className="mt-4 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {err}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-900 dark:bg-zinc-950">
        <div className="flex items-center gap-2">
          <select
            defaultValue="all"
            onChange={(e) => {
              applySelectionAction(e.target.value);
            }}
            className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          >
            <option value="all">Select all</option>
            <option value="none">Clear selection</option>
          </select>
          <div className="text-xs text-zinc-600 dark:text-zinc-400">
            Selected: {selectedIds.length}
          </div>
        </div>
        <button
          onClick={onDeleteSelected}
          disabled={deleting || selectedIds.length === 0}
          className="rounded-lg border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </div>

      <div className="mt-6 space-y-3">
        {orders.map((o) => (
          <div key={o.order_id} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-900 dark:bg-zinc-950">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!selected[o.order_id]}
                  onChange={() => toggleSelect(o.order_id)}
                  className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
                />
                <Link href={`/orders/${o.order_id}`} className="text-sm font-medium text-zinc-900 hover:underline dark:text-zinc-100">
                  {o.order_id}
                </Link>
              </div>
              <div className="flex items-center gap-2">
                <div className="rounded-full bg-zinc-200 px-3 py-1 text-xs dark:bg-zinc-800">{o.status}</div>
              </div>
            </div>
            <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
              ETA: {o.eta_minutes} min · Total: BDT {o.total_amount ?? 0}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
