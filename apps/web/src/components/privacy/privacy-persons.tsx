"use client";

import { Button } from "@nexus/ui";
import { Download, UserX } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { erasePersonAction } from "@/app/(app)/settings/privacy/actions";

type Person = { userId: string; name: string; email: string; isSelf: boolean };

/**
 * Export and erasure per person. Confirmations stay visible after the list refreshes and the
 * erased person drops out of it.
 */
export function PrivacyPersons({ persons }: { persons: Person[] }) {
  const t = useTranslations("privacy");
  const [done, setDone] = useState<{ userId: string; text: string }[]>([]);
  const [error, setError] = useState<{ userId: string; text: string } | null>(null);
  const [pending, start] = useTransition();
  const erased = new Set(done.map((d) => d.userId));

  function erase(person: Person) {
    const typed = window.prompt(t("eraseConfirm", { name: person.name }));
    if (typed === null) return;
    if (typed.trim() !== person.name.trim()) {
      setError({ userId: person.userId, text: t("eraseMismatch") });
      return;
    }
    start(async () => {
      const response = await erasePersonAction(person.userId);
      if (response.ok) {
        setDone((list) => [{ userId: person.userId, text: response.message ?? "" }, ...list]);
        setError(null);
      } else {
        setError({ userId: person.userId, text: response.error });
      }
    });
  }

  return (
    <ul className="divide-y">
      {done.map((entry) => (
        <li key={entry.userId} className="px-5 py-3">
          <p role="status" className="text-sm text-success">
            {entry.text}
          </p>
        </li>
      ))}
      {persons
        .filter((person) => !erased.has(person.userId))
        .map((person) => (
          <li
            key={person.userId}
            data-testid="privacy-person"
            className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium">{person.name}</p>
              <p className="text-xs text-muted-foreground">{person.email}</p>
              {error?.userId === person.userId ? (
                <p role="alert" className="text-xs text-danger">
                  {error.text}
                </p>
              ) : null}
            </div>
            <Button asChild size="sm" variant="outline">
              <a href={`/api/privacy/export?userId=${person.userId}`} download>
                <Download aria-hidden />
                {t("export")}
              </a>
            </Button>
            {!person.isSelf ? (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => erase(person)}>
                <UserX aria-hidden />
                {t("erase")}
              </Button>
            ) : null}
          </li>
        ))}
    </ul>
  );
}
