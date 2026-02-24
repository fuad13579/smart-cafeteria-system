import { NextResponse } from "next/server";

function rand(min: number, max: number) {
  return Math.round(min + Math.random() * (max - min));
}

export async function GET() {
  // Mock: later replace with Prometheus/Grafana or your own metrics endpoint
  return NextResponse.json({
    latency_ms_p50: rand(30, 90),
    latency_ms_p95: rand(120, 280),
    orders_per_min: rand(20, 180),
    queue_depth: rand(0, 35),
    updatedAt: new Date().toISOString(),
  });
}
