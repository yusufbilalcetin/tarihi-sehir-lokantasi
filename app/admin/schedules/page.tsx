import type { Metadata } from "next";
import { ErpWorkspaceModule } from "@/components/admin/erp-workspace-module";

export const metadata: Metadata = { title: "Vardiya Planı" };

export default function Page(){return <ErpWorkspaceModule module="schedules"/>;}
