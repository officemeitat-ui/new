"use client";

import { Button } from "@nexus/ui";
import { Check, Hammer } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { updateReportAction } from "@/app/(app)/reports/actions";
import { useReportFeedback } from "./report-feedback";

export function ReportActions({ reportId, status }: { reportId: string; status: string }) {
  const t = useTranslations("reports");
  const [pending, start] = useTransition();
  const show = useReportFeedback();
  const run = (next: "in_progress" | "done") =>
    start(async () => {
      const note = next === "done" ? window.prompt(t("notePrompt")) : null;
      if (next === "done" && note === null) return;
      const result = await updateReportAction({ reportId, status: next, note });
      show(
        result.ok ? { ok: true, text: result.message ?? "" } : { ok: false, text: result.error },
      );
    });
  return (
    <div className="flex gap-1">
      {status === "open" ? (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run("in_progress")}>
          <Hammer aria-hidden />
          {t("start")}
        </Button>
      ) : null}
      <Button size="sm" disabled={pending} onClick={() => run("done")}>
        <Check aria-hidden />
        {t("done")}
      </Button>
    </div>
  );
}
