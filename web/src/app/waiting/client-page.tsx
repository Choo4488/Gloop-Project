"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ensureMachineDocument,
  listenMachine,
  listenSession,
  startUserSession,
} from "@/lib/services/machine-service";
import { getSessionId, saveSessionId } from "@/lib/services/session-storage";
import { useAuthUser } from "@/lib/services/use-auth-user";
import { MachineDoc, SessionDoc } from "@/types/machine";

const STATUS_LABEL: Record<string, string> = {
  OFFLINE: "ออฟไลน์",
  READY: "พร้อมรับขวด",
  WAITING_BOTTLE: "รอผู้ใช้วางขวด",
  ANALYZING: "กล้องกำลังตรวจสอบขวด",
  ACCEPTED: "รับขวดแล้ว",
  REJECTED: "ไม่รับขวด กรุณาใส่ขวดถัดไป",
  SESSION_ENDED: "สิ้นสุดการทำงาน",
};

const STATUS_MESSAGE: Record<string, string> = {
  OFFLINE: "เครื่องยังไม่เริ่มทำงาน",
  READY: "กรุณาวางขวดที่ตำแหน่งที่กำหนด",
  WAITING_BOTTLE: "กำลังรอผู้ใช้ใส่ขวด",
  ANALYZING: "AI กำลังตรวจสอบความสมบูรณ์และรูปแบบขวด",
  ACCEPTED: "รับขวดแล้ว: เปิดโซลินอยด์และบันทึกคะแนน",
  REJECTED: "ไม่รับขวด กรุณาใส่ขวดถัดไป",
  SESSION_ENDED: "ไม่มีการวางขวดเพิ่มภายใน 5 วินาที ระบบสิ้นสุดการทำงาน",
};

export default function WaitingPage() {
  const router = useRouter();
  const { user, loading, error: authError } = useAuthUser();
  const [machine, setMachine] = useState<MachineDoc | null>(null);
  const [session, setSession] = useState<SessionDoc | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectTimeout, setConnectTimeout] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setConnectTimeout(true);
    }, 8000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      setBooting(false);
      router.replace("/login");
      return;
    }

    if (!user) {
      return;
    }

    let alive = true;

    (async () => {
      try {
        setError(null);
        await ensureMachineDocument();

        let activeSessionId = getSessionId();

        if (!activeSessionId) {
          activeSessionId = await startUserSession(user.uid);
          saveSessionId(activeSessionId);
        }

        if (alive) {
          setSessionId(activeSessionId);
        }
      } catch (nextError) {
        if (alive) {
          setError(nextError instanceof Error ? nextError.message : "Failed to connect Firestore");
        }
      } finally {
        if (alive) {
          setBooting(false);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [loading, router, user]);

  useEffect(() => {
    const unsubscribe = listenMachine((nextMachine) => {
      setMachine(nextMachine);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    const unsubscribe = listenSession(sessionId, (nextSession) => {
      setSession(nextSession);
    });

    return unsubscribe;
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    if (session?.status === "ENDED") {
      router.replace(`/score?sessionId=${sessionId}`);
    }
  }, [router, session?.status, sessionId]);

  useEffect(() => {
    if (authError) {
      setError(authError);
    }
  }, [authError]);

  if (error) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl items-center justify-center p-6">
        <div className="w-full rounded-3xl bg-white/90 p-8 shadow-xl">
          <h1 className="text-2xl font-bold text-slate-900">การเชื่อมต่อมีปัญหา</h1>
          <p className="mt-3 text-slate-700">{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 rounded-xl bg-emerald-600 px-4 py-2 font-semibold text-white"
          >
            ลองใหม่
          </button>
        </div>
      </main>
    );
  }

  if (connectTimeout && (loading || booting)) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl items-center justify-center p-6">
        <div className="w-full rounded-3xl bg-white/90 p-8 shadow-xl">
          <h1 className="text-2xl font-bold text-slate-900">ระบบใช้เวลาเชื่อมต่อนานกว่าปกติ</h1>
          <p className="mt-3 text-slate-700">
            กรุณาตรวจสอบ Firebase Authentication และ Firestore แล้วลองใหม่อีกครั้ง
          </p>
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-xl bg-emerald-600 px-4 py-2 font-semibold text-white"
            >
              ลองใหม่
            </button>
            <button
              type="button"
              onClick={() => router.replace("/login")}
              className="rounded-xl border border-slate-400 px-4 py-2 font-semibold text-slate-700"
            >
              กลับหน้าเข้าสู่ระบบ
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center justify-center p-6">
      <div className="w-full rounded-3xl bg-white/90 p-8 shadow-xl">
        <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">หน้ารอใส่ขวด</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-900">กรุณาใส่ขวด</h1>
        <p className="mt-3 text-slate-700">
          เมื่อผู้ใช้วางขวด กล้องและ AI จะเริ่มตรวจสอบทันที คะแนนสะสม: ขวดเล็ก 1 คะแนน, ขวดกลาง 2 คะแนน, ขวดใหญ่ 3 คะแนน
        </p>
        <div className="mt-6 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          สถานะเครื่อง: {machine ? STATUS_LABEL[machine.status] : "กำลังเตรียมระบบ..."}
        </div>
        <p className="mt-3 text-sm text-slate-700">{machine ? STATUS_MESSAGE[machine.status] : "ระบบกำลังเริ่มต้น..."}</p>
        <p className="mt-2 text-sm font-semibold text-emerald-700">
          คะแนนสะสมปัจจุบัน: {session?.score ?? 0} คะแนน (เล็ก {session?.bottleCounts.small ?? 0} | กลาง {session?.bottleCounts.medium ?? 0} | ใหญ่ {session?.bottleCounts.large ?? 0})
        </p>
      </div>
    </main>
  );
}
