"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { logout } from "@/lib/services/auth-service";
import { endSessionByUser, listenSession } from "@/lib/services/machine-service";
import { clearSessionId, getSessionId } from "@/lib/services/session-storage";
import { useAuthUser } from "@/lib/services/use-auth-user";
import { SessionDoc } from "@/types/machine";

export default function ScorePage() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("sessionId") ?? getSessionId();
  const [session, setSession] = useState<SessionDoc | null>(null);
  const [ending, setEnding] = useState(false);
  const { user, loading } = useAuthUser();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, router, user]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    const unsubscribe = listenSession(sessionId, (nextSession) => {
      setSession(nextSession);
    });

    return unsubscribe;
  }, [sessionId]);

  const handleFinish = async () => {
    if (!sessionId) {
      clearSessionId();
      await logout();
      router.replace("/");
      return;
    }

    setEnding(true);
    await endSessionByUser(sessionId);
    clearSessionId();
    await logout();
    router.replace("/");
  };

  if (!sessionId) {
    return <main className="p-8">Session not found.</main>;
  }

  const small = session?.bottleCounts.small ?? 0;
  const medium = session?.bottleCounts.medium ?? 0;
  const large = session?.bottleCounts.large ?? 0;
  const totalScore = session?.score ?? 0;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center justify-center p-6">
      <div className="w-full rounded-3xl bg-white/90 p-8 shadow-xl">
        <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">Score Board</p>
        <h1 className="mt-1 text-3xl font-bold text-slate-900">Accumulated points</h1>
        <p className="mt-3 text-2xl font-bold text-emerald-700">{totalScore} points</p>
        <p className="mt-2 text-slate-700">
          Small {small} | Medium {medium} | Large {large}
        </p>
        <button
          onClick={handleFinish}
          disabled={ending}
          className="mt-5 rounded-xl bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-60"
        >
          {ending ? "Ending..." : "End system and return home"}
        </button>
      </div>
    </main>
  );
}
