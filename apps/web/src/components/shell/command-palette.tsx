"use client";

import { Kbd } from "@nexus/ui";
import { Command } from "cmdk";
import { Languages, Monitor, Moon, Search, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useEffect, useState, useTransition } from "react";
import { setLocale } from "@/app/actions/locale";
import { NAV_ITEMS } from "./nav";

const itemClass =
  "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground [&_svg]:size-4 [&_svg]:text-muted-foreground";
const groupClass =
  "px-2 py-1.5 [&_[cmdk-group-heading]]:px-1 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground";

export function CommandPalette() {
  const t = useTranslations("commandPalette");
  const tNav = useTranslations("nav");
  const router = useRouter();
  const { setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function run(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("open")}
        className="flex h-9 w-full min-w-0 max-w-sm items-center gap-2 rounded-md border bg-muted/50 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
      >
        <Search className="size-4" aria-hidden />
        <span className="flex-1 truncate text-left">{t("searchButton")}</span>
        <span className="hidden items-center gap-1 sm:flex">
          <Kbd>Strg</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <Command.Dialog
        open={open}
        onOpenChange={setOpen}
        label={t("title")}
        overlayClassName="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
        contentClassName="fixed left-1/2 top-[15vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border bg-card shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b px-4">
          <Search className="size-4 text-muted-foreground" aria-hidden />
          <Command.Input
            placeholder={t("placeholder")}
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <Command.List className="max-h-80 overflow-y-auto p-1">
          <Command.Empty className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t("empty")}
          </Command.Empty>
          <Command.Group heading={t("navigation")} className={groupClass}>
            {NAV_ITEMS.filter((item) => item.available).map((item) => {
              const Icon = item.icon;
              return (
                <Command.Item
                  key={item.key}
                  value={tNav(item.key)}
                  onSelect={() => run(() => router.push(item.href))}
                  className={itemClass}
                >
                  <Icon aria-hidden />
                  {tNav(item.key)}
                </Command.Item>
              );
            })}
          </Command.Group>
          <Command.Group heading={t("preferences")} className={groupClass}>
            <Command.Item onSelect={() => run(() => setTheme("light"))} className={itemClass}>
              <Sun aria-hidden />
              {t("themeLight")}
            </Command.Item>
            <Command.Item onSelect={() => run(() => setTheme("dark"))} className={itemClass}>
              <Moon aria-hidden />
              {t("themeDark")}
            </Command.Item>
            <Command.Item onSelect={() => run(() => setTheme("system"))} className={itemClass}>
              <Monitor aria-hidden />
              {t("themeSystem")}
            </Command.Item>
            <Command.Item
              onSelect={() => run(() => startTransition(() => setLocale("de-AT")))}
              className={itemClass}
            >
              <Languages aria-hidden />
              {t("languageDe")}
            </Command.Item>
            <Command.Item
              onSelect={() => run(() => startTransition(() => setLocale("en")))}
              className={itemClass}
            >
              <Languages aria-hidden />
              {t("languageEn")}
            </Command.Item>
          </Command.Group>
        </Command.List>
      </Command.Dialog>
    </>
  );
}
