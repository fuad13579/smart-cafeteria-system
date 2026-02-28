"use client";

import { useEffect, useMemo, useState } from "react";
import { getMenu, type MenuContext, type MenuItem } from "@/lib/api";
import { getCart, setCart, type CartLine } from "@/lib/storage";
import { useToast } from "@/components/ToastProvider";
import Link from "next/link";

export default function MenuPage() {
  const { showToast } = useToast();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [context, setContext] = useState<MenuContext>("auto");
  const [activeContext, setActiveContext] = useState<"regular" | "iftar" | "saheri">("regular");
  const [nextChangeAt, setNextChangeAt] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const res = await getMenu(context);
        setItems(res.items);
        setActiveContext((res.active_context as "regular" | "iftar" | "saheri" | undefined) ?? "regular");
        setNextChangeAt(res.next_change_at ?? null);
      } catch (e: any) {
        setErr(e?.message ?? "Failed to load menu");
      } finally {
        setLoading(false);
      }
    })();
  }, [context]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((i) => i.name.toLowerCase().includes(s));
  }, [items, q]);

  const add = (item: MenuItem) => {
    const cart = getCart();
    const idx = cart.findIndex((c: CartLine) => c.id === item.id);
    const next: CartLine[] =
      idx >= 0
        ? cart.map((c: CartLine, i: number) => (i === idx ? { ...c, qty: c.qty + 1 } : c))
        : [...cart, { id: item.id, name: item.name, price: item.price, qty: 1, available: item.available }];
    setCart(next);
    showToast(`${item.name} added to cart`, "success");
  };

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-white">Menu</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Quick picks, live availability.</p>
          <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            Active context: <span className="font-medium">{activeContext}</span>
            {nextChangeAt ? ` · Next change: ${new Date(nextChangeAt).toLocaleString()}` : ""}
          </div>
        </div>

        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search items…"
            className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder-zinc-500 focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-white dark:placeholder-zinc-400 dark:focus:border-zinc-600 sm:w-64"
          />
          <Link
            href="/cart"
            className="rounded-xl border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            View cart
          </Link>
        </div>
      </div>

      {loading && <div className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">Loading menu…</div>}
      {err && <div className="mt-6 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{err}</div>}

      <div className="mt-4 flex flex-wrap gap-2">
        {(["auto", "regular", "iftar", "saheri"] as const).map((ctx) => (
          <button
            key={ctx}
            onClick={() => setContext(ctx)}
            className={[
              "rounded-full border px-3 py-1 text-xs transition",
              context === ctx
                ? "border-zinc-800 bg-zinc-900 text-white dark:border-zinc-200 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900",
            ].join(" ")}
          >
            {ctx.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3">
        {filtered.map((item) => (
          <div key={item.id} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-900 dark:bg-zinc-950">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-zinc-900 dark:text-white">{item.name}</div>
                <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-500">BDT {item.price}</div>
              </div>
              <span
                className={[
                  "rounded-full px-2 py-1 text-xs",
                  item.available 
                    ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-200" 
                    : "bg-zinc-200/50 text-zinc-600 dark:bg-zinc-900/40 dark:text-zinc-500",
                ].join(" ")}
              >
                {item.available ? "Available" : "Sold out"}
              </span>
            </div>

            <button
              disabled={!item.available}
              onClick={() => add(item)}
              className="mt-4 w-full rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-40 dark:hover:bg-zinc-800"
            >
              Add to cart
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
