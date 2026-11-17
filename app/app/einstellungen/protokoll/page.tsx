import { workspace } from "@/config/workspace";
import { requireOwner } from "@/lib/auth";
import { listAudit } from "@/lib/users";

/** Wer hat wann was gemacht: Anmeldungen, Tresor, Exporte, Benutzerverwaltung. */
export default async function ProtokollPage() {
  await requireOwner();
  const entries = await listAudit(300);
  const when = (iso: string) =>
    new Intl.DateTimeFormat("de-AT", { dateStyle: "short", timeStyle: "medium", timeZone: workspace.timeZone }).format(new Date(iso));
  return (
    <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-slate-500">
          <tr>
            <th className="px-3 py-2">Zeit</th>
            <th className="px-3 py-2">Wer</th>
            <th className="px-3 py-2">Aktion</th>
            <th className="px-3 py-2">Details</th>
            <th className="px-3 py-2">IP</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {entries.map((e) => (
            <tr key={e.id} className={/fehlgeschlagen|abgelehnt|falsch/.test(e.action) ? "bg-red-50/50" : ""}>
              <td className="px-3 py-2 whitespace-nowrap text-slate-500">{when(e.at)}</td>
              <td className="px-3 py-2">{e.userName ?? "–"}</td>
              <td className="px-3 py-2 font-medium">{e.action}</td>
              <td className="px-3 py-2 text-slate-600">{e.detail ?? ""}</td>
              <td className="px-3 py-2 text-slate-500">{e.ip ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {entries.length === 0 && <p className="p-4 text-sm text-slate-500">Noch keine Einträge.</p>}
    </div>
  );
}
