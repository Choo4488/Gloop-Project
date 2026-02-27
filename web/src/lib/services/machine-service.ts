import {
  addDoc,
  collection,
  doc,
  FirestoreError,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { db, MACHINE_ID } from "@/lib/firebase/client";
import { BottleSize, MachineDoc, MachineStatus, SessionDoc } from "@/types/machine";

const machinesCollection = "machines";
const sessionsCollection = "sessions";
const sessionEventsCollection = "sessionEvents";

function asDate(value: Timestamp | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  return value.toDate();
}

export async function ensureMachineDocument(): Promise<void> {
  const machineRef = doc(db, machinesCollection, MACHINE_ID);
  try {
    const machineSnapshot = await getDoc(machineRef);

    if (machineSnapshot.exists()) {
      return;
    }

    await setDoc(machineRef, {
      machineName: "Bottle Return Machine #1",
      status: "OFFLINE",
      activeSessionId: null,
      updatedAt: serverTimestamp(),
      lastHeartbeatAt: serverTimestamp(),
    });
  } catch (error) {
    const firestoreError = error as FirestoreError;
    if (firestoreError.code === "unavailable") {
      return;
    }

    throw error;
  }
}

export async function startUserSession(userId: string): Promise<string> {
  const sessionRef = await addDoc(collection(db, sessionsCollection), {
    machineId: MACHINE_ID,
    userId,
    status: "ACTIVE",
    score: 0,
    bottleCounts: {
      small: 0,
      medium: 0,
      large: 0,
    },
    startedAt: serverTimestamp(),
    endedAt: null,
    lastBottleAt: null,
  });

  await updateMachineStatus("READY", sessionRef.id);
  return sessionRef.id;
}

export async function updateMachineStatus(status: MachineStatus, activeSessionId: string | null): Promise<void> {
  const machineRef = doc(db, machinesCollection, MACHINE_ID);

  await setDoc(
    machineRef,
    {
      status,
      activeSessionId,
      updatedAt: serverTimestamp(),
      lastHeartbeatAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function endSessionByUser(sessionId: string): Promise<void> {
  const sessionRef = doc(db, sessionsCollection, sessionId);

  await updateDoc(sessionRef, {
    status: "ENDED",
    endedAt: serverTimestamp(),
  });

  await updateMachineStatus("OFFLINE", null);
}

export function listenMachine(callback: (machine: MachineDoc | null) => void): () => void {
  const machineRef = doc(db, machinesCollection, MACHINE_ID);

  return onSnapshot(machineRef, (snapshot) => {
    if (!snapshot.exists()) {
      callback(null);
      return;
    }

    const data = snapshot.data();

    callback({
      machineName: data.machineName,
      status: data.status,
      activeSessionId: data.activeSessionId,
      updatedAt: asDate(data.updatedAt),
      lastHeartbeatAt: asDate(data.lastHeartbeatAt),
    });
  });
}

export function listenSession(sessionId: string, callback: (session: SessionDoc | null) => void): () => void {
  const sessionRef = doc(db, sessionsCollection, sessionId);

  return onSnapshot(sessionRef, (snapshot) => {
    if (!snapshot.exists()) {
      callback(null);
      return;
    }

    const data = snapshot.data();

    callback({
      machineId: data.machineId,
      userId: data.userId,
      status: data.status,
      score: data.score,
      bottleCounts: data.bottleCounts,
      startedAt: asDate(data.startedAt),
      endedAt: asDate(data.endedAt),
      lastBottleAt: asDate(data.lastBottleAt),
    });
  });
}

export async function addSessionEvent(sessionId: string, type: "ACCEPTED" | "REJECTED", bottleSize?: BottleSize): Promise<void> {
  await addDoc(collection(db, sessionEventsCollection), {
    sessionId,
    type,
    bottleSize: bottleSize ?? null,
    createdAt: serverTimestamp(),
  });
}
