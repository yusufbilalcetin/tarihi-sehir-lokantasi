import type { Metadata } from "next";
import { LoginForm } from "@/components/staff/login-form";

export const metadata: Metadata = {
  title: "Personel Girişi",
};

export default function StaffLoginPage() {
  return <LoginForm />;
}
