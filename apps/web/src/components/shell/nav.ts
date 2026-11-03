import {
  BookOpen,
  Bot,
  Building2,
  ChartLine,
  House,
  Inbox,
  MessagesSquare,
  Plug,
  Settings,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export type NavKey =
  | "start"
  | "chat"
  | "agents"
  | "workflows"
  | "approvals"
  | "knowledge"
  | "integrations"
  | "analytics"
  | "settings"
  | "partner";

export type NavItem = {
  key: NavKey;
  href: string;
  icon: LucideIcon;
  /** Areas from later phases are shown but disabled until they ship (docs/ROADMAP.md). */
  available: boolean;
  section: "main" | "admin";
  /** Only shown to partner staff (ME-IT). */
  partnerOnly?: boolean;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "start", href: "/", icon: House, available: true, section: "main" },
  { key: "chat", href: "/chat", icon: MessagesSquare, available: false, section: "main" },
  { key: "agents", href: "/agents", icon: Bot, available: false, section: "main" },
  { key: "workflows", href: "/workflows", icon: Workflow, available: false, section: "main" },
  { key: "approvals", href: "/approvals", icon: Inbox, available: false, section: "main" },
  { key: "knowledge", href: "/knowledge", icon: BookOpen, available: false, section: "main" },
  { key: "integrations", href: "/integrations", icon: Plug, available: false, section: "main" },
  { key: "analytics", href: "/analytics", icon: ChartLine, available: false, section: "main" },
  { key: "settings", href: "/settings", icon: Settings, available: true, section: "admin" },
  {
    key: "partner",
    href: "/partner",
    icon: Building2,
    available: true,
    section: "admin",
    partnerOnly: true,
  },
];

export function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function visibleNavItems(isPartner: boolean): readonly NavItem[] {
  return NAV_ITEMS.filter((item) => !item.partnerOnly || isPartner);
}
