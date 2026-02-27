"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AuthForm } from "@/components/auth-form";
import { createAdminTestAccount, loginWithEmail } from "@/lib/services/auth-service";

export default function LoginPage() {
  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const [loadingAdmin, setLoadingAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adminMessage, setAdminMessage] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const registered = searchParams.get("registered") === "1";

  const onSubmit = async (values: { email: string; password: string }) => {
    setLoadingSubmit(true);
    setError(null);

    try {
      await loginWithEmail(values.email, values.password);
      router.replace("/broadcast");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Login failed");
    } finally {
      setLoadingSubmit(false);
    }
  };

  const handleCreateAdmin = async () => {
    setLoadingAdmin(true);
    setError(null);
    setAdminMessage(null);

    try {
      const result = await createAdminTestAccount();

      if (result.created) {
        setAdminMessage(`Admin created: ${result.email} / ${result.password}`);
        return;
      }

      setAdminMessage(`Admin already exists: ${result.email} / ${result.password}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Create admin failed");
    } finally {
      setLoadingAdmin(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col gap-3">
        {registered ? <p className="text-center text-sm font-semibold text-emerald-700">สมัครสมาชิกสำเร็จ กรุณาเข้าสู่ระบบ</p> : null}
        <AuthForm title="Login" submitLabel="Login" onSubmit={onSubmit} loading={loadingSubmit} errorMessage={error} />
        <button
          type="button"
          onClick={handleCreateAdmin}
          disabled={loadingAdmin}
          className="rounded-xl border border-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-700 disabled:opacity-60"
        >
          {loadingAdmin ? "Creating admin..." : "Create Admin Test Account"}
        </button>
        {adminMessage ? <p className="text-center text-sm text-emerald-700">{adminMessage}</p> : null}
        <p className="text-center text-sm text-slate-700">
          No account? <Link className="font-semibold text-emerald-700" href="/register">Register</Link>
        </p>
      </div>
    </main>
  );
}
