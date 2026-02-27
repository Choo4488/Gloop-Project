"use client";

import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl items-center justify-center p-6">
      <div className="w-full max-w-2xl rounded-3xl bg-white/85 p-8 shadow-xl backdrop-blur">
        <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">Bottle Return AI System</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-900">Smart Bottle Return Machine</h1>
        <p className="mt-3 text-slate-700">
          Supports 3 bottle sizes, AI-based bottle quality checks, and Raspberry Pi hardware control via Firestore real-time status.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/login" className="rounded-xl bg-emerald-600 px-4 py-2 font-semibold text-white">
            Login
          </Link>
          <Link href="/register" className="rounded-xl border border-emerald-600 px-4 py-2 font-semibold text-emerald-700">
            Register
          </Link>
        </div>
      </div>
    </main>
  );
}
