import type { Metadata } from "next";

import { GuestOrderExperience } from "@/components/guest/guest-order-experience";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Paket ve Kurye Siparişi",
  description: "Tarihi Şehir Lokantası'ndan paket veya kurye siparişi verin.",
};

/**
 * The public ordering door. The slug is a lookup key the server resolves into
 * a restaurant and a signed session; nothing about the tenant is decided here.
 */
export default async function GuestOrderPage({
  params,
}: {
  params: Promise<{ restaurantSlug: string }>;
}) {
  const { restaurantSlug } = await params;
  return <GuestOrderExperience restaurantSlug={restaurantSlug} />;
}
