import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const GATEWAY_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8002";
const API_PREFIX = process.env.NEXT_PUBLIC_API_PREFIX || "/api";
const ACCESS_COOKIE_NAME = process.env.ACCESS_COOKIE_NAME || "access_token";

function gatewayUrl(path: string): string {
  const prefix = API_PREFIX.startsWith("/") ? API_PREFIX : `/${API_PREFIX}`;
  return `${GATEWAY_BASE}${prefix}${path}`;
}

async function requireAdmin(): Promise<{ ok: true; token: string } | NextResponse> {
  const jar = await cookies();
  const token = jar.get(ACCESS_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: "Missing or invalid token" }, { status: 401 });
  }
  try {
    const res = await fetch(gatewayUrl("/auth/me"), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.user) {
      return NextResponse.json({ error: "Missing or invalid token" }, { status: 401 });
    }
    if (body.user.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    return { ok: true, token };
  } catch (exc: any) {
    return NextResponse.json({ error: `Auth check failed: ${exc?.message ?? "unknown error"}` }, { status: 503 });
  }
}

export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const res = await fetch(gatewayUrl("/admin/metrics"), {
      headers: { Authorization: `Bearer ${auth.token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Upstream metrics failed: HTTP ${res.status}` }, { status: 502 });
    }
    const payload = await res.json();
    return NextResponse.json(payload);
  } catch (exc: any) {
    return NextResponse.json({ error: `Metrics unavailable: ${exc?.message ?? "unknown error"}` }, { status: 503 });
  }
}
