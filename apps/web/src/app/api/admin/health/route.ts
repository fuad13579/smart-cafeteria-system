import { NextResponse } from "next/server";
import net from "node:net";

type Status = "up" | "down" | "degraded";

async function fetchHealth(name: string, url: string, timeoutMs = 800): Promise<{ name: string; status: Status }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);

    if (!res.ok) return { name, status: "down" };

    // Optional: if service returns JSON {status:"ok"}, treat as up
    return { name, status: "up" };
  } catch {
    return { name, status: "down" };
  }
}

function tcpCheck(name: string, host: string, port: number, timeoutMs = 500): Promise<{ name: string; status: Status }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();

    const done = (status: Status) => {
      try {
        socket.destroy();
      } catch {}
      resolve({ name, status });
    };

    socket.setTimeout(timeoutMs);
    socket.once("error", () => done("down"));
    socket.once("timeout", () => done("down"));
    socket.connect(port, host, () => done("up"));
  });
}

export async function GET() {
  // Your docker-compose exposed ports (as shown in `docker compose ps`)
  const checks = await Promise.all([
    fetchHealth("identity-provider", "http://localhost:8001/health"),
    fetchHealth("order-gateway", "http://localhost:8002/health"),
    fetchHealth("stock-service", "http://localhost:8003/health"),
    fetchHealth("kitchen-queue", "http://localhost:8004/health"),
    fetchHealth("notification-hub", "http://localhost:8005/health"),

    tcpCheck("postgres", "127.0.0.1", 5432),
    tcpCheck("redis", "127.0.0.1", 6379),
    tcpCheck("rabbitmq(amqp)", "127.0.0.1", 5672),

    // Optional: RabbitMQ management UI health via HTTP
    fetchHealth("rabbitmq(ui)", "http://localhost:15672", 800),
  ]);

  return NextResponse.json({
    services: checks,
    updatedAt: new Date().toISOString(),
  });
}
