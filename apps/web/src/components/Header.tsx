"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { getCart, getUser, type CartLine, type User } from "@/lib/storage";
import { usePathname } from "next/navigation";

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/" && pathname?.startsWith(href));

  return (
    <Link
      href={href}
      className={[
        "rounded-full px-3 py-1 text-sm transition",
        active
          ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-white"
          : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-white",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}

export function Header() {
  const isDemoMode = process.env.NEXT_PUBLIC_API_MODE !== "real";
  const [cartCount, setCartCount] = useState(0);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const sync = () => {
      const cart = getCart();
      setCartCount(cart.reduce((a: number, c: CartLine) => a + c.qty, 0));
      setCurrentUser(getUser());
    };

    sync();
    window.addEventListener("storage", sync);
    const t = setInterval(sync, 800);

    return () => {
      window.removeEventListener("storage", sync);
      clearInterval(t);
    };
  }, []);

  const toggleTheme = () => {
    if (!mounted) return;
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  };

  return (
    <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-900 dark:bg-zinc-950/80">
      {isDemoMode && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-1 text-center text-xs font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          Demo Mode
        </div>
      )}
      <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
        <Link href="/menu" className="flex items-center gap-2">
          <Image src="/iut-logo.png" alt="IUT logo" width={36} height={36} className="rounded-md object-contain" />
          <div className="leading-tight">
            <div className="text-sm font-semibold text-zinc-900 dark:text-white">Smart Cafeteria</div>
            <div className="text-xs text-zinc-600 dark:text-zinc-400">Islamic University of Technology</div>
          </div>
        </Link>

        <nav className="flex items-center gap-2">
          <NavLink href="/menu" label="Menu" />
          <NavLink href="/cart" label={`Cart (${cartCount})`} />
          <NavLink href="/wallet" label="Wallet" />
          <NavLink href="/orders" label="Orders" />
          {currentUser?.role === "admin" && <NavLink href="/kitchen" label="Kitchen" />}
          {currentUser?.role === "admin" && <NavLink href="/admin" label="Admin" />}

          <NavLink href="/login" label="Login" />

          <button
            onClick={toggleTheme}
            className="rounded-full border border-zinc-200 px-3 py-1 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            {mounted ? (resolvedTheme === "dark" ? "Light" : "Dark") : "Theme"}
          </button>
        </nav>
      </div>
    </header>
  );
}
