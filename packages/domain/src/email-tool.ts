import { defineTool } from "@nexus/agents";
import { getEnv } from "@nexus/core/env";
import { z } from "zod";
import { sendRawMail } from "./mail";

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const MAX_RECIPIENTS = 5;

/**
 * "E-Mail senden" for agents (risk: external_write). Agents should have it in approval mode;
 * the mail is marked as AI-assisted and approved (EU AI Act, Art. 50).
 * The schema stays simple because tools are sent with strict: true; limits are checked here.
 */
export function createEmailTool(context: { tenantName: string }) {
  return defineTool({
    name: "email_senden",
    description:
      "Sendet eine E-Mail im Namen der Firma. Nutzen Sie es erst, wenn Empfänger, Betreff und Text vollständig sind; ein Mensch prüft und gibt die E-Mail vor dem Versand frei. Schreiben Sie den Text als fertige E-Mail mit Anrede und Grußformel.",
    risk: "external_write",
    input: z.object({
      an: z.array(z.string()).describe("E-Mail-Adressen der Empfänger (höchstens 5)"),
      betreff: z.string().describe("Betreffzeile"),
      text: z.string().describe("Inhalt als Klartext"),
    }),
    run: async ({ an, betreff, text }, ctx) => {
      const recipients = [...new Set(an.map((a) => a.trim().toLowerCase()))];
      if (recipients.length === 0 || recipients.length > MAX_RECIPIENTS) {
        throw new Error(`Bitte 1 bis ${MAX_RECIPIENTS} Empfänger angeben.`);
      }
      const invalid = recipients.filter((r) => !EMAIL.test(r));
      if (invalid.length > 0) throw new Error(`Ungültige Adresse: ${invalid.join(", ")}`);
      if (!betreff.trim() || !text.trim())
        throw new Error("Betreff und Text dürfen nicht leer sein.");

      const footer = `\n\n--\nDiese E-Mail wurde mit KI-Unterstützung erstellt und vor dem Versand von einer Person bei ${context.tenantName} freigegeben.`;
      const messageId = await sendRawMail({
        fromName: `${context.tenantName} via ${getEnv().BRAND_PRODUCT_NAME}`,
        to: recipients,
        subject: betreff.trim().slice(0, 200),
        text: text.trim() + footer,
        // Same tool call → same Message-ID, so receivers can drop accidental duplicates.
        messageId: `<${ctx.idempotencyKey.replace(/[^a-zA-Z0-9.-]/g, "-")}@nexus>`,
      });
      return { gesendet: true, an: recipients, betreff, messageId };
    },
  });
}
