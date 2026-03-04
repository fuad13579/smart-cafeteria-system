"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function MobileTabBar({ cartCount }: { cartCount: number }) {
  const pathname = usePathname();

  const Tab = ({ href, label }: { href: string; label: string }) => {
    const active = pathname === href || (href !== "/" && pathname?.startsWith(href));
    return (
      <Link
        href={href}
        className={[
          "flex flex-1 flex-col items-center justify-center gap-1 py-2 text-xs",
          active ? "text-zinc-900 dark:text-white" : "text-zinc-500 dark:text-zinc-400",
        ].join(" ")}
      >
        <div className="relative">
          <span className="text-sm">{label}</span>
          {href === "/cart" && cartCount > 0 && (
            <span className="absolute -right-3 -top-2 rounded-full bg-zinc-900 px-1.5 py-0.5 text-[10px] text-white dark:bg-white dark:text-zinc-900">
              {cartCount}
            </span>
          )}
        </div>
      </Link>
    );
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-900 dark:bg-zinc-950/90 sm:hidden">
      <div className="mx-auto flex max-w-4xl px-2">
        <Tab href="/menu" label="Menu" />
        <Tab href="/cart" label="Cart" />
        <Tab href="/orders" label="Orders" />
        <Tab href="/login" label="Login" />
      </div>
    </div>
  );
}
