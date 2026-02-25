import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { service, action } = body;

  if (!service || !action) {
    return NextResponse.json({ error: "service and action required" }, { status: 400 });
  }

  // Mock response. Later: call your chaos endpoint in backend to stop/kill/restart a service.
  return NextResponse.json({
    ok: true,
    service,
    action,
    message: `Mock chaos action '${action}' sent to ${service}`,
    at: new Date().toISOString(),
  });
}
