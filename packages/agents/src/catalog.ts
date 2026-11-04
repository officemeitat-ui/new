import type { ToolRisk } from "./tools";

/**
 * Tools an agent can be given in Agent Studio. `available: false` marks tools that are
 * planned (docs/ROADMAP.md): they can be configured, but the runtime only offers tools
 * that exist, so a template keeps working and gains the tool once it ships.
 */
export type CatalogTool = {
  name: string;
  risk: ToolRisk;
  available: boolean;
  /** Default approval mode for new agents, derived from the risk class (section 9.1). */
  defaultMode: "auto" | "approve" | "deny";
  /** Integration the tool needs; without it the runtime does not offer the tool. */
  requires?: "microsoft365";
  /**
   * Permission needed to approve a call, beyond approval.decide. Device actions need the same
   * right as on the Geräte page, so a member cannot approve locking a colleague's laptop.
   */
  approvalPermission?: "integration.manage";
  /** Whether an approver may change the input before approving (only where the UI supports it). */
  editable?: boolean;
};

/** Risk classes that always need a person's approval – "auto" is refused (finding 7). */
export const ALWAYS_APPROVE: ReadonlySet<ToolRisk> = new Set([
  "external_write",
  "destructive",
  "financial",
]);

export const TOOL_CATALOG: readonly CatalogTool[] = [
  { name: "aktuelle_zeit", risk: "read", available: true, defaultMode: "auto" },
  { name: "rechner", risk: "read", available: true, defaultMode: "auto" },
  { name: "reinigung_kalkulieren", risk: "read", available: true, defaultMode: "auto" },
  { name: "meldungen_abfragen", risk: "read", available: true, defaultMode: "auto" },
  { name: "wissen_suchen", risk: "read", available: true, defaultMode: "auto" },
  {
    name: "email_senden",
    risk: "external_write",
    available: true,
    defaultMode: "approve",
    editable: true,
  },
  // Microsoft Intune (MDM) via the Microsoft 365 connection – ADR 0008.
  {
    name: "geraete_suchen",
    risk: "read",
    available: true,
    defaultMode: "auto",
    requires: "microsoft365",
  },
  {
    name: "geraet_details",
    risk: "read",
    available: true,
    defaultMode: "auto",
    requires: "microsoft365",
  },
  {
    name: "geraet_synchronisieren",
    risk: "internal_write",
    available: true,
    defaultMode: "auto",
    requires: "microsoft365",
    approvalPermission: "integration.manage",
  },
  {
    name: "geraet_neu_starten",
    risk: "internal_write",
    available: true,
    defaultMode: "approve",
    requires: "microsoft365",
    approvalPermission: "integration.manage",
  },
  {
    name: "geraet_sperren",
    risk: "destructive",
    available: true,
    defaultMode: "approve",
    requires: "microsoft365",
    approvalPermission: "integration.manage",
  },
];

export function catalogTool(name: string): CatalogTool | undefined {
  return TOOL_CATALOG.find((tool) => tool.name === name);
}
