import Link from "next/link";
import type { ComponentProps } from "react";

const buttonVariants = {
  primary: "bg-brand text-white hover:bg-brand-dark",
  inverted: "bg-white text-brand hover:bg-slate-100",
};

export function ButtonLink({
  className = "",
  variant = "primary",
  ...props
}: ComponentProps<typeof Link> & { variant?: keyof typeof buttonVariants }) {
  return (
    <Link
      className={`inline-flex items-center justify-center rounded-lg px-6 py-3 text-base font-semibold shadow-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${buttonVariants[variant]} ${className}`}
      {...props}
    />
  );
}

/** Kennzeichnet Beispielinhalte, die vor dem Livegang ersetzt werden müssen. */
export function PlaceholderBadge({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return (
    <span className="ml-2 inline-block rounded bg-amber-100 px-1.5 py-0.5 align-middle text-xs font-medium text-amber-800">
      Platzhalter
    </span>
  );
}

export function Section({ id, className = "", children }: { id?: string; className?: string; children: React.ReactNode }) {
  return (
    <section id={id} className={`px-4 py-16 sm:py-20 ${className}`}>
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}
