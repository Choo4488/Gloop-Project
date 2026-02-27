export const ACTIVE_SESSION_KEY = "activeSessionId";

export function saveSessionId(sessionId: string): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
}

export function getSessionId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(ACTIVE_SESSION_KEY);
}

export function clearSessionId(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(ACTIVE_SESSION_KEY);
}
