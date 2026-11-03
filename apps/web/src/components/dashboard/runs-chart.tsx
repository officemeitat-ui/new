"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

/**
 * Runs per day, last 7 days. One series: no legend, the card title names it. Thin bars with
 * rounded data ends on the baseline, a hover tooltip per bar and a table for screen readers.
 */
export function RunsChart({ data }: { data: { day: string; runs: number }[] }) {
  const t = useTranslations("start");
  const format = useFormatter();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.runs));
  const label = (day: string) => format.dateTime(new Date(`${day}T12:00:00`), { weekday: "short" });
  const full = (day: string) =>
    format.dateTime(new Date(`${day}T12:00:00`), {
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
    });

  return (
    <div>
      <div className="relative flex h-36 items-end gap-0.5 border-b border-border" aria-hidden>
        {data.map((d, index) => (
          <div
            key={d.day}
            className="group relative flex h-full flex-1 items-end justify-center px-1.5"
            onMouseEnter={() => setHover(index)}
            onMouseLeave={() => setHover(null)}
          >
            <div
              className="w-full max-w-10 rounded-t bg-primary transition-opacity"
              style={{
                height: `${(d.runs / max) * 100}%`,
                minHeight: d.runs > 0 ? 4 : 0,
                opacity: hover === null || hover === index ? 1 : 0.45,
              }}
            />
            {hover === index ? (
              <div className="pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md border bg-card px-2 py-1 text-xs shadow-md">
                <span className="text-muted-foreground">{full(d.day)}: </span>
                <span className="font-medium">{t("chartRuns", { count: d.runs })}</span>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-0.5 text-center text-xs text-muted-foreground" aria-hidden>
        {data.map((d) => (
          <span key={d.day} className="flex-1">
            {label(d.day)}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{t("chartTitle")}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}>
              <th scope="row">{full(d.day)}</th>
              <td>{t("chartRuns", { count: d.runs })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
