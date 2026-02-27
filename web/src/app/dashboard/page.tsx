"use client";

import dynamic from "next/dynamic";

const DashboardClientPage = dynamic(() => import("./client-page"), { ssr: false });

export default function Page() {
  return <DashboardClientPage />;
}
