import { catalogTool, type CatalogTool } from "@nexus/agents/catalog";
import { isModelTier, modelDisplayName, resolveModel } from "@nexus/agents/models";
import { getEnv } from "@nexus/core/env";
import type { Tx } from "@nexus/db";
import type { AgentConfig } from "@nexus/db/schema";
import { listAgents } from "./agents";
import { getIntegration } from "./integrations";
import { listCollections } from "./knowledge";
import { getPrivacySettings } from "./privacy";

/* ------------------------------------------------------------ subprocessors */

export type Subprocessor = {
  name: string;
  purpose: string;
  location: string;
  /** Points that must be confirmed in the contract before go-live. */
  note: string | null;
};

/**
 * Subprocessors of this installation, derived from its configuration (M13). Entries that the
 * configuration cannot know are marked as open instead of being guessed.
 */
/** The provider of the AI models, depending on LLM_PROVIDER. */
export function llmProcessor(): Subprocessor {
  const env = getEnv();
  return env.LLM_PROVIDER === "bedrock"
    ? {
        name: "Amazon Web Services EMEA SARL (Amazon Bedrock)",
        purpose: "KI-Modelle (Claude) für Chat und Agenten",
        location: `AWS-Region ${env.AWS_REGION}`,
        note: null,
      }
    : env.LLM_PROVIDER === "vertex"
      ? {
          name: "Google Cloud EMEA Limited (Vertex AI)",
          purpose: "KI-Modelle (Claude) für Chat und Agenten",
          location: `Google-Cloud-Region ${env.GOOGLE_VERTEX_REGION}`,
          note: null,
        }
      : {
          name: "Anthropic, PBC (Claude API)",
          purpose: "KI-Modelle (Claude) für Chat und Agenten",
          location: "USA",
          note: "Drittlandübermittlung: Rechtsgrundlage (z. B. Standardvertragsklauseln) laut Vertrag mit dem Anbieter vor Go-live prüfen. Für reine EU-Verarbeitung Bedrock (EU-Region) oder Vertex (eu) wählen.",
        };
}

export function listSubprocessors(): Subprocessor[] {
  const env = getEnv();
  return [
    {
      name: env.HOSTING_DESCRIPTION ?? "Hosting-Anbieter",
      purpose: "Betrieb der Plattform, Datenbank, Dateiablage und Backups",
      location: env.HOSTING_DESCRIPTION ? "siehe Anbieter" : "noch nicht eingetragen",
      note: env.HOSTING_DESCRIPTION
        ? null
        : "Noch nicht konfiguriert (HOSTING_DESCRIPTION). ME-IT trägt Anbieter und Standort im AVV ein.",
    },
    llmProcessor(),
    {
      name: `E-Mail-Versand über ${env.SMTP_HOST}`,
      purpose: "Einladungen, Anmeldelinks und freigegebene E-Mails von Agenten",
      location: "laut Vertrag mit dem Mail-Anbieter",
      note: "Betreiber und Standort des SMTP-Dienstes im AVV ergänzen.",
    },
  ];
}

/* ------------------------------------------------------------ agent profile */

export type AgentRisk = { level: "info" | "warning" | "danger"; text: string };

const RISK_TEXT: Record<CatalogTool["risk"], string> = {
  read: "liest Daten",
  internal_write: "ändert Daten in verbundenen Systemen",
  external_write: "sendet Daten an Dritte außerhalb der Firma",
  destructive: "greift in Geräte oder Daten ein (z. B. sperren)",
  financial: "löst Zahlungen oder finanzielle Vorgänge aus",
};

/**
 * Agent profile (Agenten-Steckbrief, EU AI Act, M13): what the agent is for, which model and
 * data it uses, what it may do on its own and where a person decides. Generated from the
 * current configuration, so it can never drift from what actually runs.
 */
export function agentProfile(input: {
  config: AgentConfig;
  collections: { id: string; name: string }[];
  chatRetentionDays: number | null;
  microsoftConnected: boolean;
  /** Display name of a tool (translations live in the web app). */
  label?: (toolName: string) => string;
}) {
  const label = input.label ?? ((name: string) => name);
  const { config } = input;
  const tools = config.tools
    .filter((tool) => tool.mode !== "deny")
    .map((tool) => {
      const catalog = catalogTool(tool.name);
      return {
        name: tool.name,
        mode: tool.mode,
        risk: catalog?.risk ?? "read",
        riskText: RISK_TEXT[catalog?.risk ?? "read"],
        unavailable: catalog?.requires === "microsoft365" && !input.microsoftConnected,
      };
    });
  const knowledge = tools.some((tool) => tool.name === "wissen_suchen")
    ? config.knowledgeCollectionIds?.length
      ? input.collections
          .filter((c) => config.knowledgeCollectionIds!.includes(c.id))
          .map((c) => c.name)
      : input.collections.map((c) => c.name)
    : [];

  const risks: AgentRisk[] = [];
  for (const tool of tools) {
    if (tool.risk === "read" || tool.unavailable) continue;
    risks.push(
      tool.mode === "approve"
        ? {
            level: "info",
            text: `${label(tool.name)}: ${tool.riskText} – nur nach Freigabe durch eine Person.`,
          }
        : {
            level: tool.risk === "internal_write" ? "warning" : "danger",
            text: `${label(tool.name)}: ${tool.riskText} – ohne Freigabe.`,
          },
    );
  }
  risks.push({
    level: "info",
    text: "KI-Antworten können fehlerhaft sein; der Chat weist darauf hin, E-Mails an Dritte tragen eine KI-Kennzeichnung (Art. 50 KI-VO).",
  });

  return {
    model: modelDisplayName(resolveModel(isModelTier(config.tier) ? config.tier : "smart")),
    tier: config.tier,
    provider: llmProcessor(),
    tools,
    knowledge,
    limits: {
      maxSteps: config.maxSteps,
      maxCostUsdMicros: config.maxCostUsdMicros ?? null,
    },
    oversight: tools.filter((tool) => tool.mode === "approve").map((tool) => tool.name),
    logging: {
      chatRetentionDays: input.chatRetentionDays,
    },
    risks,
  };
}

/* ------------------------------------------------- processing register (Art. 30) */

/**
 * Data for the record of processing activities (Art. 30 DSGVO) of a tenant: one entry per
 * processing activity, including one per active agent. A template the controller completes.
 */
export async function getProcessingRegister(tx: Tx, tenantId: string) {
  const [agentList, collections, settings, microsoft] = [
    await listAgents(tx, tenantId),
    await listCollections(tx, tenantId),
    await getPrivacySettings(tx, tenantId),
    await getIntegration(tx, tenantId, "microsoft365"),
  ];
  const keep = (days: number | null) => (days ? `${days} Tage` : "bis zur manuellen Löschung");
  const llm = llmProcessor();

  const activities = [
    {
      title: "Benutzerkonten und Zugriffsverwaltung",
      purpose: "Anmeldung, Rechteverwaltung und Absicherung der Plattform",
      legalBasis: "Art. 6 Abs. 1 lit. b und f DSGVO",
      subjects: "Mitarbeitende des Verantwortlichen",
      data: "Name, E-Mail-Adresse, Rolle, Anmeldedaten (Passwort-Hash, 2FA), Sitzungen mit IP-Adresse und Browser",
      recipients: "Hosting-Anbieter",
      retention: "bis zur Löschung des Kontos",
    },
    {
      title: "Audit-Log",
      purpose: "Nachweis sicherheits- und datenschutzrelevanter Vorgänge (Rechenschaftspflicht)",
      legalBasis: "Art. 6 Abs. 1 lit. c und f, Art. 5 Abs. 2 DSGVO",
      subjects: "Mitarbeitende, ME-IT-Support",
      data: "Personen-ID, Aktion, Zeitpunkt, IP-Adresse, Browser",
      recipients: "Hosting-Anbieter",
      retention: "unveränderlich bis zur Löschung der Firma (Hash-Kette)",
    },
    ...agentList.map((agent) => ({
      title: `KI-Agent „${agent.name}“`,
      purpose: agent.description ?? "Unterstützung der Mitarbeitenden durch einen KI-Agenten",
      legalBasis: "Art. 6 Abs. 1 lit. b oder f DSGVO (vom Verantwortlichen festzulegen)",
      subjects:
        "Mitarbeitende; Personen, deren Daten in Anfragen, E-Mails oder Dokumenten vorkommen",
      data:
        "Inhalte der Gespräche, Ergebnisse der Werkzeuge" +
        (agent.config.tools.some((t) => t.name === "email_senden" && t.mode !== "deny")
          ? ", E-Mail-Adressen von Empfängern"
          : "") +
        (agent.config.tools.some((t) => t.name.startsWith("geraet") && t.mode !== "deny")
          ? ", Gerätedaten aus Intune (Gerätename, Benutzer, Status)"
          : ""),
      recipients: [
        llm.name,
        ...(agent.config.tools.some((t) => t.name === "email_senden" && t.mode !== "deny")
          ? ["Empfänger freigegebener E-Mails"]
          : []),
      ].join(", "),
      retention: keep(settings.chatRetentionDays),
    })),
    {
      title: "Wissensdatenbank",
      purpose: "Antworten der Agenten auf Basis firmeneigener Dokumente",
      legalBasis: "Art. 6 Abs. 1 lit. f DSGVO",
      subjects: "Personen, die in den Dokumenten genannt sind",
      data: collections.length
        ? `Inhalte von ${collections.length} Sammlung(en): ${collections.map((c) => c.name).join(", ")}`
        : "keine Dokumente",
      recipients: `${llm.name} (nur gefundene Textstellen)`,
      retention: keep(settings.documentRetentionDays),
    },
    ...(microsoft
      ? [
          {
            title: "Geräteverwaltung (Microsoft Intune)",
            purpose: "Überblick und Wartung der Firmengeräte",
            legalBasis: "Art. 6 Abs. 1 lit. b und f DSGVO",
            subjects: "Mitarbeitende mit verwalteten Geräten",
            data: "Gerätename, Modell, Seriennummer, Betriebssystem, zugeordnete Person (Name, E-Mail), Status",
            recipients:
              "Microsoft (Intune des Verantwortlichen); Daten werden nur abgefragt, nicht gespeichert",
            retention: "keine Speicherung in der Plattform (Aktionen im Audit-Log)",
          },
        ]
      : []),
  ];
  return { activities, subprocessors: listSubprocessors() };
}
