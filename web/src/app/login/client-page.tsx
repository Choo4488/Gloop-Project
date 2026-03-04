"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AuthForm } from "@/components/auth-form";
import { loginWithEmail } from "@/lib/services/auth-service";

export default function LoginPage() {
  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col gap-3">
        {registered ? <p className="text-center text-sm font-semibold text-emerald-700">Registration successful. Please login.</p> : null}
        <AuthForm title="Login" submitLabel="Login" onSubmit={onSubmit} loading={loadingSubmit} errorMessage={error} />
        <p className="text-center text-sm text-slate-700">
          No account? <Link className="font-semibold text-emerald-700" href="/register">Register</Link>
        </p>
      </div>
    </main>
  );
}
