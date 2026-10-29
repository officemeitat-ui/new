import { z } from "zod";

// Strukturierte Ausgaben der KI-Funktionen. Die Schemas dienen zugleich als
// Output-Format für Claude und zur Validierung beim Lesen aus der Datenbank.

export const BriefingSchema = z.object({
  summary: z.string().describe("2–3 Sätze: Wer ist der Interessent, was ist die Ausgangslage?"),
  hypotheses: z.array(z.string()).describe("Vermutete Kernprobleme bzw. Motivation"),
  questions: z.array(z.string()).describe("Konkrete Fragen für das Gespräch"),
  risks: z.array(z.string()).describe("Mögliche Einwände oder Ausschlussgründe"),
});
export type Briefing = z.infer<typeof BriefingSchema>;

export const FollowUpSchema = z.object({
  summary: z.string().describe("Kurze Zusammenfassung des Gesprächs"),
  nextSteps: z.array(z.string()).describe("Vereinbarte bzw. empfohlene nächste Schritte"),
  suggestedStage: z.string().describe("ID der empfohlenen Pipeline-Stufe"),
  emailSubject: z.string(),
  emailBody: z.string().describe("Follow-up-E-Mail an den Interessenten, ohne Betreffzeile"),
});
export type FollowUp = z.infer<typeof FollowUpSchema>;
