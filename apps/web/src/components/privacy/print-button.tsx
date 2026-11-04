"use client";

import { Button } from "@nexus/ui";
import { Printer } from "lucide-react";

/** Opens the print dialog – "Als PDF speichern" there gives a document to hand over. */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button variant="outline" className="print:hidden" onClick={() => window.print()}>
      <Printer aria-hidden />
      {label}
    </Button>
  );
}
