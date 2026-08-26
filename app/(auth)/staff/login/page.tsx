import type { Metadata } from "next";
import { connection } from "next/server";
import { LoginForm } from "@/components/staff/login-form";

export const metadata: Metadata = {
  title: "Personel Girişi",
};

// The CSP nonce is issued per request, so this page cannot be prerendered:
// a cached shell would carry a nonce the response header no longer matches.
export default async function StaffLoginPage() {
  await connection();
  return <LoginForm />;
}
