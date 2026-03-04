"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Card, CardBody, CardHeader, Chip, Divider, Progress } from "@heroui/react";
import {
  ensureMachineDocument,
  listenMachine,
  listenSession,
  listenSessionEvents,
  listenTodaySummary,
  startUserSession,
} from "@/lib/services/machine-service";
import { getSessionId, saveSessionId } from "@/lib/services/session-storage";
import { useAuthUser } from "@/lib/services/use-auth-user";
import { MachineDoc, MachineStatus, SessionDoc, SessionEventDoc, TodaySummary } from "@/types/machine";

const STATUS_LABEL: Record<MachineStatus, string> = {
  OFFLINE: "ออฟไลน์",
  READY: "พร้อมใช้งาน",
  WAITING_BOTTLE: "รอวางขวด",
  ANALYZING: "กำลังตรวจสอบ",
  ACCEPTED: "รับขวดแล้ว",
  REJECTED: "ไม่รับขวด",
  SESSION_ENDED: "สิ้นสุดรอบ",
};

const STATUS_MESSAGE: Record<MachineStatus, string> = {
  OFFLINE: "เครื่องยังไม่พร้อมใช้งานในขณะนี้",
  READY: "เครื่องพร้อมรับขวดคืน",
  WAITING_BOTTLE: "กรุณาวางขวดที่จุดรับขวด",
  ANALYZING: "ระบบกำลังตรวจสอบความถูกต้องของขวด",
  ACCEPTED: "รับขวดเรียบร้อย และบันทึกคะแนนแล้ว",
  REJECTED: "ขวดไม่ผ่านเงื่อนไข กรุณาใส่ขวดถัดไป",
  SESSION_ENDED: "ไม่มีการใส่ขวดเพิ่มภายใน 5 วินาที ระบบสิ้นสุดรอบ",
};

const STATUS_COLOR: Record<MachineStatus, "default" | "success" | "warning" | "danger" | "primary"> = {
  OFFLINE: "danger",
  READY: "success",
  WAITING_BOTTLE: "primary",
  ANALYZING: "warning",
  ACCEPTED: "success",
  REJECTED: "danger",
  SESSION_ENDED: "default",
};

function formatClock(date: Date | null): string {
  if (!date) {
    return "-";
  }
  return date.toLocaleTimeString();
}

function bottleSizeLabel(size: string | null): string {
  if (size === "small") {
    return "ขวดเล็ก";
  }
  if (size === "medium") {
    return "ขวดกลาง";
  }
  if (size === "large") {
    return "ขวดใหญ่";
  }
  return "-";
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading, error: authError } = useAuthUser();
  const [machine, setMachine] = useState<MachineDoc | null>(null);
  const [session, setSession] = useState<SessionDoc | null>(null);
  const [sessionEvents, setSessionEvents] = useState<SessionEventDoc[]>([]);
  const [todaySummary, setTodaySummary] = useState<TodaySummary>({ sessions: 0, bottles: 0, score: 0 });
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectTimeout, setConnectTimeout] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());

  const score = session?.score ?? 0;
  const small = session?.bottleCounts.small ?? 0;
  const medium = session?.bottleCounts.medium ?? 0;
  const large = session?.bottleCounts.large ?? 0;
  const totalBottles = small + medium + large;
  const progressValue = Math.min(100, totalBottles * 10);
  const currentStatus = machine?.status ?? "READY";

  const connectionState = useMemo(() => {
    if (!machine?.lastHeartbeatAt) {
      return "unknown";
    }
    const ageSeconds = (nowTick - machine.lastHeartbeatAt.getTime()) / 1000;
    return ageSeconds <= 10 ? "connected" : "stale";
  }, [machine?.lastHeartbeatAt, nowTick]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setConnectTimeout(true);
    }, 8000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowTick(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
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
    if (!user) {
      return;
    }

    const unsubscribe = listenMachine((nextMachine) => {
      setMachine(nextMachine);
    }, (nextError) => {
      setError(nextError.code === "permission-denied"
        ? "ไม่มีสิทธิ์เข้าถึงข้อมูล Firestore กรุณาเข้าสู่ระบบใหม่หรือตรวจสอบ Firestore Rules"
        : nextError.message);
    });

    return unsubscribe;
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const unsubscribe = listenTodaySummary((summary) => {
      setTodaySummary(summary);
    }, (nextError) => {
      setError(nextError.code === "permission-denied"
        ? "ไม่มีสิทธิ์อ่านข้อมูลสรุปจาก Firestore"
        : nextError.message);
    });
    return unsubscribe;
  }, [user]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    const unsubscribe = listenSession(
      sessionId,
      (nextSession) => {
        setSession(nextSession);
      },
      (nextError) => {
        setError(nextError.code === "permission-denied"
          ? "ไม่มีสิทธิ์อ่านข้อมูลรอบการทำงานนี้"
          : nextError.message);
      },
    );

    return unsubscribe;
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    const unsubscribe = listenSessionEvents(
      sessionId,
      (events) => {
        setSessionEvents(events);
      },
      (nextError) => {
        setError(nextError.code === "permission-denied"
          ? "ไม่มีสิทธิ์อ่านประวัติการทำงาน"
          : nextError.message);
      },
    );

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
      <main className="mx-auto flex min-h-screen max-w-5xl items-center justify-center p-6">
        <div className="w-full max-w-2xl rounded-2xl bg-white/90 p-8 shadow-xl">
          <h1 className="text-2xl font-bold text-slate-900">ไม่สามารถเชื่อมต่อแดชบอร์ดได้</h1>
          <p className="mt-3 text-slate-700">{error}</p>
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-xl bg-emerald-600 px-4 py-2 font-semibold text-white transition hover:bg-emerald-700"
            >
              ลองใหม่
            </button>
            <button
              type="button"
              onClick={() => router.replace("/login")}
              className="rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              กลับหน้าเข้าสู่ระบบ
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (connectTimeout && (loading || booting)) {
    return (
      <main className="mx-auto flex min-h-screen max-w-5xl items-center justify-center p-6">
        <div className="w-full max-w-2xl rounded-2xl bg-white/90 p-8 shadow-xl">
          <h1 className="text-2xl font-bold text-slate-900">การเชื่อมต่อใช้เวลานานกว่าปกติ</h1>
          <p className="mt-3 text-slate-700">กรุณาตรวจสอบการเชื่อมต่อระบบ แล้วลองใหม่อีกครั้ง</p>
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-xl bg-emerald-600 px-4 py-2 font-semibold text-white transition hover:bg-emerald-700"
            >
              ลองใหม่
            </button>
            <button
              type="button"
              onClick={() => router.replace("/login")}
              className="rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              กลับหน้าเข้าสู่ระบบ
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl p-6">
      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-2">
        <Card className="border border-slate-200 bg-white/90 shadow-lg">
          <CardHeader className="pb-1 text-sm font-semibold text-slate-500">คะแนนปัจจุบัน</CardHeader>
          <CardBody className="pt-0">
            <p className="text-4xl font-bold text-emerald-700">{score}</p>
            <p className="text-xs text-slate-600">คะแนนสะสมรอบนี้</p>
          </CardBody>
        </Card>
        <Card className="border border-slate-200 bg-white/90 shadow-lg">
          <CardHeader className="pb-1 text-sm font-semibold text-slate-500">จำนวนขวดที่รับ</CardHeader>
          <CardBody className="pt-0">
            <p className="text-4xl font-bold text-slate-900">{totalBottles}</p>
            <p className="text-xs text-slate-600">รวมในรอบปัจจุบัน</p>
          </CardBody>
        </Card>
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2 border border-emerald-100 bg-white/90 shadow-xl">
          <CardHeader className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">ระบบรับคืนขวดอัตโนมัติ</p>
              <h1 className="text-3xl font-bold text-slate-900">สถานะเครื่อง</h1>
            </div>
            <Chip color={STATUS_COLOR[currentStatus]} variant="flat">
              {STATUS_LABEL[currentStatus]}
            </Chip>
          </CardHeader>
          <CardBody className="pt-0">
            <p className="text-slate-700">{STATUS_MESSAGE[currentStatus]}</p>
            <Divider className="my-4" />
            <Progress
              aria-label="session-activity-progress"
              value={progressValue}
              color="success"
              className="mt-4 max-w-full"
              label="กำลังโหลด"
              showValueLabel
            />
          </CardBody>
        </Card>

        <Card className="border border-slate-200 bg-white/90 shadow-xl">
          <CardHeader className="pb-1 text-lg font-semibold text-slate-900">สถานะอุปกรณ์</CardHeader>
          <CardBody className="space-y-3 pt-0">
            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
              <span className="text-sm text-slate-600">การเชื่อมต่อเครื่องควบคุม</span>
              <Chip size="sm" color={connectionState === "connected" ? "success" : "warning"} variant="flat">
                {connectionState === "connected" ? "เชื่อมต่อแล้ว" : connectionState === "stale" ? "สัญญาณไม่อัปเดต" : "ไม่ทราบสถานะ"}
              </Chip>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
              <span className="text-sm text-slate-600">กล้องตรวจสอบ</span>
              <Chip size="sm" color={currentStatus === "ANALYZING" ? "success" : "default"} variant="flat">
                {currentStatus === "ANALYZING" ? "กำลังทำงาน" : "รอการทำงาน"}
              </Chip>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
              <span className="text-sm text-slate-600">โซลินอยด์</span>
              <Chip size="sm" color={currentStatus === "ACCEPTED" ? "success" : "default"} variant="flat">
                {currentStatus === "ACCEPTED" ? "ทำงาน" : "พร้อมทำงาน"}
              </Chip>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
              <span className="text-sm text-slate-600">เซ็นเซอร์ขวด</span>
              <Chip size="sm" color={currentStatus === "WAITING_BOTTLE" ? "primary" : "default"} variant="flat">
                {currentStatus === "WAITING_BOTTLE" ? "กำลังตรวจจับ" : "รอการทำงาน"}
              </Chip>
            </div>
          </CardBody>
        </Card>

        <Card className="border border-slate-200 bg-white/90 shadow-xl">
          <CardHeader className="pb-1 text-lg font-semibold text-slate-900">จำนวนขวดแต่ละขนาด</CardHeader>
          <CardBody className="pt-0">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-emerald-50 p-3 text-center">
                <p className="text-xs text-slate-600">ขวดเล็ก</p>
                <p className="text-2xl font-bold text-emerald-700">{small}</p>
              </div>
              <div className="rounded-xl bg-sky-50 p-3 text-center">
                <p className="text-xs text-slate-600">ขวดกลาง</p>
                <p className="text-2xl font-bold text-sky-700">{medium}</p>
              </div>
              <div className="rounded-xl bg-amber-50 p-3 text-center">
                <p className="text-xs text-slate-600">ขวดใหญ่</p>
                <p className="text-2xl font-bold text-amber-700">{large}</p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card className="border border-slate-200 bg-white/90 shadow-xl">
          <CardHeader className="pb-1 text-lg font-semibold text-slate-900">สรุปข้อมูลวันนี้</CardHeader>
          <CardBody className="pt-0">
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                <span className="text-sm text-slate-600">จำนวนรอบ</span>
                <span className="text-lg font-bold text-slate-900">{todaySummary.sessions}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                <span className="text-sm text-slate-600">จำนวนขวดทั้งหมด</span>
                <span className="text-lg font-bold text-slate-900">{todaySummary.bottles}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                <span className="text-sm text-slate-600">คะแนนรวม</span>
                <span className="text-lg font-bold text-emerald-700">{todaySummary.score}</span>
              </div>
            </div>
          </CardBody>
        </Card>
      </section>

      <section className="mt-5">
        <Card className="border border-slate-200 bg-white/90 shadow-xl">
          <CardHeader className="pb-1 text-lg font-semibold text-slate-900">ประวัติการทำงานล่าสุด</CardHeader>
          <CardBody className="pt-0">
            {sessionEvents.length === 0 ? (
              <p className="text-sm text-slate-500">ยังไม่มีข้อมูลการทำงานในรอบนี้</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="px-2 py-2 font-semibold">เวลา</th>
                      <th className="px-2 py-2 font-semibold">ผลการตรวจ</th>
                      <th className="px-2 py-2 font-semibold">ขนาดขวด</th>
                      <th className="px-2 py-2 font-semibold">คะแนน</th>
                      <th className="px-2 py-2 font-semibold">ที่มา</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessionEvents.map((event, index) => (
                      <tr key={`${event.createdAt?.getTime() ?? index}-${event.type}`} className="border-b border-slate-100">
                        <td className="px-2 py-2 text-slate-700">{formatClock(event.createdAt)}</td>
                        <td className="px-2 py-2">
                          <Chip size="sm" variant="flat" color={event.type === "ACCEPTED" ? "success" : "danger"}>
                            {event.type === "ACCEPTED" ? "รับขวด" : "ไม่รับขวด"}
                          </Chip>
                        </td>
                        <td className="px-2 py-2 text-slate-700">{bottleSizeLabel(event.bottleSize)}</td>
                        <td className="px-2 py-2 text-slate-700">{event.scoreDelta > 0 ? `+${event.scoreDelta}` : "0"}</td>
                        <td className="px-2 py-2 text-slate-700">{event.source ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </section>
    </main>
  );
}
