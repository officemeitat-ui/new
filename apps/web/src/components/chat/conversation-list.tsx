"use client";

import { Button, cn } from "@nexus/ui";
import { MessageSquarePlus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFormatter, useNow, useTranslations } from "next-intl";

export function ConversationList({
  conversations,
}: {
  conversations: { id: string; title: string; lastMessageAt: string }[];
}) {
  const t = useTranslations("chat");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const pathname = usePathname();
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <Button asChild variant="outline" className="justify-start">
        <Link href="/chat">
          <MessageSquarePlus aria-hidden />
          {t("newConversation")}
        </Link>
      </Button>
      <nav aria-label={t("historyLabel")} className="min-h-0 flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">{t("historyEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {conversations.map((conversation) => {
              const href = `/chat/${conversation.id}`;
              const active = pathname === href;
              return (
                <li key={conversation.id}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block rounded-md px-2 py-1.5 text-sm",
                      active ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                    )}
                  >
                    <span className="block truncate">{conversation.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {format.relativeTime(
                        new Date(Math.min(Date.parse(conversation.lastMessageAt), now.getTime())),
                        now,
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    </div>
  );
}
