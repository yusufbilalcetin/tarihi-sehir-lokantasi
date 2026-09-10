import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { MotionPlatform } from "@/components/shared/motion-platform";
import "./globals.css";

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

/**
 * Stated rather than inferred from Next's generated types.
 *
 * `LayoutProps<"/">` only exists once `.next/types` has been written, so a
 * checkout that has never been built — a release worktree, a fresh clone, CI
 * before the build step — fails `tsc --noEmit` on this line alone. The two
 * other layouts in this application already name the prop, and this one now
 * matches them.
 */
export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    // The QR menu sets `data-sehir-intro` on <html> from a blocking script so a
    // returning guest never sees the splash again. React did not render that
    // attribute, so hydration reported a mismatch on every menu load. Marking
    // the element is the documented remedy for a pre-hydration script.
    <html
      lang="tr"
      suppressHydrationWarning
      className="h-full antialiased"
    >
      <body className="min-h-full text-foreground">
        <MotionPlatform />
        {children}
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
