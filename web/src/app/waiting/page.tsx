"use client";

import dynamic from "next/dynamic";

const WaitingClientPage = dynamic(() => import("./client-page"), { ssr: false });

export default function Page() {
  return <WaitingClientPage />;
}
