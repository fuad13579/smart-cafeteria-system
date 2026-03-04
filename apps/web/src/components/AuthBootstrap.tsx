"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { me } from "@/lib/api";
import { clearUser, setUser } from "@/lib/storage";

const PUBLIC_PATHS = new Set(["/login"]);

export function AuthBootstrap() {
  const pathname = usePathname();
  const [showLoginMessage, setShowLoginMessage] = useState(false);

  useEffect(() => {
    let cancelled = false;

    me()
      .then((res) => {
        if (cancelled) return;
        setUser(res.user);
        setShowLoginMessage(false);
      })
      .catch(() => {
        if (cancelled) return;
        clearUser();
        setShowLoginMessage(!PUBLIC_PATHS.has(pathname));
      });

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (!showLoginMessage) return null;

  return (
    <div className="mx-auto mt-3 w-full max-w-4xl rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-800 sm:px-4 sm:py-3 sm:text-sm dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      Login first to continue using this page.
    </div>
  );
}
