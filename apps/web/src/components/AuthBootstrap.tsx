"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { me } from "@/lib/api";
import { clearUser, setUser } from "@/lib/storage";

const PUBLIC_PATHS = new Set(["/login"]);

export function AuthBootstrap() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    me()
      .then((res) => {
        if (cancelled) return;
        setUser(res.user);
      })
      .catch(() => {
        if (cancelled) return;
        clearUser();
        if (!PUBLIC_PATHS.has(pathname)) {
          router.push("/login");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  return null;
}
