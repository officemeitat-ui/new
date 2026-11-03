import type { ReactNode } from "react";
import { BrandMark } from "@/components/shell/brand-mark";
import { getBrand } from "@/lib/brand";

export default function AuthLayout({ children }: { children: ReactNode }) {
  const { productName } = getBrand();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-muted/40 p-4">
      <BrandMark productName={productName} />
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
