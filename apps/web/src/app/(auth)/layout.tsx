import type { ReactNode } from "react";
import { BrandMark } from "@/components/shell/brand-mark";
import { resolveBranding } from "@/lib/branding";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const { productName } = await resolveBranding();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-muted/40 p-4">
      <BrandMark productName={productName} />
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
