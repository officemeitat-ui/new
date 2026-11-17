import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { runAssistant } from "@/lib/workspace/assistant";

// KI-Assistent des Arbeitsplatzes. Der Verlauf liegt auf dem Gerät und kommt bei jeder Anfrage mit.
export const maxDuration = 120;

const Body = z.object({
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(8000) }))
    .min(1)
    .max(40),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || new URL(origin).host !== host) return NextResponse.json({ error: "Ungültige Herkunft" }, { status: 403 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  return NextResponse.json(await runAssistant(parsed.data.history, new Date(), { id: user.id, name: user.name, role: user.role }));
}
