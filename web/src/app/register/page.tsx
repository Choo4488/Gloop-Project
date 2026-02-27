"use client";

import dynamic from "next/dynamic";

const RegisterClientPage = dynamic(() => import("./client-page"), { ssr: false });

export default function Page() {
  return <RegisterClientPage />;
}
