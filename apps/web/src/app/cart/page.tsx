"use client";

import { useMemo, useState } from "react";
import { clearCart, getCart, setCart, type CartLine } from "@/lib/storage";
import { createOrder } from "@/lib/api";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function CartPage() {
  const router = useRouter();
  const [lines, setLines] = useState(() => getCart());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const total = useMemo(() => lines.reduce((s: number, l: CartLine) => s + l.price * l.qty, 0), [lines]);

  const inc = (id: string) => {
    const next = lines.map((l: CartLine) => (l.id === id ? { ...l, qty: l.qty + 1 } : l));
    setLines(next); setCart(next);
  };
  const dec = (id: string) => {
    const next = lines
      .map((l: CartLine) => (l.id === id ? { ...l, qty: Math.max(0, l.qty - 1) } : l))
      .filter((l: CartLine) => l.qty > 0);
    setLines(next); setCart(next);
  };
  const remove = (id: string) => {
    const next = lines.filter((l: CartLine) => l.id !== id);
    setLines(next); setCart(next);
  };

  const placeOrder = async () => {
    setErr(null);
    setBusy(true);
    try {
      const payload = lines.map((l: CartLine) => ({ id: l.id, qty: l.qty }));
      const res = await createOrder(payload);
      clearCart();
      router.push(`/orders/${res.order_id}`);
    } catch (e: any) {
      setErr(e?.message ?? "Order failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-white">Cart</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Review items before placing your order.</p>
        </div>
        <Link href="/menu" className="text-sm text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white">Back to menu</Link>
      </div>

      {lines.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-900 dark:bg-zinc-950">
          <div className="text-sm text-zinc-700 dark:text-zinc-300">Your cart is empty.</div>
          <Link href="/menu" className="mt-3 inline-block rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:hover:bg-zinc-900">
            Browse menu
          </Link>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {lines.map((l: CartLine) => (
            <div key={l.id} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-900 dark:bg-zinc-950">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-zinc-900 dark:text-white">{l.name}</div>
                  <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-500">BDT {l.price}</div>
                </div>
                <button onClick={() => remove(l.id)} className="text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">
                  Remove
                </button>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button onClick={() => dec(l.id)} className="rounded-lg border border-zinc-300 px-3 py-1 text-sm text-zinc-900 hover:bg-zinc-200 dark:border-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-900">−</button>
                  <div className="min-w-10 text-center text-sm text-zinc-900 dark:text-white">{l.qty}</div>
                  <button onClick={() => inc(l.id)} className="rounded-lg border border-zinc-300 px-3 py-1 text-sm text-zinc-900 hover:bg-zinc-200 dark:border-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-900">+</button>
                </div>
                <div className="text-sm text-zinc-700 dark:text-zinc-300">BDT {l.price * l.qty}</div>
              </div>
            </div>
          ))}

          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-900 dark:bg-zinc-950">
            <div className="flex items-center justify-between">
              <div className="text-sm text-zinc-600 dark:text-zinc-400">Total</div>
              <div className="text-lg font-semibold text-zinc-900 dark:text-white">BDT {total}</div>
            </div>

            {err && <div className="mt-3 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{err}</div>}

            <button
              disabled={busy}
              onClick={placeOrder}
              className="mt-4 w-full rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:hover:bg-zinc-800"
            >
              {busy ? "Placing order…" : "Place order"}
            </button>

            <button
              onClick={() => { clearCart(); setLines([]); }}
              className="mt-2 w-full rounded-xl border border-zinc-300 px-4 py-2 text-sm text-zinc-900 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              Clear cart
            </button>
          </div>
        </div>
      )}
    </div>
  );
}