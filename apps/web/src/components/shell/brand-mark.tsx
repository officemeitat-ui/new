import { Sparkles } from "lucide-react";
import Link from "next/link";

export function BrandMark({
  productName,
  compact = false,
}: {
  productName: string;
  /** Show only the logo on small screens. */
  compact?: boolean;
}) {
  return (
    <Link
      href="/"
      aria-label={productName}
      className="flex shrink-0 items-center gap-2 font-semibold tracking-tight"
    >
      <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Sparkles className="size-4" aria-hidden />
      </span>
      <span className={compact ? "hidden sm:inline" : undefined}>{productName}</span>
    </Link>
  );
}
