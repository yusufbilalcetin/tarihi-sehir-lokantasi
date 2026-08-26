"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Download, Plus, RefreshCw, Search, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { EmptyState, ErrorState, LoadingState } from "@/components/shared/data-states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ApiResult } from "@/lib/api/response";
import { ERP_CSV_EXPORTS } from "@/lib/domain/erp-csv";
import { erpEnumLabel, ERP_UNIT_LABELS, ERP_WASTE_TYPE_LABELS } from "@/lib/domain/erp-workspaces";
import { ERP_UI_CONFIG, erpEmptyState, type ErpColumn } from "@/lib/domain/erp-ui";
import type { ErpWorkspaceData, ErpWorkspaceModule } from "@/lib/domain/erp-workspaces";
import { useApiResource } from "@/lib/hooks/use-api-resource";

type Option = Record<string, string> & { value: string; label: string };
type Field = { key: string; label: string; type?: "text" | "number" | "date" | "datetime-local"; options?: string; placeholder?: string; required?: boolean };
type Action = { id: string; title: string; description: string; endpoint: "core" | "workspace"; fields: readonly Field[]; requiresReview?: boolean };

const UNIT_LABELS=ERP_UNIT_LABELS;
const WASTE_LABELS=ERP_WASTE_TYPE_LABELS;

function actionDefinitions(module: ErpWorkspaceModule): readonly Action[] {
  switch(module){
    case "inventory": return [
      {id:"adjust",title:"Manuel stok düzeltmesi",description:"Gerekçeli bir stok hareketi yazar; mevcut bakiyeyi doğrudan değiştirmez.",endpoint:"core",fields:[{key:"inventoryItemId",label:"Stok kalemi",options:"inventoryItems",required:true},{key:"warehouseId",label:"Depo",options:"warehouses",required:true},{key:"quantityDelta",label:"Miktar (+ / -)",placeholder:"-2.500",required:true},{key:"reason",label:"Açıklama",required:true}]},
      {id:"count",title:"Fiziksel sayımı onayla",description:"Beklenen miktarı sunucuda yeniden hesaplar ve farkı sayım düzeltmesi olarak yazar.",endpoint:"workspace",fields:[{key:"warehouseId",label:"Depo",options:"warehouses",required:true},{key:"inventoryItemId",label:"Stok kalemi",options:"inventoryItems",required:true},{key:"countedQuantity",label:"Sayılan miktar",required:true}]},
    ];
    case "warehouses": return [{id:"transfer",title:"Depolar arası transfer",description:"Çıkış ve giriş tek işlemde birlikte kaydedilir.",endpoint:"workspace",fields:[{key:"sourceWarehouseId",label:"Kaynak depo",options:"warehouses",required:true},{key:"destinationWarehouseId",label:"Hedef depo",options:"warehouses",required:true},{key:"inventoryItemId",label:"Stok kalemi",options:"inventoryItems",required:true},{key:"quantity",label:"Miktar",required:true},{key:"note",label:"Açıklama",required:true}]}];
    case "recipes": return [
      {id:"recipe",title:"Yeni reçete sürümü",description:"Taslak bir sürüm ve ilk bileşenini oluşturur; sürüm otomatik artar.",endpoint:"core",fields:[{key:"productId",label:"Ürün",options:"products",required:true},{key:"yieldPortions",label:"Porsiyon verimi",required:true},{key:"inventoryItemId",label:"İlk bileşen",options:"inventoryItems",required:true},{key:"quantity",label:"Bileşen miktarı",required:true},{key:"unit",label:"Birim",options:"units",required:true}]},
      {id:"updateRecipe",title:"Taslak reçeteyi düzenle",description:"Taslak sürümün verimini ve bileşen listesini doğrulanmış birim dönüşümüyle günceller.",endpoint:"workspace",fields:[{key:"recipeVersionId",label:"Taslak sürüm",options:"rows",required:true},{key:"yieldPortions",label:"Porsiyon verimi",required:true},{key:"inventoryItemId",label:"Bileşen",options:"inventoryItems",required:true},{key:"quantity",label:"Miktar",required:true},{key:"unit",label:"Birim",options:"units",required:true}]},
    ];
    case "production": return [
      {id:"plan",title:"Üretim planla",description:"İş günü, aktif reçete ve depo için planlanan porsiyonu kaydeder.",endpoint:"core",fields:[{key:"recipeVersionId",label:"Aktif reçete",options:"recipes",required:true},{key:"warehouseId",label:"Depo",options:"warehouses",required:true},{key:"businessDate",label:"İş günü",type:"date",required:true},{key:"plannedPortions",label:"Planlanan porsiyon",required:true}]},
      {id:"complete",title:"Üretimi tamamla",description:"Hazırlanan porsiyona göre reçetedeki malzemeleri stoktan düşer; iki kez gönderilse bile bir kez işlenir.",endpoint:"core",fields:[{key:"batchId",label:"Plan",options:"rows",required:true},{key:"actualPortions",label:"Hazırlanan porsiyon",required:true}]},
    ];
    case "waste": return [{id:"waste",title:"Yeni fire kaydı",description:"Ne olduğunu, hangi ürünü ve miktarı seçin; depo ve maliyet bilgisi stok kaydını tamamlar.",endpoint:"core",fields:[{key:"wasteType",label:"Ne oldu?",options:"wasteTypes",required:true},{key:"inventoryItemId",label:"Hangi ürün?",options:"inventoryItems",required:true},{key:"quantity",label:"Ne kadar?",required:true},{key:"unit",label:"Birim",options:"units",required:true},{key:"warehouseId",label:"Hangi depo?",options:"warehouses",required:true},{key:"estimatedCost",label:"Tahmini kayıp tutarı",required:true},{key:"reason",label:"Açıklama",required:true}]}];
    case "suppliers": return [
      {id:"supplier",title:"Tedarikçi ekle",description:"İletişim ve operasyon notlarıyla yeni tedarikçi oluşturur.",endpoint:"core",fields:[{key:"name",label:"Tedarikçi adı",required:true},{key:"contactPerson",label:"Yetkili"},{key:"phone",label:"Telefon"},{key:"email",label:"E-posta"},{key:"notes",label:"Not"}]},
      {id:"supplierItem",title:"Tedarikçi ürün eşleştirmesi",description:"Paket miktarı, son fiyat ve termin süresiyle stok kalemini tedarikçiye bağlar.",endpoint:"workspace",fields:[{key:"supplierId",label:"Tedarikçi",options:"suppliers",required:true},{key:"inventoryItemId",label:"Stok kalemi",options:"inventoryItems",required:true},{key:"supplierItemCode",label:"Tedarikçi kodu"},{key:"packQuantity",label:"Paket miktarı",required:true},{key:"packUnit",label:"Paket birimi",options:"units",required:true},{key:"lastUnitPrice",label:"Son birim fiyat",required:true},{key:"leadTimeDays",label:"Termin (gün)",type:"number"}]},
    ];
    case "purchasing": return [
      {id:"po",title:"Satın alma siparişi",description:"Tek kalemle taslak açın; ayrıntı ekranından ek mal kabul yapılabilir.",endpoint:"core",fields:[{key:"supplierId",label:"Tedarikçi",options:"suppliers",required:true},{key:"orderNumber",label:"Sipariş no",required:true},{key:"inventoryItemId",label:"Stok kalemi",options:"inventoryItems",required:true},{key:"orderedQuantity",label:"Miktar",required:true},{key:"unit",label:"Birim",options:"units",required:true},{key:"unitPrice",label:"Birim fiyat",required:true}]},
      {id:"receipt",title:"Mal kabul",description:"Satın alma satırını seçin, gelen miktarı yazın ve kabul edin. Sipariş kalanını aşan miktar kaydedilmez.",endpoint:"core",fields:[{key:"purchaseOrderItemId",label:"Hangi satın alma ve ürün?",options:"purchaseOrderItems",required:true},{key:"receivedQuantity",label:"Kaç geldi?",required:true},{key:"warehouseId",label:"Hangi depoya girdi?",options:"warehouses",required:true},{key:"receiptNumber",label:"İrsaliye / kabul no",required:true},{key:"unitPrice",label:"Gerçek birim fiyat",required:true}]},
    ];
    case "payables": return [
      {id:"invoice",title:"Tedarikçi faturası",description:"Açık operasyonel borç oluşturur.",endpoint:"core",fields:[{key:"supplierId",label:"Tedarikçi",options:"suppliers",required:true},{key:"invoiceNumber",label:"Fatura no",required:true},{key:"total",label:"Toplam",required:true},{key:"dueDate",label:"Vade",type:"date"}]},
      {id:"payment",title:"Tedarikçi ödemesi",description:"Ödeme kaydedilmeden önce tedarikçi, toplam borç ve ödeme sonrası kalan tutar gösterilir.",endpoint:"core",requiresReview:true,fields:[{key:"supplierInvoiceId",label:"Açık fatura",options:"rows",required:true},{key:"amount",label:"Ödeme tutarı",required:true},{key:"method",label:"Ödeme yöntemi",options:"paymentMethods",required:true},{key:"reference",label:"Not / referans"}]},
    ];
    case "schedules": return [{id:"schedule",title:"Vardiya planla",description:"Aynı personelin çakışan vardiyası kayıtta engellenir.",endpoint:"core",fields:[{key:"staffId",label:"Personel",options:"staff",required:true},{key:"startsAt",label:"Başlangıç",type:"datetime-local",required:true},{key:"endsAt",label:"Bitiş",type:"datetime-local",required:true},{key:"roleLabel",label:"Görev"},{key:"locationLabel",label:"Konum"},{key:"notes",label:"Not"}]}];
    case "attendance": return [{id:"attendanceCorrection",title:"Puantaj düzeltmesi",description:"Önceki ve yeni değer değişiklik geçmişine yazılır; gerekçe zorunludur.",endpoint:"workspace",fields:[{key:"attendanceRecordId",label:"Puantaj kaydı",options:"rows",required:true},{key:"clockInAt",label:"Yeni giriş",type:"datetime-local",required:true},{key:"clockOutAt",label:"Yeni çıkış",type:"datetime-local"},{key:"breakMinutes",label:"Mola (dk)",type:"number",required:true},{key:"reason",label:"Düzeltme gerekçesi",required:true}]}];
    case "payroll": return [{id:"payroll",title:"Operasyonel bordro kaydı",description:"Yasal SGK/vergi hesabı yapmaz; girilen rakamların netini kuruş hassasiyetinde hesaplar.",endpoint:"workspace",fields:[{key:"staffId",label:"Personel",options:"staff",required:true},{key:"periodStart",label:"Dönem başlangıç",type:"date",required:true},{key:"periodEnd",label:"Dönem sonu",type:"date",required:true},{key:"workedMinutes",label:"Çalışma dakikası",type:"number",required:true},{key:"overtimeMinutes",label:"Fazla mesai dakikası",type:"number",required:true},{key:"grossSalary",label:"Brüt",required:true},{key:"allowances",label:"Ekler",required:true},{key:"deductions",label:"Kesintiler",required:true}]}];
    case "reservations": return [{id:"reservation",title:"Rezervasyon talebi",description:"Güvenli varsayılan olarak onay bekleyen kayıt açar; masa çakışması onaylı akışta engellenir.",endpoint:"core",fields:[{key:"customerName",label:"Misafir adı",required:true},{key:"phone",label:"Telefon",required:true},{key:"partySize",label:"Kişi sayısı",type:"number",required:true},{key:"startsAt",label:"Başlangıç",type:"datetime-local",required:true},{key:"endsAt",label:"Bitiş",type:"datetime-local",required:true},{key:"tableId",label:"Masa",options:"tables"},{key:"notes",label:"Not"}]}];
    case "fulfillment": return [{id:"fulfillment",title:"Paket / kurye siparişi al",description:"Fiyat üründen okunur; kurye siparişinde adres zorunludur. Tek kalemle açılır, kalan kalemler sipariş üzerinden eklenir.",endpoint:"core",fields:[{key:"channel",label:"Kanal",options:"channels",required:true},{key:"customerName",label:"Müşteri adı",required:true},{key:"contact",label:"Telefon",required:true},{key:"address",label:"Teslimat adresi (kurye)"},{key:"productId",label:"Ürün",options:"products",required:true},{key:"quantity",label:"Adet",type:"number",required:true},{key:"deliveryFee",label:"Teslimat ücreti",placeholder:"0"},{key:"deliveryNotes",label:"Not"}]},
      {id:"linkOrder",title:"Siparişi mutfağa bağla",description:"Paket kaydını açık bir siparişe bağlar; mutfak ekranı, kasa, ödeme ve iade o siparişin üzerinden yürür. Ayrı bir ödeme sistemi kurulmaz.",endpoint:"workspace",fields:[{key:"fulfillmentId",label:"Paket kaydı",options:"rows",required:true},{key:"orderId",label:"Açık sipariş",options:"openOrders",required:true}]}];
    case "customers": return [{id:"customerAccount",title:"Müşteri hesabı aç",description:"Hesap isteğe bağlıdır; misafir QR menü kullanımı bundan etkilenmez. Pazarlama izni işaretlenirse izin anı da kaydedilir.",endpoint:"core",fields:[{key:"name",label:"Ad Soyad",required:true},{key:"email",label:"E-posta"},{key:"phone",label:"Telefon"},{key:"marketingConsent",label:"Pazarlama izni",options:"consent"}]}];
    case "popular": return [{id:"popular",title:"30 günlük popülerlik hesabı",description:"Son 30 günün tamamlanmış satışlarından popüler ürün sıralamasını yeniler.",endpoint:"core",fields:[]}];
    default:return [];
  }
}

function formatMoney(value: unknown): string {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(Number.isFinite(amount) ? amount : 0);
}

function rowOptionLabel(row: Record<string, unknown>): string {
  const parts = [
    row.staff,
    row.supplier,
    row.product,
    row.inventory_item,
    row.invoice_number ? `Fatura ${String(row.invoice_number)}` : null,
    row.order_number ? `Sipariş ${String(row.order_number)}` : null,
    row.business_date,
    row.remaining !== undefined ? `Kalan ${formatMoney(row.remaining)}` : null,
  ].filter((part): part is string => typeof part === "string" && part.trim().length > 0);
  return parts.length ? parts.join(" · ") : "Seçili kayıt";
}

function optionsFor(field:Field,data:ErpWorkspaceData):Option[]{
  if(field.options==="units")return Object.entries(UNIT_LABELS).map(([value,label])=>({value,label}));
  if(field.options==="wasteTypes")return Object.entries(WASTE_LABELS).map(([value,label])=>({value,label}));
  if(field.options==="consent")return [{value:"false",label:"İzin yok"},{value:"true",label:"İzin verildi"}];
  if(field.options==="channels")return [{value:"TAKEAWAY",label:"Gel-Al"},{value:"DELIVERY",label:"Kurye"}];
  if(field.options==="paymentMethods")return [{value:"BANK",label:"Banka"},{value:"CASH",label:"Nakit"},{value:"OTHER",label:"Diğer"}];
  if(field.options==="rows")return data.rows.map(row=>({value:String(row.id),label:rowOptionLabel(row)}));
  return (data.options[field.options??""]??[]) as Option[];
}

function localIso(value:string){return value?new Date(value).toISOString():null;}

function buildCommand(module:ErpWorkspaceModule,actionId:string,v:Record<string,string>,data:ErpWorkspaceData):Record<string,unknown>{
  const key=crypto.randomUUID();
  if(actionId==="adjust")return{command:"POST_STOCK_MOVEMENT",inventoryItemId:v.inventoryItemId,warehouseId:v.warehouseId,movementType:"MANUAL_ADJUSTMENT",quantityDelta:v.quantityDelta,unitCost:null,sourceType:"MANUAL_ADJUSTMENT",sourceId:null,idempotencyKey:key,reason:v.reason};
  if(actionId==="count")return{command:"CONFIRM_STOCK_COUNT",warehouseId:v.warehouseId,idempotencyKey:key,lines:[{inventoryItemId:v.inventoryItemId,expectedQuantity:"0",countedQuantity:v.countedQuantity}]};
  if(actionId==="transfer")return{command:"TRANSFER_STOCK",sourceWarehouseId:v.sourceWarehouseId,destinationWarehouseId:v.destinationWarehouseId,inventoryItemId:v.inventoryItemId,quantity:v.quantity,note:v.note,idempotencyKey:key};
  if(actionId==="recipe")return{command:"CREATE_RECIPE",productId:v.productId,yieldPortions:v.yieldPortions,ingredients:[{inventoryItemId:v.inventoryItemId,quantity:v.quantity,unit:v.unit}]};
  if(actionId==="updateRecipe")return{command:"UPDATE_DRAFT_RECIPE",recipeVersionId:v.recipeVersionId,yieldPortions:v.yieldPortions,ingredients:[{inventoryItemId:v.inventoryItemId,quantity:v.quantity,unit:v.unit}]};
  if(actionId==="plan"){const recipe=(data.options.recipes??[]).find(x=>x.value===v.recipeVersionId);return{command:"CREATE_PRODUCTION_BATCH",productId:recipe?.product_id,recipeVersionId:v.recipeVersionId,warehouseId:v.warehouseId,businessDate:v.businessDate,plannedPortions:v.plannedPortions,idempotencyKey:key};}
  if(actionId==="complete")return{command:"COMPLETE_PRODUCTION_BATCH",batchId:v.batchId,actualPortions:v.actualPortions};
  if(actionId==="waste")return{command:"RECORD_WASTE",warehouseId:v.warehouseId,inventoryItemId:v.inventoryItemId,wasteType:v.wasteType,quantity:v.quantity,unit:v.unit,estimatedCost:v.estimatedCost,reason:v.reason,idempotencyKey:key};
  if(actionId==="supplier")return{command:"CREATE_SUPPLIER",name:v.name,contactPerson:v.contactPerson||null,phone:v.phone||null,email:v.email||null,notes:v.notes||null};
  if(actionId==="supplierItem")return{command:"UPSERT_SUPPLIER_ITEM",supplierId:v.supplierId,inventoryItemId:v.inventoryItemId,supplierItemCode:v.supplierItemCode||null,packQuantity:v.packQuantity,packUnit:v.packUnit,lastUnitPrice:v.lastUnitPrice,leadTimeDays:v.leadTimeDays?Number(v.leadTimeDays):null,isActive:true};
  if(actionId==="po")return{command:"CREATE_PURCHASE_ORDER",supplierId:v.supplierId,orderNumber:v.orderNumber,expectedAt:null,notes:null,items:[{inventoryItemId:v.inventoryItemId,orderedQuantity:v.orderedQuantity,unit:v.unit,unitPrice:v.unitPrice}]};
  if(actionId==="receipt"){const line=(data.options.purchaseOrderItems??[]).find(x=>x.value===v.purchaseOrderItemId);return{command:"RECEIVE_GOODS",purchaseOrderId:line?.purchase_order_id,supplierId:line?.supplier_id,warehouseId:v.warehouseId,receiptNumber:v.receiptNumber,idempotencyKey:key,items:[{purchaseOrderItemId:v.purchaseOrderItemId,inventoryItemId:line?.inventory_item_id,receivedQuantity:v.receivedQuantity,unit:line?.unit,unitPrice:v.unitPrice}]};}
  if(actionId==="invoice")return{command:"CREATE_SUPPLIER_INVOICE",supplierId:v.supplierId,goodsReceiptId:null,invoiceNumber:v.invoiceNumber,total:v.total,dueDate:v.dueDate||null};
  if(actionId==="payment"){const invoice=data.rows.find(x=>String(x.id)===v.supplierInvoiceId);return{command:"RECORD_SUPPLIER_PAYMENT",supplierId:invoice?.supplier_id,supplierInvoiceId:v.supplierInvoiceId,amount:v.amount,method:v.method,reference:v.reference||null,idempotencyKey:key};}
  if(actionId==="schedule")return{command:"CREATE_SCHEDULE",staffId:v.staffId,startsAt:localIso(v.startsAt),endsAt:localIso(v.endsAt),roleLabel:v.roleLabel||null,locationLabel:v.locationLabel||null,notes:v.notes||null};
  if(actionId==="attendanceCorrection")return{command:"CORRECT_ATTENDANCE",attendanceRecordId:v.attendanceRecordId,clockInAt:localIso(v.clockInAt),clockOutAt:localIso(v.clockOutAt),breakMinutes:Number(v.breakMinutes),reason:v.reason};
  if(actionId==="payroll")return{command:"UPSERT_PAYROLL",staffId:v.staffId,periodStart:v.periodStart,periodEnd:v.periodEnd,workedMinutes:Number(v.workedMinutes),overtimeMinutes:Number(v.overtimeMinutes),grossSalary:v.grossSalary,allowances:v.allowances,deductions:v.deductions,status:"DRAFT",correctionReason:null};
  if(actionId==="reservation")return{command:"CREATE_RESERVATION",tableId:v.tableId||null,customerName:v.customerName,phone:v.phone,partySize:Number(v.partySize),startsAt:localIso(v.startsAt),endsAt:localIso(v.endsAt),notes:v.notes||null};
  if(actionId==="linkOrder")return{command:"LINK_FULFILLMENT_ORDER",fulfillmentId:v.fulfillmentId,orderId:v.orderId};
  if(actionId==="fulfillment")return{command:"CREATE_FULFILLMENT_REQUEST",channel:v.channel,customerName:v.customerName,contact:v.contact,address:v.channel==="DELIVERY"?(v.address||null):null,deliveryNotes:v.deliveryNotes||null,requestedAt:null,deliveryFee:v.deliveryFee||"0",idempotencyKey:key,items:[{productId:v.productId,quantity:Number(v.quantity),notes:null}]};
  if(actionId==="customerAccount")return{command:"CREATE_CUSTOMER_ACCOUNT",name:v.name,email:v.email||null,phone:v.phone||null,marketingConsent:v.marketingConsent==="true"};
  if(actionId==="popular")return{command:"REFRESH_POPULAR",windowDays:30};
  throw new Error(`${module} işlemi desteklenmiyor.`);
}

function formatValue(value:unknown,column:ErpColumn){
  if(value===null||value===undefined||value==="")return "Belirtilmedi";
  if(column.kind==="money")return new Intl.NumberFormat("tr-TR",{style:"currency",currency:"TRY"}).format(Number(value));
  if(column.kind==="date")return new Intl.DateTimeFormat("tr-TR",{dateStyle:"medium"}).format(new Date(String(value)));
  if(column.kind==="datetime")return new Intl.DateTimeFormat("tr-TR",{dateStyle:"short",timeStyle:"short"}).format(new Date(String(value)));
  if(column.kind==="percent")return `${value}%`;
  if(column.kind==="duration"){const minutes=Number(value);return `${Math.floor(minutes/60)} sa ${minutes%60} dk`;}
  if(column.kind==="boolean")return value?(column.key==="critical"||column.key==="low_rating"?"Dikkat":"Evet"):(column.key==="critical"||column.key==="low_rating"?"Normal":"Hayır");
  if(column.kind==="status")return erpEnumLabel(String(value))??"Tanımsız";
  if(column.key==="unit")return erpEnumLabel(String(value))??"Birimsiz";
  return String(value);
}

function TableValue({module,row,column}:{module:ErpWorkspaceModule;row:Record<string,unknown>;column:ErpColumn}){const value=formatValue(row[column.key],column);if(module==="inventory"&&column.key==="name")return <Link className="font-semibold text-olive underline-offset-4 hover:underline" href={`/admin/inventory/${String(row.id)}`}>{value}</Link>;return <>{value}</>}

async function apiCommand(module:ErpWorkspaceModule,endpoint:Action["endpoint"],body:Record<string,unknown>){const response=await fetch(endpoint==="core"?"/api/admin/erp":`/api/admin/erp/${module}`,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const payload=await response.json() as ApiResult<unknown>;if(!response.ok||!payload.success)throw new Error(payload.success?"İşlem tamamlanamadı.":payload.error.message);}

function rowActions(module:ErpWorkspaceModule,row:Record<string,unknown>):readonly {label:string;command:Record<string,unknown>}[]{const id=String(row.id);const status=String(row.status??"");if(module==="recipes")return status==="DRAFT"?[{label:"Aktifleştir",command:{command:"SET_RECIPE_STATUS",recipeVersionId:id,status:"ACTIVE"}},{label:"Emekliye Ayır",command:{command:"SET_RECIPE_STATUS",recipeVersionId:id,status:"RETIRED"}}]:status==="ACTIVE"?[{label:"Emekliye Ayır",command:{command:"SET_RECIPE_STATUS",recipeVersionId:id,status:"RETIRED"}}]:[];if(module==="purchasing")return status==="DRAFT"?[{label:"Gönder",command:{command:"SET_PURCHASE_ORDER_STATUS",purchaseOrderId:id,status:"SENT"}},{label:"İptal",command:{command:"SET_PURCHASE_ORDER_STATUS",purchaseOrderId:id,status:"CANCELLED"}}]:["SENT","PARTIALLY_RECEIVED"].includes(status)?[{label:"İptal",command:{command:"SET_PURCHASE_ORDER_STATUS",purchaseOrderId:id,status:"CANCELLED"}}]:[];if(module==="feedback")return status==="NEW"?[{label:"İncelendi",command:{command:"SET_FEEDBACK_STATUS",feedbackId:id,status:"REVIEWED"}},{label:"Gizle",command:{command:"SET_FEEDBACK_STATUS",feedbackId:id,status:"HIDDEN"}}]:status==="REVIEWED"?[{label:"Gizle",command:{command:"SET_FEEDBACK_STATUS",feedbackId:id,status:"HIDDEN"}}]:[];if(module==="schedules")return ["PLANNED","CONFIRMED"].includes(status)?[{label:status==="PLANNED"?"Onayla":"Tamamla",command:{command:"SET_SCHEDULE_STATUS",scheduleId:id,status:status==="PLANNED"?"CONFIRMED":"COMPLETED"}},{label:"İptal",command:{command:"SET_SCHEDULE_STATUS",scheduleId:id,status:"CANCELLED"}}]:[];if(module==="fulfillment"){const next={DRAFT:"PLACED",PLACED:"WAITING_FOR_COURIER",WAITING_FOR_COURIER:"OUT_FOR_DELIVERY",OUT_FOR_DELIVERY:"DELIVERED"}[status];const label={DRAFT:"Siparişi Al",PLACED:"Kuryeye Ver",WAITING_FOR_COURIER:"Yola Çıkar",OUT_FOR_DELIVERY:"Teslim Edildi"}[status];if(!next||!label)return[];return[{label,command:{command:"SET_FULFILLMENT_STATUS",fulfillmentId:id,status:next}},{label:"İptal",command:{command:"SET_FULFILLMENT_STATUS",fulfillmentId:id,status:"CANCELLED"}}];}
  if(module==="reservations"){if(status==="PENDING")return[{label:"Onayla",command:{command:"SET_RESERVATION_STATUS",reservationId:id,status:"CONFIRMED"}},{label:"İptal",command:{command:"SET_RESERVATION_STATUS",reservationId:id,status:"CANCELLED"}}];if(status==="CONFIRMED")return[{label:"Masaya Al",command:{command:"SET_RESERVATION_STATUS",reservationId:id,status:"SEATED"}},{label:"Gelmedi",command:{command:"SET_RESERVATION_STATUS",reservationId:id,status:"NO_SHOW"}},{label:"İptal",command:{command:"SET_RESERVATION_STATUS",reservationId:id,status:"CANCELLED"}}];if(status==="SEATED")return[{label:"Tamamla",command:{command:"SET_RESERVATION_STATUS",reservationId:id,status:"COMPLETED"}}];}return[];}

function RowActions({module,row,onDone}:{module:ErpWorkspaceModule;row:Record<string,unknown>;onDone:()=>Promise<void>}){const [saving,setSaving]=useState(false);const actions=rowActions(module,row);if(!actions.length)return null;return <div className="flex flex-wrap gap-1">{actions.map(action=><Button key={action.label} size="sm" variant="outline" disabled={saving} onClick={async()=>{setSaving(true);try{await apiCommand(module,"workspace",action.command);toast.success("Durum güncellendi.");await onDone();}catch(error){toast.error(error instanceof Error?error.message:"İşlem tamamlanamadı.");}finally{setSaving(false)}}}>{action.label}</Button>)}</div>}

function actionSubmitLabel(actionId: string, reviewing: boolean): string {
  if (actionId === "waste") return "Fireyi kaydet";
  if (actionId === "receipt") return "Mal kabulü kaydet";
  if (actionId === "reservation") return "Rezervasyonu kaydet";
  if (actionId === "attendanceCorrection") return "Düzeltmeyi kaydet";
  if (actionId === "payment") return reviewing ? "Ödemeyi onayla" : "Ödemeyi gözden geçir";
  return "Kaydet";
}

function ActionCard({action,module,data,onDone}:{action:Action;module:ErpWorkspaceModule;data:ErpWorkspaceData;onDone:()=>Promise<void>}) {
  const [values,setValues]=useState<Record<string,string>>({});
  const [saving,setSaving]=useState(false);
  const [reviewing,setReviewing]=useState(false);
  const [errorMessage,setErrorMessage]=useState<string | null>(null);
  const selectedInvoice = action.id === "payment"
    ? data.rows.find((row) => String(row.id) === values.supplierInvoiceId)
    : undefined;
  const paymentAmount = Number(values.amount ?? 0);
  const debtBefore = Number(selectedInvoice?.remaining ?? 0);
  const debtAfter = Math.max(0, debtBefore - (Number.isFinite(paymentAmount) ? paymentAmount : 0));

  function updateValue(key: string, value: string) {
    const knownUnit = action.id === "waste" && key === "inventoryItemId"
      ? data.options.inventoryItems?.find((option) => option.value === value)?.unit
      : undefined;
    setValues((old) => ({...old,[key]:value,...(knownUnit ? { unit: knownUnit } : {})}));
    setReviewing(false);
    setErrorMessage(null);
  }

  return (
    <Card id={`action-${action.id}`} tabIndex={-1} className="scroll-mt-24 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <CardHeader><CardTitle className="text-base">{action.title}</CardTitle><CardDescription>{action.description}</CardDescription></CardHeader>
      <CardContent>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={async (event) => {
          event.preventDefault();
          setErrorMessage(null);
          if (action.requiresReview && !reviewing) {
            if (paymentAmount <= 0 || !selectedInvoice) return;
            if (paymentAmount > debtBefore) {
              setErrorMessage(`Ödeme kalan borcu aşamaz. En fazla ${formatMoney(debtBefore)} kaydedebilirsiniz.`);
              return;
            }
            setReviewing(true);
            return;
          }
          setSaving(true);
          try {
            await apiCommand(module,action.endpoint,buildCommand(module,action.id,values,data));
            setValues({});
            setReviewing(false);
            toast.success("İşlem kaydedildi.");
            await onDone();
          } catch(error) {
            const message=error instanceof Error?error.message:"İşlem tamamlanamadı.";
            setErrorMessage(message);
            toast.error(message);
          } finally {
            setSaving(false);
          }
        }}>
          {action.fields.map((field) => {
            const fieldId = `${action.id}-${field.key}`;
            return <label key={field.key} htmlFor={fieldId} className="space-y-1.5 text-sm font-semibold"><span>{field.label}</span>{field.options?<Select value={values[field.key]??""} onValueChange={value=>updateValue(field.key,value??"")}><SelectTrigger id={fieldId} aria-required={field.required}><SelectValue placeholder="Seçin" /></SelectTrigger><SelectContent>{optionsFor(field,data).map(option=><SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>:<Input id={fieldId} type={field.type??"text"} required={field.required} value={values[field.key]??""} placeholder={field.placeholder} onChange={event=>updateValue(field.key,event.target.value)}/>}</label>;
          })}
          {action.id === "payment" && reviewing && selectedInvoice ? (
            <div className="sm:col-span-2 rounded-xl border border-copper/35 bg-copper/10 p-4" role="status" aria-live="polite">
              <p className="font-semibold">Ödeme özeti</p>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="text-muted-foreground">Tedarikçi</dt><dd className="font-semibold">{String(selectedInvoice.supplier ?? "Belirtilmedi")}</dd></div>
                <div><dt className="text-muted-foreground">Toplam borç</dt><dd className="font-semibold tabular-nums">{formatMoney(selectedInvoice.total)}</dd></div>
                <div><dt className="text-muted-foreground">Ödeme</dt><dd className="font-semibold tabular-nums">{formatMoney(paymentAmount)}</dd></div>
                <div><dt className="text-muted-foreground">Ödeme sonrası kalan</dt><dd className="font-semibold tabular-nums">{formatMoney(debtAfter)}</dd></div>
              </dl>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">Onayladığınızda bu ödeme tedarikçi borcuna işlenir.</p>
            </div>
          ) : null}
          {errorMessage ? <p className="sm:col-span-2 text-sm font-medium text-destructive" role="alert">{errorMessage}</p> : null}
          <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
            {reviewing ? <Button type="button" variant="outline" onClick={()=>setReviewing(false)}>Bilgileri değiştir</Button> : null}
            <Button disabled={saving}><Plus className="size-4" />{saving?"Kaydediliyor…":actionSubmitLabel(action.id,reviewing)}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * An empty ERP screen that explains itself.
 *
 * The prerequisite cases send the manager to the screen that has to come first
 * rather than leaving them in front of a table that can never fill. Where the
 * action lives on this same page, it points at the form below instead of
 * navigating away — there is no second form anywhere.
 */
function ErpEmpty({module,icon:Icon,options,filtered}:{module:ErpWorkspaceModule;icon:LucideIcon;options:ErpWorkspaceData["options"];filtered:boolean}){
  const state=erpEmptyState(module,options,filtered);
  const action=state.actionLabel
    ? (state.actionHref
        ? <Button nativeButton={false} render={<Link href={state.actionHref}/>}>{state.actionLabel}</Button>
        : <Button onClick={()=>document.getElementById("erp-actions")?.scrollIntoView({behavior:"smooth",block:"start"})}>{state.actionLabel}</Button>)
    : null;
  return <EmptyState icon={Icon} title={state.title} description={state.description} action={action}/>;
}

export function ErpWorkspaceManager({module,icon:Icon}:{module:ErpWorkspaceModule;icon:LucideIcon}){
  const config=ERP_UI_CONFIG[module];const [page,setPage]=useState(1);const [search,setSearch]=useState("");const [status,setStatus]=useState("");const [dateFrom,setDateFrom]=useState("");const [dateTo,setDateTo]=useState("");
  const load=useCallback(async(signal:AbortSignal)=>{const q=new URLSearchParams({page:String(page),pageSize:"25",search,status,...(dateFrom?{dateFrom}:{}),...(dateTo?{dateTo}:{})});const response=await fetch(`/api/admin/erp/${module}?${q}`,{credentials:"same-origin",cache:"no-store",signal});const payload=await response.json() as ApiResult<ErpWorkspaceData>;if(!response.ok||!payload.success)throw new Error(payload.success?"Veriler alınamadı.":payload.error.message);return payload.data;},[module,page,search,status,dateFrom,dateTo]);
  const resource=useApiResource(load);const actions=useMemo(()=>actionDefinitions(module),[module]);const data=resource.data;
  useEffect(() => {
    if (!data || !window.location.hash.startsWith("#action-")) return;
    const target = document.getElementById(window.location.hash.slice(1));
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.focus({ preventScroll: true });
  }, [data, module]);
  // The export is a server route: it owns the column allowlist, the spreadsheet
  // formula escaping and the row ceiling. Building the file here would mean a
  // second, unguarded copy of all three.
  const csvHref=ERP_CSV_EXPORTS[module]?`/api/admin/erp/export/${module}?${new URLSearchParams({search,status,...(dateFrom?{dateFrom}:{}),...(dateTo?{dateTo}:{})})}`:null;
  return <div className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-3xl text-sm font-semibold text-olive">{config.question}</p><div className="flex gap-2">{csvHref?<Button nativeButton={false} variant="outline" render={<a href={csvHref} download/>}><Download className="size-4"/>CSV</Button>:null}<Button variant="outline" onClick={()=>void resource.refetch()} disabled={resource.refreshing}><RefreshCw className={resource.refreshing?"size-4 animate-spin":"size-4"}/>Yenile</Button></div></div>
    {data?.notice?<div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-sm"><AlertTriangle className="mr-2 inline size-4 text-amber-700"/>{data.notice}</div>:null}
    <Card><CardContent className="grid gap-3 p-4 md:grid-cols-[minmax(12rem,1fr)_10rem_10rem_10rem]"><label className="relative"><Search className="absolute left-3 top-3 size-4 text-muted-foreground"/><Input className="pl-9" value={search} onChange={e=>{setPage(1);setSearch(e.target.value)}} placeholder="Ara…"/></label>{config.statuses?<Select value={status||"ALL"} onValueChange={v=>{setPage(1);setStatus(v==="ALL"?"":v??"")}}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="ALL">Tüm durumlar</SelectItem>{config.statuses.map(x=><SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select>:<span/>}<Input type="date" value={dateFrom} aria-label="Başlangıç tarihi" onChange={e=>{setPage(1);setDateFrom(e.target.value)}}/><Input type="date" value={dateTo} aria-label="Bitiş tarihi" onChange={e=>{setPage(1);setDateTo(e.target.value)}}/></CardContent></Card>
    {resource.loading&&!data?<LoadingState rows={6}/>:resource.error&&!data?<ErrorState title={`${config.title} yüklenemedi`} description={resource.error.message} onRetry={()=>void resource.refetch()}/>:data&&!data.rows.length?<ErpEmpty module={module} icon={Icon} options={data.options} filtered={Boolean(search||status||dateFrom||dateTo)}/>:data?<Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b bg-muted/45 text-left text-xs text-muted-foreground">{config.columns.map(c=><th key={c.key} className="px-4 py-3 font-semibold">{c.label}</th>)}{data.rows.some(row=>rowActions(module,row).length)?<th className="px-4 py-3 font-semibold">İşlem</th>:null}</tr></thead><tbody>{data.rows.map((row,index)=><tr key={String(row.id??index)} className="border-b last:border-0 hover:bg-muted/25">{config.columns.map(c=><td key={c.key} className="max-w-xs px-4 py-3"><TableValue module={module} row={row} column={c}/></td>)}{data.rows.some(item=>rowActions(module,item).length)?<td className="px-4 py-3"><RowActions module={module} row={row} onDone={resource.refetch}/></td>:null}</tr>)}</tbody></table></div><div className="flex items-center justify-between border-t px-4 py-3 text-sm"><span className="text-muted-foreground">{data.pagination.total} kayıt · Sayfa {data.pagination.page}/{data.pagination.totalPages}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page<=1} onClick={()=>setPage(p=>p-1)}><ChevronLeft className="size-4"/>Önceki</Button><Button size="sm" variant="outline" disabled={page>=data.pagination.totalPages} onClick={()=>setPage(p=>p+1)}>Sonraki<ChevronRight className="size-4"/></Button></div></div></CardContent></Card>:null}
    {data&&actions.length?<div id="erp-actions" className="grid gap-4 xl:grid-cols-2">{actions.map(action=><ActionCard key={action.id} action={action} module={module} data={data} onDone={resource.refetch}/>)}</div>:null}
  </div>;
}
