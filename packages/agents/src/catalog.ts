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
};

export const TOOL_CATALOG: readonly CatalogTool[] = [
  { name: "aktuelle_zeit", risk: "read", available: true, defaultMode: "auto" },
  { name: "rechner", risk: "read", available: true, defaultMode: "auto" },
  { name: "wissen_suchen", risk: "read", available: false, defaultMode: "auto" },
  { name: "email_senden", risk: "external_write", available: true, defaultMode: "approve" },
];

export function catalogTool(name: string): CatalogTool | undefined {
  return TOOL_CATALOG.find((tool) => tool.name === name);
}
