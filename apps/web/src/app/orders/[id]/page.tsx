"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const steps = ["QUEUED", "IN_PROGRESS", "READY", "COMPLETED"] as const;

function Step({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className={["h-3 w-3 rounded-full", active ? "bg-zinc-900 dark:bg-white" : "bg-zinc-300 dark:bg-zinc-800"].join(" ")} />
      <div className={["text-sm", active ? "text-zinc-900 dark:text-white" : "text-zinc-600 dark:text-zinc-500"].join(" ")}>{label}</div>
    </div>
  );
}

export default function OrderPage({ params }: { params: { id: string } }) {
  const [status, setStatus] = useState<(typeof steps)[number]>("QUEUED");
  const [eta, setEta] = useState<number>(12);

  // Mock progression for now (replace with websocket later)
  useEffect(() => {
    const seq: Array<(typeof steps)[number]> = ["QUEUED", "IN_PROGRESS", "READY", "COMPLETED"];
    let i = 0;
    const t = setInterval(() => {
      i = Math.min(i + 1, seq.length - 1);
      setStatus(seq[i]);
      setEta((x) => Math.max(0, x - 3));
      if (i === seq.length - 1) clearInterval(t);
    }, 3500);
    return () => clearInterval(t);
  }, []);

  const activeIndex = steps.indexOf(status);

  return (
    <div className="mx-auto max-w-xl">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-white">Order tracking</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Order ID <span className="text-zinc-900 dark:text-zinc-200">{params.id}</span>
          </p>
        </div>
        <Link href="/menu" className="text-sm text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white">New order</Link>
      </div>

      <div className="mt-6 rounded-2xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-900 dark:bg-zinc-950">
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

        <div className="mt-3 text-xs text-zinc-600 dark:text-zinc-500">
          (Mock mode) This will become real-time via WebSocket later.
        </div>
      </div>
    </div>
  );
}
