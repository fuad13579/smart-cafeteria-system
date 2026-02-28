import { NextResponse } from "next/server";

const GATEWAY_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8002";
const API_PREFIX = process.env.NEXT_PUBLIC_API_PREFIX || "/api";

export async function GET() {
  try {
    const prefix = API_PREFIX.startsWith("/") ? API_PREFIX : `/${API_PREFIX}`;
    const res = await fetch(`${GATEWAY_BASE}${prefix}/admin/metrics`, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ error: `Upstream metrics failed: HTTP ${res.status}` }, { status: 502 });
    }
    const payload = await res.json();
    return NextResponse.json(payload);
  } catch (exc: any) {
    return NextResponse.json({ error: `Metrics unavailable: ${exc?.message ?? "unknown error"}` }, { status: 503 });
  }
}
