import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { site } from "@/config/site";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: `${site.brand.name} – ${site.brand.claim}`, template: `%s · ${site.brand.name}` },
  description: site.hero.subtitle,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className="min-h-screen antialiased" style={{ "--brand": site.brand.color } as CSSProperties}>
        {children}
      </body>
    </html>
  );
}
