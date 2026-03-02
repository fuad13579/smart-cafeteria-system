import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdminDashboardClient } from "@/components/AdminDashboardClient";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8002";
const API_PREFIX = process.env.NEXT_PUBLIC_API_PREFIX || "/api";
const ACCESS_COOKIE_NAME = process.env.ACCESS_COOKIE_NAME || "access_token";
const API_MODE = process.env.NEXT_PUBLIC_API_MODE === "real" ? "real" : "mock";

async function getCurrentUserFromGateway(token: string): Promise<any | null> {
  try {
    const prefix = API_PREFIX.startsWith("/") ? API_PREFIX : `/${API_PREFIX}`;
    const res = await fetch(`${API_BASE}${prefix}/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    return body?.user ?? null;
  } catch {
    return null;
  }
}

export default async function AdminPage() {
  if (API_MODE !== "real") {
    return <AdminDashboardClient />;
  }

  const jar = await cookies();
  const token = jar.get(ACCESS_COOKIE_NAME)?.value;
  if (!token) {
    redirect("/login");
  }

  const user = await getCurrentUserFromGateway(token);
  if (!user) {
    redirect("/login");
  }

  if (user.role !== "admin") {
    return (
      <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-red-300 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950/40">
        <h1 className="text-2xl font-semibold text-red-800 dark:text-red-200">403 Forbidden</h1>
        <p className="mt-2 text-sm text-red-700 dark:text-red-300">
          You do not have permission to access the admin dashboard.
        </p>
        <Link
          href="/menu"
          className="mt-4 inline-block rounded-xl border border-red-300 px-4 py-2 text-sm text-red-800 hover:bg-red-100 dark:border-red-800 dark:text-red-200 dark:hover:bg-red-900/40"
        >
          Back to menu
        </Link>
      </div>
    );
  }

  return <AdminDashboardClient />;
}
