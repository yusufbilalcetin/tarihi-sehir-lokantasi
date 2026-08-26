import { Boxes } from "lucide-react";
import { AdminModuleWindow } from "@/components/admin/admin-module-window";
import { InventoryDetailManager } from "@/components/admin/inventory-detail-manager";
export default async function Page({params}:{params:Promise<{itemId:string}>}){const {itemId}=await params;return <AdminModuleWindow title="Stok Ayrıntısı" description="Depo bakiyeleri ve değiştirilemez stok hareket geçmişi." icon={Boxes} size="workspace"><InventoryDetailManager itemId={itemId}/></AdminModuleWindow>}
