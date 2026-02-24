"use client";

import { useState } from "react";
import { login } from "@/lib/api";
import { setToken, setUser } from "@/lib/storage";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [studentId, setStudentId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await login(studentId.trim(), password);
      setToken(res.access_token);
      setUser(res.user);
      router.push("/menu");
    } catch (ex: any) {
      setErr(ex?.message ?? "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-white">Sign in</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Use your IUT Student ID to continue.</p>

      <form onSubmit={submit} className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 shadow dark:border-zinc-900 dark:bg-zinc-950">
        <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300">Student ID</label>
        <input
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-zinc-900 outline-none placeholder-zinc-500 focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-white dark:placeholder-zinc-400 dark:focus:border-zinc-600"
          placeholder=""
        />

        <label className="mt-4 block text-sm font-semibold text-zinc-700 dark:text-zinc-300">Password</label>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-zinc-900 outline-none placeholder-zinc-500 focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-white dark:placeholder-zinc-400 dark:focus:border-zinc-600"
          placeholder=""
        />

        {err && <div className="mt-4 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{err}</div>}

        <button
          disabled={busy}
          className="mt-5 w-full rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:hover:bg-zinc-800"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <div className="mt-3 text-xs text-zinc-600 dark:text-zinc-500">
          Tip: For now, any student ID works (mock mode).
        </div>
      </form>
    </div>
  );
}