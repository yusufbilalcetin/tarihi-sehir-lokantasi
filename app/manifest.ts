import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tarihi Şehir Lokantası",
    short_name: "Şehir Lokantası",
    description: "QR menü ve restoran operasyon uygulaması",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#120C08",
    theme_color: "#30382D",
    lang: "tr",
    categories: ["food", "business"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "QR Menü", short_name: "Menü", url: "/menu/demo-table" },
      { name: "Garson Paneli", short_name: "Garson", url: "/staff/dashboard" },
      { name: "Mutfak", short_name: "Mutfak", url: "/kitchen" },
    ],
  };
}
