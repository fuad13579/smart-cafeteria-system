import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const SERVICE_BASE: Record<string, string> = {
  "identity-provider": "http://localhost:8001",
  "order-gateway": "http://localhost:8002",
  "stock-service": "http://localhost:8003",
  "kitchen-queue": "http://localhost:8004",
  "notification-hub": "http://localhost:8005",
  "payment-service": "http://localhost:8006",
};

const GATEWAY_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8002";
const API_PREFIX = process.env.NEXT_PUBLIC_API_PREFIX || "/api";
const ACCESS_COOKIE_NAME = process.env.ACCESS_COOKIE_NAME || "access_token";

function gatewayApiUrl(path: string): string {
  const prefix = API_PREFIX.startsWith("/") ? API_PREFIX : `/${API_PREFIX}`;
  return `${GATEWAY_BASE}${prefix}${path}`;
}

async function requireAdmin(): Promise<{ ok: true } | NextResponse> {
  const jar = await cookies();
  const token = jar.get(ACCESS_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: "Missing or invalid token" }, { status: 401 });
  }
  try {
    const res = await fetch(gatewayApiUrl("/auth/me"), {
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
    return { ok: true };
  } catch (exc: any) {
    return NextResponse.json({ error: `Auth check failed: ${exc?.message ?? "unknown error"}` }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const { service, action } = body;

  if (!service || !action) {
    return NextResponse.json({ error: "service and action required" }, { status: 400 });
  }
  if (action !== "kill" && action !== "restart") {
    return NextResponse.json({ error: "action must be 'kill' or 'restart'" }, { status: 400 });
  }

  const base = SERVICE_BASE[String(service)];
  if (!base) {
    return NextResponse.json({ error: `unsupported service: ${service}` }, { status: 400 });
  }

  const payload = action === "kill" ? { enabled: true, mode: "error" } : { enabled: false, mode: "error" };

  try {
    const res = await fetch(`${base}/chaos/fail`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: data?.detail ?? data?.error ?? `chaos request failed: HTTP ${res.status}` },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      service,
      action,
      message: `Chaos action '${action}' applied on ${service}`,
      upstream: data,
      at: new Date().toISOString(),
    });
  } catch (exc: any) {
    return NextResponse.json(
      { error: `chaos endpoint unavailable for ${service}: ${exc?.message ?? "unknown error"}` },
      { status: 503 }
    );
  }
}
