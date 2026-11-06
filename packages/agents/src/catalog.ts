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
  /** Never "auto", whatever its risk class (security review 2, finding 4). */
  alwaysApprove?: boolean;
  /**
   * The person a run acts for must have this permission, or the agent is not offered the tool
   * (security review 2, finding 8): an agent never sees more than the person could see.
   */
  userPermission?: "integration.manage" | "reports.manage";
};

/** Risk classes that always need a person's approval – "auto" is refused (finding 7). */
export const ALWAYS_APPROVE: ReadonlySet<ToolRisk> = new Set([
  "external_write",
  "destructive",
  "financial",
]);

/** Whether a tool needs a person's approval for every call, regardless of the agent's config. */
export function mustApprove(
  tool: { risk: ToolRisk; alwaysApprove?: boolean } | undefined,
): boolean {
  return Boolean(tool && (ALWAYS_APPROVE.has(tool.risk) || tool.alwaysApprove));
}

export const TOOL_CATALOG: readonly CatalogTool[] = [
  { name: "aktuelle_zeit", risk: "read", available: true, defaultMode: "auto" },
  { name: "rechner", risk: "read", available: true, defaultMode: "auto" },
  { name: "reinigung_kalkulieren", risk: "read", available: true, defaultMode: "auto" },
  {
    name: "meldungen_abfragen",
    risk: "read",
    available: true,
    defaultMode: "auto",
    userPermission: "reports.manage",
  },
  { name: "wissen_suchen", risk: "read", available: true, defaultMode: "auto" },
  // Only a proposal: it becomes searchable once a person confirms it (ADR 0011).
  { name: "wissen_merken", risk: "internal_write", available: true, defaultMode: "auto" },
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
    userPermission: "integration.manage",
  },
  {
    name: "geraet_details",
    risk: "read",
    available: true,
    defaultMode: "auto",
    requires: "microsoft365",
    userPermission: "integration.manage",
  },
  {
    name: "geraet_synchronisieren",
    risk: "internal_write",
    available: true,
    defaultMode: "auto",
    requires: "microsoft365",
    userPermission: "integration.manage",
    approvalPermission: "integration.manage",
  },
  {
    name: "geraet_neu_starten",
    risk: "internal_write",
    available: true,
    defaultMode: "approve",
    alwaysApprove: true,
    requires: "microsoft365",
    userPermission: "integration.manage",
    approvalPermission: "integration.manage",
  },
  {
    name: "geraet_sperren",
    risk: "destructive",
    available: true,
    defaultMode: "approve",
    requires: "microsoft365",
    userPermission: "integration.manage",
    approvalPermission: "integration.manage",
  },
];

export function catalogTool(name: string): CatalogTool | undefined {
  return TOOL_CATALOG.find((tool) => tool.name === name);
}
