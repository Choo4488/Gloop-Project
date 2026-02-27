"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase/client";

export function useAuthUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setLoading(false);
      setError("Auth check timeout. Please verify network and Firebase Authentication settings.");
    }, 6000);

    const unsubscribe = onAuthStateChanged(
      auth,
      (nextUser) => {
        window.clearTimeout(timeoutId);
        setUser(nextUser);
        setLoading(false);
      },
      (nextError) => {
        window.clearTimeout(timeoutId);
        setLoading(false);
        setError(nextError.message);
      },
    );

    return () => {
      window.clearTimeout(timeoutId);
      unsubscribe();
    };

  }, []);

  return { user, loading, error };
}
