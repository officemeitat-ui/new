import { after, NextResponse } from "next/server";
import { z } from "zod";
import { getFunnel } from "@/config/site";
import { scoreAnswers } from "@/lib/funnel";
import { createLead } from "@/lib/leads";
import { sendWebhook } from "@/lib/webhook";

const optionalText = (max: number) => z.string().trim().max(max).optional();

const LeadRequest = z.object({
  funnel: z.string(),
  answers: z.record(z.string(), z.string()),
  contact: z.object({
    name: z.string().trim().min(2, "Bitte Namen angeben").max(200),
    email: z.email("Bitte gültige E-Mail-Adresse angeben").max(200),
    phone: optionalText(50),
    company: optionalText(200),
    link: z.url({ protocol: /^https?$/, error: "Bitte gültigen Link angeben (https://…)" }).max(500).optional(),
    message: optionalText(2000),
  }),
  consent: z.literal(true, "Bitte der Datenverarbeitung zustimmen"),
  website: z.string().nullish(),
  source: z.record(z.string(), z.string().max(200)).optional(),
});

const SOURCE_KEYS = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid", "li_fat_id", "referrer"]);

function bookingUrl(name: string, email: string): string | null {
  const base = process.env.BOOKING_URL;
  if (!base) return null;
  try {
    const url = new URL(base);
    // Cal.com und Calendly übernehmen Name und E-Mail aus diesen Parametern.
    url.searchParams.set("name", name);
    url.searchParams.set("email", email);
    return url.toString();
  } catch {
    console.error("BOOKING_URL ist keine gültige URL");
    return null;
  }
}

export async function POST(request: Request) {
  const parsed = LeadRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ungültige Anfrage" }, { status: 400 });
  }
  const { contact, answers, website, source } = parsed.data;

  const funnel = getFunnel(parsed.data.funnel);
  if (!funnel) return NextResponse.json({ error: "Unbekannter Funnel" }, { status: 400 });

  for (const field of funnel.contactFields) {
    if (field.required && !contact[field.id]) {
      return NextResponse.json({ error: `Bitte „${field.label}“ angeben` }, { status: 400 });
    }
  }

  const score = scoreAnswers(funnel, answers);
  if (!score.ok) return NextResponse.json({ error: score.error }, { status: 400 });

  const outcome = score.qualified ? funnel.outcome.qualified : funnel.outcome.notQualified;

  // Honeypot ausgefüllt: Bot – Erfolg vortäuschen, nichts speichern.
  if (website) {
    return NextResponse.json({ qualified: false, ...funnel.outcome.notQualified, bookingUrl: null });
  }

  const allowedFields = new Set(funnel.contactFields.map((f) => f.id));
  const field = (id: keyof typeof contact) => (allowedFields.has(id) ? contact[id] : undefined);

  const lead = await createLead({
    funnel: funnel.id,
    stage: score.qualified ? funnel.stageQualified : funnel.stageNotQualified,
    name: contact.name,
    email: contact.email,
    phone: field("phone"),
    company: field("company"),
    link: field("link"),
    message: field("message"),
    answers: Object.fromEntries(funnel.questions.map((q) => [q.id, answers[q.id]])),
    score: score.score,
    qualified: score.qualified,
    source: Object.fromEntries(Object.entries(source ?? {}).filter(([key]) => SOURCE_KEYS.has(key))),
  }, `Eingang über „${funnel.title}“ (Score ${score.score}/${score.maxScore})`);

  after(() => sendWebhook({ event: "lead.created", lead }));

  return NextResponse.json({
    qualified: score.qualified,
    ...outcome,
    bookingUrl: score.qualified && funnel.showBooking ? bookingUrl(lead.name, lead.email) : null,
  });
}
