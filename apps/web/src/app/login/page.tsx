"use client";

import { useEffect, useState } from "react";
import { login, logout as logoutSession, register } from "@/lib/api";
import { clearCart, clearUser, getUser, setUser, type User } from "@/lib/storage";
import Link from "next/link";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [fullName, setFullName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setCurrentUser(getUser());
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res =
        mode === "register"
          ? await register({
              full_name: fullName.trim(),
              student_id: studentId.trim(),
              email: email.trim(),
              password,
            })
          : await login(studentId.trim(), password);
      setUser(res.user);
      setCurrentUser(res.user);
    } catch (ex: any) {
      setErr(ex?.message ?? (mode === "register" ? "Sign up failed" : "Login failed"));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    try {
      await logoutSession();
    } catch {}
    clearUser();
    clearCart();
    setCurrentUser(null);
  };

  if (currentUser) {
    const displayStudentId = currentUser.student_id || currentUser.id || "N/A";
    const displayBalance = typeof currentUser.account_balance === "number" ? `BDT ${currentUser.account_balance}` : "N/A";

    return (
      <div className="mx-auto max-w-md">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-white">Sign in</h1>
        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 shadow dark:border-zinc-900 dark:bg-zinc-950">
          <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
            You are logged in.
          </div>

          <div className="mt-4 rounded-xl border border-zinc-300 bg-zinc-50 px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900/40">
            <div className="flex justify-between gap-3">
              <span className="text-zinc-600 dark:text-zinc-400">Student Name</span>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">{currentUser.name}</span>
            </div>
            <div className="mt-2 flex justify-between gap-3">
              <span className="text-zinc-600 dark:text-zinc-400">Student ID</span>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">{displayStudentId}</span>
            </div>
            <div className="mt-2 flex justify-between gap-3">
              <span className="text-zinc-600 dark:text-zinc-400">Email</span>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">{currentUser.email || "N/A"}</span>
            </div>
            <div className="mt-2 flex justify-between gap-3">
              <span className="text-zinc-600 dark:text-zinc-400">Account Balance</span>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">{displayBalance}</span>
            </div>
          </div>

          <button
            onClick={logout}
            className="mt-4 w-full rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:hover:bg-zinc-800"
          >
            Logout
          </button>

          <Link
            href="/menu"
            className="mt-3 inline-block w-full rounded-xl border border-zinc-300 px-4 py-2 text-center text-sm text-zinc-900 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            Go to menu
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-white">
        {mode === "register" ? "Create account" : "Sign in"}
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        {mode === "register"
          ? "Create a new student account with your details."
          : "Use your IUT Student ID to continue."}
      </p>

      <div className="mt-4 grid grid-cols-2 rounded-xl border border-zinc-200 bg-zinc-100 p-1 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <button
          type="button"
          onClick={() => {
            setMode("login");
            setErr(null);
          }}
          className={[
            "rounded-lg px-3 py-2 font-medium",
            mode === "login"
              ? "bg-white text-zinc-900 shadow dark:bg-zinc-800 dark:text-white"
              : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
          ].join(" ")}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("register");
            setErr(null);
          }}
          className={[
            "rounded-lg px-3 py-2 font-medium",
            mode === "register"
              ? "bg-white text-zinc-900 shadow dark:bg-zinc-800 dark:text-white"
              : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
          ].join(" ")}
        >
          Sign up
        </button>
      </div>

      <form onSubmit={submit} className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 shadow dark:border-zinc-900 dark:bg-zinc-950">
        {mode === "register" && (
          <>
            <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300">Full name</label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-zinc-900 outline-none placeholder-zinc-500 focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-white dark:placeholder-zinc-400 dark:focus:border-zinc-600"
              placeholder=""
              required
            />
          </>
        )}

        <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300">Student ID</label>
        <input
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-zinc-900 outline-none placeholder-zinc-500 focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-white dark:placeholder-zinc-400 dark:focus:border-zinc-600"
          placeholder=""
          required
        />

        {mode === "register" && (
          <>
            <label className="mt-4 block text-sm font-semibold text-zinc-700 dark:text-zinc-300">Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-zinc-900 outline-none placeholder-zinc-500 focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-white dark:placeholder-zinc-400 dark:focus:border-zinc-600"
              placeholder=""
              required
            />
          </>
        )}

        <label className="mt-4 block text-sm font-semibold text-zinc-700 dark:text-zinc-300">Password</label>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-zinc-900 outline-none placeholder-zinc-500 focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-white dark:placeholder-zinc-400 dark:focus:border-zinc-600"
          placeholder=""
          required
        />

        {err && <div className="mt-4 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{err}</div>}

        <button
          disabled={busy}
          className="mt-5 w-full rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:hover:bg-zinc-800"
        >
          {busy ? (mode === "register" ? "Creating account…" : "Signing in…") : mode === "register" ? "Create account" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
