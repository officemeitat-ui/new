import { business } from "@/config/business";
import { PlaceholderBadge } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { buildAssistant } from "@/lib/voice/assistant";

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className={ok ? "text-emerald-600" : "text-amber-600"}>{ok ? "✓" : "○"}</span>
      <span>{children}</span>
    </li>
  );
}

export default async function PhoneAssistantPage() {
  await requireAdmin();
  const publicUrl = process.env.PUBLIC_URL?.replace(/\/$/, "");
  const webhookUrl = `${publicUrl ?? "https://<ihre-domain>"}/api/voice/vapi`;
  const assistant = buildAssistant({ serverUrl: webhookUrl, secret: "•••", now: new Date(), callerNumber: "+43 664 0000000 (Beispiel)" });
  const model = assistant.model as { model: string; messages: { content: string }[] };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">
          Telefon-Assistent
          <PlaceholderBadge show={business.placeholder} />
        </h1>
        <p className="text-sm text-slate-500">
          {business.assistant.name} beantwortet Anrufe für {business.name}, vereinbart Termine und notiert Rückrufwünsche. Inhalte stammen
          aus <code>config/business.ts</code>.
        </p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-semibold">Einrichtung</h2>
        <ul className="space-y-2 text-sm">
          <Check ok={Boolean(process.env.VAPI_WEBHOOK_SECRET)}>
            <code>VAPI_WEBHOOK_SECRET</code> gesetzt (Geheimnis, mit dem Vapi sich bei diesem Cockpit ausweist)
          </Check>
          <Check ok={Boolean(publicUrl?.startsWith("https://"))}>
            <code>PUBLIC_URL</code> gesetzt – Server-URL für Vapi: <code className="break-all">{webhookUrl}</code>
          </Check>
          <Check ok={Boolean(process.env.VAPI_API_KEY)}>
            <code>VAPI_API_KEY</code> gesetzt, dann einmalig <code>npm run vapi:connect</code> ausführen, um die Telefonnummer zu verbinden
          </Check>
          <Check ok={Boolean(business.assistant.transferNumber)}>
            Weiterleitung an einen Menschen (optional, <code>assistant.transferNumber</code>)
          </Check>
        </ul>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-semibold">So meldet sich der Assistent</h2>
        <p className="rounded-lg bg-brand-soft px-4 py-3 text-sm">„{assistant.firstMessage}“</p>
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-slate-500">Sprachmodell</dt>
            <dd className="font-medium">{model.model}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Stimme</dt>
            <dd className="font-medium">{(assistant.voice as { voiceId: string }).voiceId}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Spracherkennung</dt>
            <dd className="font-medium">{(assistant.transcriber as { language: string }).language}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-semibold">Anweisungen an den Assistenten (Vorschau)</h2>
        <pre className="max-h-[32rem] overflow-auto rounded-lg bg-slate-50 p-4 text-xs whitespace-pre-wrap text-slate-700">
          {model.messages[0].content}
        </pre>
      </section>
    </div>
  );
}
