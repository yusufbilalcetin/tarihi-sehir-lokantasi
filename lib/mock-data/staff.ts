import type { StaffUser } from "@/types";

export const staffUsers: StaffUser[] = [
  { id: "s1", name: "Ahmet Yılmaz", code: "1042", role: "Garson", active: true, phone: "0532 420 18 42", shift: "10:00 - 18:00", permissions: ["Sipariş görüntüle", "Sipariş ekle", "Tükendi işaretle"] },
  { id: "s2", name: "Mehmet Kaya", code: "1038", role: "Şef Garson", active: true, phone: "0533 118 72 14", shift: "12:00 - 22:00", permissions: ["Sipariş görüntüle", "Sipariş ekle", "Sipariş iptal", "Tükendi işaretle", "İndirim uygula"] },
  { id: "s3", name: "Ayşe Demir", code: "1061", role: "Kasa", active: true, phone: "0544 610 27 08", shift: "11:00 - 21:00", permissions: ["Sipariş görüntüle", "İndirim uygula"] },
  { id: "s4", name: "Kemal Arslan", code: "1014", role: "Mutfak", active: true, phone: "0505 774 21 91", shift: "09:00 - 18:00", permissions: ["Sipariş görüntüle", "Tükendi işaretle"] },
  { id: "s5", name: "Nermin Çelik", code: "1001", role: "Admin", active: true, phone: "0530 440 16 01", shift: "09:00 - 18:00", permissions: ["Sipariş görüntüle", "Sipariş ekle", "Sipariş iptal", "Tükendi işaretle", "İndirim uygula", "Menü düzenle", "Rapor görüntüle"] },
];
