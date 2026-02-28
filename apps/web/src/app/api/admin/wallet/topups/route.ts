import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const GATEWAY_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8002";
const API_PREFIX = process.env.NEXT_PUBLIC_API_PREFIX || "/api";
const ACCESS_COOKIE_NAME = process.env.ACCESS_COOKIE_NAME || "access_token";

function resolveGatewayUrl(path: string): string {
  const prefix = API_PREFIX.startsWith("/") ? API_PREFIX : `/${API_PREFIX}`;
  return `${GATEWAY_BASE}${prefix}${path}`;
}

async function authHeader(): Promise<Record<string, string>> {
  const jar = await cookies();
  const token = jar.get(ACCESS_COOKIE_NAME)?.value;
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || "pending";
    const res = await fetch(resolveGatewayUrl(`/admin/wallet/topups?status=${encodeURIComponent(status)}`), {
      headers: { ...(await authHeader()) },
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (exc: any) {
    return NextResponse.json({ error: exc?.message ?? "wallet topups fetch failed" }, { status: 503 });
  }
}
