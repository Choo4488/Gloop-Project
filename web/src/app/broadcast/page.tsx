"use client";

import dynamic from "next/dynamic";

const BroadcastClientPage = dynamic(() => import("../waiting/client-page"), { ssr: false });

export default function Page() {
  return <BroadcastClientPage />;
}
