"use client";

import dynamic from "next/dynamic";

const ScoreClientPage = dynamic(() => import("./client-page"), { ssr: false });

export default function Page() {
  return <ScoreClientPage />;
}
