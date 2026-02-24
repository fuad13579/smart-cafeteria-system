import { NextResponse } from "next/server";

export async function GET() {
  // Mock: later replace with real health checks from each microservice
  return NextResponse.json({
    services: [
      { name: "identity-provider", status: "up" },
      { name: "order-gateway", status: "up" },
      { name: "stock-service", status: "up" },
      { name: "kitchen-queue", status: "up" },
      { name: "notification-hub", status: "up" },
      { name: "postgres", status: "up" },
      { name: "redis", status: "up" },
      { name: "rabbitmq", status: "up" },
    ],
    updatedAt: new Date().toISOString(),
  });
}
