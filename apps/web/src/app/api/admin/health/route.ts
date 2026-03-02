import { NextResponse } from "next/server";

type Status = "up" | "down" | "degraded";

type ServiceStatus = {
  name: string;
  status: Status;
  detail?: string;
};

function resolveGatewayBase(): string {
  const raw =
    process.env.ADMIN_HEALTH_GATEWAY_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    "http://localhost:8002";
  return raw.replace(/\/+$/, "");
}

function parseChecksFromEnv(): Array<{ name: string; url: string }> {
  const raw = process.env.ADMIN_HEALTH_CHECKS_JSON;
  if (!raw) {
    // Local-first default: show all core services in docker-compose stack.
    return [
      { name: "identity-provider", url: "http://localhost:8001/health" },
      { name: "order-gateway", url: "http://localhost:8002/health" },
      { name: "stock-service", url: "http://localhost:8003/health" },
      { name: "kitchen-queue", url: "http://localhost:8004/health" },
      { name: "notification-hub", url: "http://localhost:8005/health" },
      { name: "payment-service", url: "http://localhost:8006/health" },
    ];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const name = typeof entry.name === "string" ? entry.name.trim() : "";
        const url = typeof entry.url === "string" ? entry.url.trim() : "";
        if (!name || !url) return null;
        return { name, url };
      })
      .filter((x): x is { name: string; url: string } => !!x);
  } catch {
    return [];
  }
}

async function fetchHealth(name: string, url: string, timeoutMs = 1200): Promise<ServiceStatus> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);

    if (!res.ok) {
      return { name, status: "down", detail: `HTTP ${res.status}` };
    }

    return { name, status: "up" };
  } catch {
    return { name, status: "down", detail: "unreachable" };
  }
}

export async function GET() {
  const checksCfg = parseChecksFromEnv();
  const checks =
    checksCfg.length > 0
      ? await Promise.all(checksCfg.map((c) => fetchHealth(c.name, c.url)))
      : ([
          {
            name: "admin-health-config",
            status: "degraded",
            detail: "No ADMIN_HEALTH_CHECKS_JSON configured",
          },
        ] satisfies ServiceStatus[]);

  return NextResponse.json({
    services: checks,
    updatedAt: new Date().toISOString(),
  });
}
