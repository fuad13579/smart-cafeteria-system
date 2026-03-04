"use client";

import { useEffect, useMemo, useState } from "react";
import { getMenu, type MenuItem, type MenuMain, type MenuSlot } from "@/lib/api";
import { getCart, getUser, setCart, type CartLine, type User } from "@/lib/storage";
import { useToast } from "@/components/ToastProvider";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

const MAIN_OPTIONS: MenuMain[] = ["regular", "ramadan"];
const SLOT_OPTIONS: Record<MenuMain, MenuSlot[]> = {
  regular: ["breakfast", "lunch", "dinner"],
  ramadan: ["iftar", "suhoor"],
};
const DEFAULT_SLOT: Record<MenuMain, MenuSlot> = {
  regular: "breakfast",
  ramadan: "iftar",
};

function pretty(v: string): string {
  return v.charAt(0).toUpperCase() + v.slice(1);
}

export default function MenuClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();

  const [items, setItems] = useState<MenuItem[]>([]);
  const [nextChangeAt, setNextChangeAt] = useState<string | null>(null);
  const [ramadanVisible, setRamadanVisible] = useState(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const requestedMain = (searchParams.get("main") || "regular").toLowerCase();
  const currentMain: MenuMain = MAIN_OPTIONS.includes(requestedMain as MenuMain) ? (requestedMain as MenuMain) : "regular";
  const requestedSlot = (searchParams.get("slot") || DEFAULT_SLOT[currentMain]).toLowerCase();
  const currentSlot: MenuSlot = SLOT_OPTIONS[currentMain].includes(requestedSlot as MenuSlot)
    ? (requestedSlot as MenuSlot)
    : DEFAULT_SLOT[currentMain];

  useEffect(() => {
    const isMainValid = MAIN_OPTIONS.includes((searchParams.get("main") || "").toLowerCase() as MenuMain);
    const isSlotValid = SLOT_OPTIONS[currentMain].includes((searchParams.get("slot") || "").toLowerCase() as MenuSlot);
    if (!isMainValid || !isSlotValid) {
      router.replace(`/menu?main=${currentMain}&slot=${currentSlot}`);
    }
  }, [searchParams, currentMain, currentSlot, router]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const res = await getMenu(currentMain, currentSlot);
        setItems(res.items);
        setNextChangeAt(res.next_change_at ?? null);
        setRamadanVisible(res.ramadan_visible ?? true);
      } catch (e: any) {
        setErr(e?.message ?? "Failed to load menu");
      } finally {
        setLoading(false);
      }
    })();
  }, [currentMain, currentSlot]);

  useEffect(() => {
    const sync = () => setCurrentUser(getUser());
    sync();
    window.addEventListener("storage", sync);
    const t = setInterval(sync, 1000);
    return () => {
      window.removeEventListener("storage", sync);
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!ramadanVisible && currentMain === "ramadan") {
      router.replace("/menu?main=regular&slot=breakfast");
    }
  }, [ramadanVisible, currentMain, router]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((i) => !s || i.name.toLowerCase().includes(s));
  }, [items, q]);

  const switchMain = (nextMain: MenuMain) => {
    const nextSlot = DEFAULT_SLOT[nextMain];
    router.replace(`/menu?main=${nextMain}&slot=${nextSlot}`);
  };

  const switchSlot = (nextSlot: MenuSlot) => {
    router.replace(`/menu?main=${currentMain}&slot=${nextSlot}`);
  };

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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-white">Menu</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {pretty(currentMain)} → {pretty(currentSlot)}
            {nextChangeAt ? ` · Next change at: ${new Date(nextChangeAt).toLocaleTimeString()}` : ""}
          </p>
        </div>

        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          {typeof currentUser?.account_balance === "number" && (
            <div className="mb-1 text-sm text-zinc-700 dark:text-zinc-300">
              Account balance: <span className="font-semibold">BDT {currentUser.account_balance}</span>
            </div>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search items..."
              className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder-zinc-500 focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-white dark:placeholder-zinc-400 dark:focus:border-zinc-600 sm:w-64"
            />
            <Link
              href="/cart"
              className="w-full rounded-xl border border-zinc-300 px-4 py-2 text-center text-sm text-zinc-700 hover:bg-zinc-100 sm:w-auto dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              View cart
            </Link>
          </div>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        {(ramadanVisible ? MAIN_OPTIONS : (["regular"] as const)).map((m) => (
          <button
            key={m}
            onClick={() => switchMain(m)}
            className={[
              "rounded-xl border px-4 py-2 text-sm font-medium transition",
              currentMain === m
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900",
            ].join(" ")}
          >
            {pretty(m)}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {SLOT_OPTIONS[currentMain].map((s) => (
          <button
            key={s}
            onClick={() => switchSlot(s)}
            className={[
              "rounded-full border px-3 py-1 text-xs transition",
              currentSlot === s
                ? "border-zinc-800 bg-zinc-900 text-white dark:border-zinc-200 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900",
            ].join(" ")}
          >
            {pretty(s)}
          </button>
        ))}
      </div>

      {loading && <div className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">Loading menu...</div>}
      {err && <div className="mt-6 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{err}</div>}

      <div className="mt-6 grid grid-cols-1 gap-3">
        {filtered.map((item) => {
          const stock = item.stock_quantity ?? 0;
          const availability = !item.available ? "sold_out" : stock <= 5 ? "low" : "available";
          const badgeClass =
            availability === "sold_out"
              ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300"
              : availability === "low"
              ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
              : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";

          return (
            <div key={item.id} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-900 dark:bg-zinc-950">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-zinc-900 dark:text-white">{item.name}</div>
                  <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-500">BDT {item.price}</div>
                </div>
                <span className={`rounded-full px-2 py-1 text-xs ${badgeClass}`}>
                  {availability === "sold_out" ? "Sold out" : availability === "low" ? "Low" : "Available"}
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
          );
        })}
      </div>
    </div>
  );
}
