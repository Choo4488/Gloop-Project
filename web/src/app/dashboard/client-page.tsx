"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function DashboardPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/waiting");
  }, [router]);

  return <main className="p-8">Redirecting...</main>;
}
