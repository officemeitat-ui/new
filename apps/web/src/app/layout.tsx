import { paletteToCss } from "@nexus/ui/palette";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { resolveBranding } from "@/lib/branding";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { productName } = await resolveBranding();
  return {
    title: { default: productName, template: `%s · ${productName}` },
    description: "Digitale Mitarbeiter für KMU – sicher, DSGVO-konform, in der EU betrieben.",
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0f17" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const { primaryColor } = await resolveBranding();
  // Set per request by src/proxy.ts for the Content Security Policy.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang={locale} className={GeistSans.variable} suppressHydrationWarning>
      <head>
        {/* Tenant palette generated from one brand colour, contrast-checked (packages/ui/palette). */}
        <style
          id="brand-palette"
          dangerouslySetInnerHTML={{ __html: paletteToCss(primaryColor) }}
        />
      </head>
      <body>
        <NextIntlClientProvider timeZone="Europe/Vienna">
          <ThemeProvider {...(nonce ? { nonce } : {})}>{children}</ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
