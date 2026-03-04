"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { deleteOrder, getMyOrders, getOrderSlipUrl, markOrderSlipPrinted, type OrderDetails } from "@/lib/api";
import { useToast } from "@/components/ToastProvider";

function buildMockSlipHtml(input: {
  orderId: string;
  tokenNo: number | null;
  pickupCounter: number | null;
  status: string;
  eta: number;
}) {
  const now = new Date().toLocaleString();
  const token = input.tokenNo ?? "-";
  const counter = input.pickupCounter ?? 1;
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Order Slip</title>
    <style>
      @media print { @page { size: A6; margin: 8mm; } }
      body { font-family: Arial, sans-serif; margin: 0; padding: 12px; color: #111; }
      .box { border: 1px solid #111; border-radius: 8px; padding: 12px; }
      .token { font-size: 36px; font-weight: 700; text-align: center; margin: 8px 0 10px; }
      .row { margin: 4px 0; font-size: 12px; }
      .muted { color: #555; }
    </style>
  </head>
  <body>
    <div class="box">
      <div class="muted">Smart Cafeteria - Demo Slip</div>
      <div class="token">TOKEN #${token}</div>
      <div class="row"><strong>Order:</strong> ${input.orderId}</div>
      <div class="row"><strong>Counter:</strong> ${counter}</div>
      <div class="row"><strong>Status:</strong> ${input.status}</div>
      <div class="row"><strong>ETA:</strong> ${input.eta} min</div>
      <div class="row"><strong>Printed:</strong> ${now}</div>
    </div>
    <script>window.print()</script>
  </body>
</html>`;
}

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
        const nextOrders = Array.isArray(res?.orders) ? res.orders : [];
        const sorted = [...nextOrders].sort((a, b) => {
          const aTs = a.created_at ? new Date(a.created_at).getTime() : 0;
          const bTs = b.created_at ? new Date(b.created_at).getTime() : 0;
          return bTs - aTs;
        });
        setErr(null);
        setOrders(sorted);
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

  const onPrintSlip = async (order: OrderDetails) => {
    if (process.env.NEXT_PUBLIC_API_MODE !== "real") {
      const w = window.open("", "_blank", "noopener,noreferrer");
      if (!w) {
        showToast("Popup blocked by browser", "error");
        return;
      }
      w.document.open();
      w.document.write(
        buildMockSlipHtml({
          orderId: order.order_id,
          tokenNo: typeof order.token_no === "number" ? order.token_no : null,
          pickupCounter: typeof order.pickup_counter === "number" ? order.pickup_counter : null,
          status: order.status,
          eta: Math.max(0, order.eta_minutes ?? 0),
        })
      );
      w.document.close();
      return;
    }

    const popup = window.open(getOrderSlipUrl(order.order_id, true), "_blank", "noopener,noreferrer");
    if (!popup) {
      showToast("Popup blocked by browser", "error");
      return;
    }

    try {
      await markOrderSlipPrinted(order.order_id);
    } catch {
      // non-blocking metadata update
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

      {orders.length > 0 && (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-900 dark:bg-zinc-950">
          <div className="flex items-center gap-2">
            <select
              defaultValue="none"
              onChange={(e) => {
                applySelectionAction(e.target.value);
              }}
              className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            >
              <option value="none">Clear selection</option>
              <option value="all">Select all</option>
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
      )}

      <div className="mt-6 space-y-3">
        {!loading && !err && orders.length === 0 && (
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-700 dark:border-zinc-900 dark:bg-zinc-950 dark:text-zinc-300">
            <p>You have no orders yet.</p>
            <Link href="/menu" className="mt-2 inline-block font-medium text-zinc-900 hover:underline dark:text-zinc-100">
              Browse menu
            </Link>
          </div>
        )}
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
                <button
                  onClick={() => onPrintSlip(o)}
                  className="rounded-lg border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                >
                  Print token
                </button>
              </div>
            </div>
            <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
              Token: #{o.token_no ?? "-"} · Counter: {o.pickup_counter ?? "-"} · ETA: {o.eta_minutes} min · Total: BDT {o.total_amount ?? 0}
              {o.ready_until ? ` · Pickup by: ${new Date(o.ready_until).toLocaleTimeString()}` : ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
