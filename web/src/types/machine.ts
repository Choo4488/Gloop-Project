export type MachineStatus =
  | "OFFLINE"
  | "READY"
  | "WAITING_BOTTLE"
  | "ANALYZING"
  | "ACCEPTED"
  | "REJECTED"
  | "SESSION_ENDED";

export type BottleSize = "small" | "medium" | "large";

export type MachineDoc = {
  status: MachineStatus;
  machineName: string;
  activeSessionId: string | null;
  updatedAt: Date | null;
  lastHeartbeatAt: Date | null;
};

export type SessionDoc = {
  machineId: string;
  userId: string;
  status: "ACTIVE" | "ENDED";
  score: number;
  bottleCounts: Record<BottleSize, number>;
  startedAt: Date | null;
  endedAt: Date | null;
  lastBottleAt: Date | null;
};
