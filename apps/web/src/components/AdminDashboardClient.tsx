"use client";

import { useEffect, useMemo, useState } from "react";

type Service = { name: string; status: "up" | "down" | "degraded" };
type HealthResp = { services: Service[]; updatedAt: string };

type MetricsResp = {
  latency_ms_p50: number;
  latency_ms_p95: number;
  orders_per_min: number;
  queue_depth: number;
  updatedAt: string;
};

type AdminMenuItem = {
  id: string;
  name: string;
  price: number;
  stock_quantity: number;
  available: boolean;
};

function Badge({ status }: { status: Service["status"] }) {
  const cls =
    status === "up"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
      : status === "degraded"
      ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
      : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200";

  const label = status === "up" ? "Healthy" : status === "degraded" ? "Degraded" : "Down";

  return <span className={`rounded-full border px-2 py-1 text-xs ${cls}`}>{label}</span>;
}

function StatCard({ title, value, sub }: { title: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-900 dark:bg-zinc-950">
      <div className="text-xs text-zinc-600 dark:text-zinc-500">{title}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-500">{sub}</div>
    </div>
  );
}

export function AdminDashboardClient() {
  const [health, setHealth] = useState<HealthResp | null>(null);
  const [metrics, setMetrics] = useState<MetricsResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [targetService, setTargetService] = useState("order-gateway");
  const [action, setAction] = useState<"kill" | "restart">("kill");
  const [menuItems, setMenuItems] = useState<AdminMenuItem[]>([]);
  const [menuBusy, setMenuBusy] = useState(false);
  const [menuMessage, setMenuMessage] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [itemName, setItemName] = useState("");
  const [itemPrice, setItemPrice] = useState("0");
  const [itemStock, setItemStock] = useState("0");
  const [itemAvailable, setItemAvailable] = useState(true);

  const services = useMemo(() => health?.services ?? [], [health]);

  async function loadMenu() {
    try {
      const res = await fetch("/api/admin/menu", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail ?? data?.error ?? "Failed to load menu");
      setMenuItems(data.items ?? []);
    } catch (e: any) {
      setMenuMessage(e?.message ?? "Failed to load menu");
    }
  }

  useEffect(() => {
    let alive = true;

    async function refresh() {
      try {
        const [h, m] = await Promise.all([
          fetch("/api/admin/health", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/admin/metrics", { cache: "no-store" }).then((r) => r.json()),
        ]);
        if (!alive) return;
        setHealth(h);
        setMetrics(m);
      } catch {
        // ignore transient fetch failures in dashboard poller
      }
    }

    refresh();
    loadMenu();
    const t = setInterval(refresh, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const runChaos = async () => {
    setBusy(true);
    setToast(null);
    try {
      const res = await fetch("/api/admin/chaos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service: targetService, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Chaos action failed");
      setToast(data.message ?? "Chaos action sent");
      setTimeout(() => setToast(null), 1600);
    } catch (e: any) {
      setToast(e?.message ?? "Chaos action failed");
      setTimeout(() => setToast(null), 2000);
    } finally {
      setBusy(false);
    }
  };

  const clearForm = () => {
    setSelectedId("");
    setItemName("");
    setItemPrice("0");
    setItemStock("0");
    setItemAvailable(true);
  };

  const onCreateMenuItem = async () => {
    setMenuBusy(true);
    setMenuMessage(null);
    try {
      const res = await fetch("/api/admin/menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: itemName,
          price: Number(itemPrice),
          stock_quantity: Number(itemStock),
          available: itemAvailable,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail ?? data?.error ?? "Create failed");
      setMenuMessage("Menu item created");
      clearForm();
      await loadMenu();
    } catch (e: any) {
      setMenuMessage(e?.message ?? "Create failed");
    } finally {
      setMenuBusy(false);
    }
  };

  const onUpdateMenuItem = async () => {
    if (!selectedId) return;
    setMenuBusy(true);
    setMenuMessage(null);
    try {
      const res = await fetch(`/api/admin/menu/${selectedId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: itemName,
          price: Number(itemPrice),
          stock_quantity: Number(itemStock),
          available: itemAvailable,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail ?? data?.error ?? "Update failed");
      setMenuMessage("Menu item updated");
      await loadMenu();
    } catch (e: any) {
      setMenuMessage(e?.message ?? "Update failed");
    } finally {
      setMenuBusy(false);
    }
  };

  const onToggleAvailability = async (item: AdminMenuItem) => {
    setMenuBusy(true);
    setMenuMessage(null);
    try {
      const res = await fetch(`/api/admin/menu/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ available: !item.available }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail ?? data?.error ?? "Toggle failed");
      setMenuMessage(`Item ${item.id} updated`);
      await loadMenu();
    } catch (e: any) {
      setMenuMessage(e?.message ?? "Toggle failed");
    } finally {
      setMenuBusy(false);
    }
  };

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Admin Dashboard</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Health grid, live metrics and chaos controls.
          </p>
        </div>
        <div className="text-xs text-zinc-500">
          {health?.updatedAt ? `Health updated: ${new Date(health.updatedAt).toLocaleTimeString()}` : "Loading…"}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <StatCard
          title="Latency (p50)"
          value={metrics ? `${metrics.latency_ms_p50} ms` : "—"}
          sub="Median response time"
        />
        <StatCard
          title="Latency (p95)"
          value={metrics ? `${metrics.latency_ms_p95} ms` : "—"}
          sub="Worst-case baseline"
        />
        <StatCard
          title="Throughput"
          value={metrics ? `${metrics.orders_per_min}/min` : "—"}
          sub="Orders per minute"
        />
        <StatCard
          title="Kitchen queue"
          value={metrics ? `${metrics.queue_depth}` : "—"}
          sub="Tickets waiting"
        />
      </div>

      <div className="mt-6 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-900 dark:bg-zinc-950">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Service Health</div>
          <div className="text-xs text-zinc-500">Green = healthy</div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {services.map((s) => (
            <div key={s.name} className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-900 dark:bg-zinc-950">
              <div className="text-sm text-zinc-900 dark:text-zinc-200">{s.name}</div>
              <Badge status={s.status} />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-900 dark:bg-zinc-950">
        <div className="text-sm font-medium">Chaos Control</div>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Use during demo to prove fault tolerance (mock now, real later).
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <div className="text-xs text-zinc-500">Target service</div>
            <select
              value={targetService}
              onChange={(e) => setTargetService(e.target.value)}
              className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600"
            >
              {(health?.services ?? [
                { name: "identity-provider", status: "up" },
                { name: "order-gateway", status: "up" },
                { name: "stock-service", status: "up" },
                { name: "kitchen-queue", status: "up" },
                { name: "notification-hub", status: "up" },
              ]).map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="text-xs text-zinc-500">Action</div>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as any)}
              className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600"
            >
              <option value="kill">Kill</option>
              <option value="restart">Restart</option>
            </select>
          </div>

          <div className="flex items-end">
            <button
              onClick={runChaos}
              disabled={busy}
              className="w-full rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {busy ? "Sending…" : "Run chaos"}
            </button>
          </div>
        </div>

        {toast && (
          <div className="mt-4 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
            {toast}
          </div>
        )}
      </div>

      <div className="mt-6 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-900 dark:bg-zinc-950">
        <div className="text-sm font-medium">Menu Manager</div>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Add, edit, and toggle menu items for daily updates.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
          <input
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
            placeholder="Item name"
            className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600"
          />
          <input
            value={itemPrice}
            onChange={(e) => setItemPrice(e.target.value)}
            placeholder="Price"
            type="number"
            min={0}
            className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600"
          />
          <input
            value={itemStock}
            onChange={(e) => setItemStock(e.target.value)}
            placeholder="Stock"
            type="number"
            min={0}
            className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600"
          />
          <label className="flex items-center gap-2 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
            <input type="checkbox" checked={itemAvailable} onChange={(e) => setItemAvailable(e.target.checked)} />
            Available
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={onCreateMenuItem}
            disabled={menuBusy || !itemName.trim()}
            className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            Add item
          </button>
          <button
            onClick={onUpdateMenuItem}
            disabled={menuBusy || !selectedId}
            className="rounded-xl border border-zinc-300 px-4 py-2 text-sm text-zinc-900 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-900"
          >
            Save selected
          </button>
          <button
            onClick={clearForm}
            disabled={menuBusy}
            className="rounded-xl border border-zinc-300 px-4 py-2 text-sm text-zinc-900 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-900"
          >
            Clear
          </button>
        </div>

        {menuMessage && (
          <div className="mt-3 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
            {menuMessage}
          </div>
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-600 dark:text-zinc-400">
                <th className="py-2 pr-3">ID</th>
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Price</th>
                <th className="py-2 pr-3">Stock</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {menuItems.map((item) => (
                <tr key={item.id} className="border-t border-zinc-200 dark:border-zinc-900">
                  <td className="py-2 pr-3">{item.id}</td>
                  <td className="py-2 pr-3">{item.name}</td>
                  <td className="py-2 pr-3">{item.price}</td>
                  <td className="py-2 pr-3">{item.stock_quantity}</td>
                  <td className="py-2 pr-3">{item.available ? "Available" : "Hidden"}</td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => {
                          setSelectedId(item.id);
                          setItemName(item.name);
                          setItemPrice(String(item.price));
                          setItemStock(String(item.stock_quantity));
                          setItemAvailable(item.available);
                        }}
                        className="rounded-lg border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-900"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => onToggleAvailability(item)}
                        className="rounded-lg border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-900"
                      >
                        {item.available ? "Hide" : "Show"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
