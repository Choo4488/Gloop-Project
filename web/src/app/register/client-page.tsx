"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { registerMemberAccount } from "@/lib/services/auth-service";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoadingSubmit(true);
    setError(null);

    try {
      if (!name.trim()) {
        throw new Error("กรุณากรอกชื่อสมาชิก");
      }

      if (password.length < 6) {
        throw new Error("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร");
      }

      if (password !== confirmPassword) {
        throw new Error("รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน");
      }

      await registerMemberAccount(name.trim(), email.trim(), password);
      router.replace("/login?registered=1");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "สมัครสมาชิกไม่สำเร็จ");
    } finally {
      setLoadingSubmit(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col gap-3">
        <div className="w-full max-w-md rounded-2xl bg-white/90 p-8 shadow-xl">
          <h1 className="mb-4 text-2xl font-bold text-slate-900">สมัครสมาชิก</h1>
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">ชื่อสมาชิก</label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                type="text"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Password</label>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Confirm password</label>
              <input
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                type="password"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-500"
              />
            </div>
            {error ? <p className="text-sm text-red-500">{error}</p> : null}
            <button
              type="submit"
              disabled={loadingSubmit}
              className="rounded-xl bg-emerald-600 px-4 py-2 font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
            >
              {loadingSubmit ? "กำลังสมัครสมาชิก..." : "สมัครสมาชิก"}
            </button>
          </form>
        </div>
        <p className="text-center text-sm text-slate-700">
          มีบัญชีแล้ว? <Link className="font-semibold text-emerald-700" href="/login">เข้าสู่ระบบ</Link>
        </p>
      </div>
    </main>
  );
}
