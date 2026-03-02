"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getMyOrders, getOrder, getOrderSlipUrl, markOrderSlipPrinted, type OrderStatus } from "@/lib/api";
import { getToken } from "@/lib/storage";

const steps: OrderStatus[] = [
  "QUEUED",
  "IN_PROGRESS",
  "READY",
  "COMPLETED",
  "CANCELLED",
];
const terminalStates: OrderStatus[] = ["READY", "COMPLETED", "CANCELLED"];
const NOTIFICATION_WS_URL =
  process.env.NEXT_PUBLIC_NOTIFICATION_WS_URL || "ws://localhost:8005/ws";

function buildMockSlipHtml(input: {
  orderId: string;
  tokenNo: number | null;
  pickupCounter: number | null;
  status: string;
  eta: number;
}) {
  const now = new Date().toLocaleString();
  const token = input.tokenNo ?? "-";
  const counter = input.pickupCounter ?? 1;
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Order Slip</title>
    <style>
      @media print { @page { size: A6; margin: 8mm; } }
      body { font-family: Arial, sans-serif; margin: 0; padding: 12px; color: #111; }
      .box { border: 1px solid #111; border-radius: 8px; padding: 12px; }
      .token { font-size: 36px; font-weight: 700; text-align: center; margin: 8px 0 10px; }
      .row { margin: 4px 0; font-size: 12px; }
      .muted { color: #555; }
    </style>
  </head>
  <body>
    <div class="box">
      <div class="muted">Smart Cafeteria - Demo Slip</div>
      <div class="token">TOKEN #${token}</div>
      <div class="row"><strong>Order:</strong> ${input.orderId}</div>
      <div class="row"><strong>Counter:</strong> ${counter}</div>
      <div class="row"><strong>Status:</strong> ${input.status}</div>
      <div class="row"><strong>ETA:</strong> ${input.eta} min</div>
      <div class="row"><strong>Printed:</strong> ${now}</div>
    </div>
    <script>window.print()</script>
  </body>
</html>`;
}

function Step({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className={["h-3 w-3 rounded-full", active ? "bg-zinc-900 dark:bg-white" : "bg-zinc-300 dark:bg-zinc-800"].join(" ")} />
      <div className={["text-sm", active ? "text-zinc-900 dark:text-white" : "text-zinc-600 dark:text-zinc-500"].join(" ")}>{label}</div>
    </div>
  );
}

export default function OrderPage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;
  const [status, setStatus] = useState<OrderStatus>("QUEUED");
  const [eta, setEta] = useState<number>(12);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tokenNo, setTokenNo] = useState<number | null>(null);
  const [pickupCounter, setPickupCounter] = useState<number | null>(null);
  const [readyUntil, setReadyUntil] = useState<string | null>(null);
  const [serverExpired, setServerExpired] = useState<boolean>(false);
  const [nowTs, setNowTs] = useState<number>(Date.now());

  useEffect(() => {
    let cancelled = false;
    let pollRef: ReturnType<typeof setInterval> | null = null;

    const load = async (showLoading = false) => {
      if (!orderId) return;
      if (showLoading) setLoading(true);
      try {
        const mine = await getMyOrders();
        const orders = Array.isArray(mine?.orders) ? mine.orders : [];
        const fromList = orders.find((o) => o.order_id === orderId);
        const res = fromList ?? (await getOrder(orderId));
        if (cancelled) return;
        setErr(null);
        setStatus(res.status);
        setTokenNo(typeof res.token_no === "number" ? res.token_no : null);
        setPickupCounter(typeof res.pickup_counter === "number" ? res.pickup_counter : null);
        setReadyUntil(typeof res.ready_until === "string" ? res.ready_until : null);
        setServerExpired(Boolean(res.is_expired));
        setEta(Math.max(0, res.eta_minutes ?? 0));
        if (terminalStates.includes(res.status) && pollRef) {
          clearInterval(pollRef);
          pollRef = null;
        }
      } catch (e: any) {
        if (cancelled) return;
        setErr(e?.message ?? "Failed to load order status");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load(true);
    pollRef = setInterval(() => {
      if (terminalStates.includes(status)) return;
      load(false);
    }, 4000);

    return () => {
      cancelled = true;
      if (pollRef) clearInterval(pollRef);
    };
  }, [orderId, status]);

  useEffect(() => {
    if (!orderId) return;
    if (process.env.NEXT_PUBLIC_API_MODE !== "real") return;
    if (terminalStates.includes(status)) return;
    const token = getToken();
    if (!token) return;

    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      const url = `${NOTIFICATION_WS_URL}?token=${encodeURIComponent(token)}`;
      socket = new WebSocket(url);

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload?.order_id !== orderId) return;
          const nextStatus = payload?.to_status as OrderStatus | undefined;
          if (!nextStatus) return;
          setStatus(nextStatus);
          if (typeof payload?.token_no === "number") setTokenNo(payload.token_no);
          if (typeof payload?.pickup_counter === "number") setPickupCounter(payload.pickup_counter);
          if (typeof payload?.ready_until === "string") setReadyUntil(payload.ready_until);
          if (typeof payload?.is_expired === "boolean") setServerExpired(payload.is_expired);
          if (typeof payload?.eta_minutes === "number") {
            setEta(Math.max(0, payload.eta_minutes));
          }
          setErr(null);
        } catch {
          // ignore malformed websocket events
        }
      };

      socket.onerror = () => {
        socket?.close();
      };

      socket.onclose = () => {
        if (closed) return;
        reconnectTimer = setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socket) socket.close();
    };
  }, [orderId, status]);

  const activeIndex = steps.indexOf(status);
  const retry = () => {
    if (!orderId) return;
    setLoading(true);
    getOrder(orderId)
      .then((res) => {
        setErr(null);
        setStatus(res.status);
        setTokenNo(typeof res.token_no === "number" ? res.token_no : null);
        setPickupCounter(typeof res.pickup_counter === "number" ? res.pickup_counter : null);
        setReadyUntil(typeof res.ready_until === "string" ? res.ready_until : null);
        setServerExpired(Boolean(res.is_expired));
        setEta(Math.max(0, res.eta_minutes ?? 0));
      })
      .catch((e: any) => setErr(e?.message ?? "Failed to load order status"))
      .finally(() => setLoading(false));
  };

  const onPrintSlip = async () => {
    if (!orderId) return;
    if (process.env.NEXT_PUBLIC_API_MODE !== "real") {
      const w = window.open("", "_blank", "noopener,noreferrer");
      if (!w) return;
      w.document.open();
      w.document.write(
        buildMockSlipHtml({
          orderId,
          tokenNo,
          pickupCounter,
          status,
          eta,
        })
      );
      w.document.close();
      return;
    }
    window.open(getOrderSlipUrl(orderId, true), "_blank", "noopener,noreferrer");
    try {
      await markOrderSlipPrinted(orderId);
    } catch {
      // non-blocking metadata update
    }
  };

  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const readyUntilDate = readyUntil ? new Date(readyUntil) : null;
  const readyDiffSec = readyUntilDate ? Math.floor((readyUntilDate.getTime() - nowTs) / 1000) : null;
  const readyExpired = status === "READY" && (serverExpired || (readyDiffSec !== null && readyDiffSec <= 0));
  const countdownLabel =
    readyDiffSec !== null && readyDiffSec > 0
      ? `${Math.floor(readyDiffSec / 60)
          .toString()
          .padStart(2, "0")}:${(readyDiffSec % 60).toString().padStart(2, "0")}`
      : null;

  return (
    <div className="mx-auto max-w-xl">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-white">Order tracking</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Order ID <span className="text-zinc-900 dark:text-zinc-200">{params.id}</span>
          </p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Token <span className="text-zinc-900 dark:text-zinc-200">#{tokenNo ?? "-"}</span>
          </p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Pickup Counter <span className="text-zinc-900 dark:text-zinc-200">{pickupCounter ?? "-"}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onPrintSlip}
            className="rounded-lg border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Print token
          </button>
          <Link href="/menu" className="text-sm text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white">New order</Link>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-900 dark:bg-zinc-950">
        {loading && (
          <div className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">Loading order status…</div>
        )}
        {err && (
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <div>{err}</div>
            <button
              onClick={retry}
              className="mt-2 rounded-lg border border-amber-400 px-3 py-1 text-xs hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900/40"
            >
              Retry now
            </button>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Current status</div>
          <div className="rounded-full bg-zinc-200 px-3 py-1 text-xs text-zinc-900 dark:bg-zinc-900 dark:text-zinc-200">{status}</div>
        </div>

        <div className="mt-4 space-y-3">
          {steps.map((s, idx) => (
            <Step key={s} label={s.replace("_", " ")} active={idx <= activeIndex} />
          ))}
        </div>

        <div className="mt-5 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
          Estimated time: <span className="font-medium text-zinc-900 dark:text-white">{eta} min</span>
        </div>

        {status === "READY" && (
          <div className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
            {!readyExpired ? (
              <>
                Ready for pickup until{" "}
                <span className="font-semibold">
                  {readyUntilDate ? readyUntilDate.toLocaleTimeString() : "-"}
                </span>
                {countdownLabel ? (
                  <span className="ml-2 rounded bg-emerald-100 px-2 py-0.5 text-xs dark:bg-emerald-900/40">
                    {countdownLabel}
                  </span>
                ) : null}
              </>
            ) : (
              <span>Pickup window expired - go to counter.</span>
            )}
          </div>
        )}

        <div className="mt-3 text-xs text-zinc-600 dark:text-zinc-500">
          Updates every 4 seconds while order is active.
        </div>
      </div>
    </div>
  );
}
