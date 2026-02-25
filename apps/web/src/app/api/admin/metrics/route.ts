import { NextResponse } from "next/server";

const RABBIT_URL = "http://localhost:15672";
const RABBIT_USER = "guest";
const RABBIT_PASS = "guest";

function basicAuthHeader(user: string, pass: string) {
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

async function timedFetch(url: string, timeoutMs = 800) {
  const start = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    const ms = Date.now() - start;
    clearTimeout(t);
    return { ok: res.ok, ms };
  } catch {
    clearTimeout(t);
    return { ok: false, ms: Date.now() - start };
  }
}

async function getQueue(host: string, vhost: string, name: string, headers: Record<string, string>) {
  const url = `${host}/api/queues/${encodeURIComponent(vhost)}/${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

export async function GET() {
  // 1) Measure service latencies (real)
  const serviceUrls = [
    "http://localhost:8001/health", // identity-provider
    "http://localhost:8002/health", // order-gateway
    "http://localhost:8003/health", // stock-service
    "http://localhost:8004/health", // kitchen-queue
    "http://localhost:8005/health", // notification-hub
  ];

  const timings = await Promise.all(serviceUrls.map((u) => timedFetch(u)));
  const okTimings = timings.filter((t) => t.ok).map((t) => t.ms);

  const p50 = okTimings.length ? okTimings.sort((a, b) => a - b)[Math.floor(okTimings.length * 0.5)] : null;
  const p95 = okTimings.length ? okTimings.sort((a, b) => a - b)[Math.floor(okTimings.length * 0.95)] : null;

  // 2) Pull RabbitMQ "real-ish" metrics (queue depth + rates + per-queue stats)
  let queueDepth = 0;
  let publishPerSec = 0;
  let deliverPerSec = 0;
  let kitchenDepth = 0;
  let statusDepth = 0;
  const queueStats: Record<string, number> = {};

  try {
    const headers = { Authorization: basicAuthHeader(RABBIT_USER, RABBIT_PASS) };

    const vhost = "%2F"; // default vhost "/" encoded
    const kitchen = await getQueue(RABBIT_URL, "/", "kitchen.jobs", headers);
    const status = await getQueue(RABBIT_URL, "/", "order.status", headers);

    kitchenDepth = kitchen?.messages ?? 0;
    statusDepth = status?.messages ?? 0;

    // Get all queues (messages = ready + unacked)
    const queuesRes = await fetch(`${RABBIT_URL}/api/queues`, { headers, cache: "no-store" });
    if (queuesRes.ok) {
      const queues = (await queuesRes.json()) as Array<{ name?: string; vhost?: string; messages?: number }>;
      queueDepth = queues.reduce((sum, q) => sum + (q.messages ?? 0), 0);
      
      // Fetch individual queue stats
      for (const q of queues) {
        if (q.name && q.vhost) {
          const qData = await getQueue(RABBIT_URL, q.vhost, q.name, headers);
          if (qData?.messages !== undefined) {
            queueStats[q.name] = qData.messages;
          }
        }
      }
    }

    // Overview has message_stats rates (varies depending on activity)
    const ovRes = await fetch(`${RABBIT_URL}/api/overview`, { headers, cache: "no-store" });
    if (ovRes.ok) {
      const ov = await ovRes.json();
      publishPerSec = ov?.message_stats?.publish_details?.rate ?? 0;
      deliverPerSec =
        ov?.message_stats?.deliver_details?.rate ??
        ov?.message_stats?.deliver_get_details?.rate ??
        0;
    }
  } catch {
    // If RabbitMQ UI is down, keep zeros; admin page still renders
  }

  // Convert to a demo-friendly number:
  // "orders per min" ~= messages published per minute (rough approximation)
  const ordersPerMin = Math.round(publishPerSec * 60);

  return NextResponse.json({
    latency_ms_p50: p50 ?? 0,
    latency_ms_p95: p95 ?? 0,
    orders_per_min: ordersPerMin,
    queue_depth: queueDepth,
    queue_stats: queueStats,
    kitchen_queue_depth: kitchenDepth,
    status_queue_depth: statusDepth,
    rabbitmq_publish_per_sec: publishPerSec,
    rabbitmq_deliver_per_sec: deliverPerSec,
    updatedAt: new Date().toISOString(),
  });
}
