"use client";

import dynamic from "next/dynamic";

const LoginClientPage = dynamic(() => import("./client-page"), { ssr: false });

export default function Page() {
  return <LoginClientPage />;
}
