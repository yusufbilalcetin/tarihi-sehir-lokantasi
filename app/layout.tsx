import type { Metadata, Viewport } from "next";
import { Lora, Manrope } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { MotionPlatform } from "@/components/shared/motion-platform";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Tarihi Şehir Lokantası",
    template: "%s | Tarihi Şehir Lokantası",
  },
  description: "Tarihi Şehir Lokantası QR menü ve restoran yönetim prototipi.",
  applicationName: "Tarihi Şehir Lokantası",
  appleWebApp: { capable: true, title: "Şehir Lokantası", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#30382D",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The QR menu sets `data-sehir-intro` on <html> from a blocking script so a
    // returning guest never sees the splash again. React did not render that
    // attribute, so hydration reported a mismatch on every menu load. Marking
    // the element is the documented remedy for a pre-hydration script.
    <html
      lang="tr"
      suppressHydrationWarning
      className={`${manrope.variable} ${lora.variable} h-full antialiased`}
    >
      <body className="min-h-full text-foreground">
        <MotionPlatform />
        {children}
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
