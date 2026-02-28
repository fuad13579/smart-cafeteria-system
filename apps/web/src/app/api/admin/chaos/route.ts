import { NextResponse } from "next/server";

const SERVICE_BASE: Record<string, string> = {
  "identity-provider": "http://localhost:8001",
  "order-gateway": "http://localhost:8002",
  "stock-service": "http://localhost:8003",
  "kitchen-queue": "http://localhost:8004",
  "notification-hub": "http://localhost:8005",
  "payment-service": "http://localhost:8006",
};

export async function POST(req: Request) {
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
