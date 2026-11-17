"use client";

import { useMemo, useState, useTransition } from "react";
import { saveNetworkModel } from "@/app/app/doku-actions";
import { NetworkPlan } from "@/components/workspace/NetworkPlan";
import { searchCatalog } from "@/lib/network/catalog";
import { checkNetwork, firewallOf, tracePath } from "@/lib/network/check";
import { parseCidr } from "@/lib/network/ip";
import {
  DEVICE_KINDS,
  MEDIA,
  newId,
  type DeviceKind,
  type Medium,
  type NetDevice,
  type NetLink,
  type NetNetwork,
  type NetworkModel,
} from "@/lib/network/model";

const input = "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-base md:text-sm focus:border-brand focus:outline-none";
const label = "text-xs text-slate-500";

type AteraDevice = { name: string; os: string | null };
type Tab = "plan" | "netze" | "geraete" | "verbindungen";

const LEVEL_STYLE = {
  fehler: "bg-red-50 text-red-800 ring-red-200",
  warnung: "bg-amber-50 text-amber-900 ring-amber-200",
  info: "bg-sky-50 text-sky-900 ring-sky-200",
};

export function NetworkEditor({
  customerId,
  initial,
  ateraDevices,
}: {
  customerId: string;
  initial: NetworkModel;
  ateraDevices: AteraDevice[];
}) {
  const [model, setModel] = useState<NetworkModel>(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [tab, setTab] = useState<Tab>(initial.devices.length ? "plan" : "netze");
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const [pending, startTransition] = useTransition();
  const [focus, setFocus] = useState<string[]>([]);
  const [trace, setTrace] = useState<{ from: string; to: string }>({ from: "", to: "internet" });

  const findings = useMemo(() => checkNetwork(model), [model]);
  const errors = findings.filter((f) => f.level === "fehler").length;
  const warnings = findings.filter((f) => f.level === "warnung").length;
  const traceResult = useMemo(() => (trace.from ? tracePath(model, trace.from, trace.to) : null), [model, trace]);
  const dirty = JSON.stringify(model) !== saved;
  const update = (change: (m: NetworkModel) => NetworkModel) => {
    setModel((m) => change(structuredClone(m)));
    setStatus({});
  };

  const save = () =>
    startTransition(async () => {
      const result = await saveNetworkModel(customerId, model);
      if (result.ok) setSaved(JSON.stringify(model));
      setStatus(result);
    });

  const wan = model.wan;
  const wanLabel =
    wan.mode === "statisch"
      ? [wan.ip && `${wan.ip}/${wan.prefix ?? "?"}`, wan.provider].filter(Boolean).join(" · ")
      : wan.mode === "pppoe"
        ? "PPPoE"
        : "DHCP";

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/95 px-4 py-2 backdrop-blur md:static md:mx-0 md:rounded-xl md:border-0 md:bg-white md:ring-1 md:ring-slate-200">
        <span
          className={`rounded-full px-2.5 py-1 text-sm font-semibold ${errors ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}
        >
          {errors ? `${errors} Fehler` : "Keine Fehler"}
        </span>
        {warnings > 0 && (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-sm font-semibold text-amber-800">
            {warnings} {warnings === 1 ? "Hinweis" : "Hinweise"}
          </span>
        )}
        <span className="flex-1" />
        {status.error && <span className="text-sm text-red-700">{status.error}</span>}
        {status.message && !dirty && <span className="text-sm text-emerald-700">{status.message}</span>}
        {dirty && (
          <button type="button" onClick={() => setModel(JSON.parse(saved))} className="text-sm text-slate-500 hover:text-slate-900">
            Verwerfen
          </button>
        )}
        <button
          type="button"
          onClick={save}
          disabled={!dirty || pending}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {pending ? "Speichert …" : dirty ? "Speichern" : "Gespeichert"}
        </button>
      </div>

      <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 text-sm font-medium">
        {(
          [
            ["plan", "Plan & Prüfung"],
            ["netze", "Internet & Netze"],
            ["geraete", `Geräte ${model.devices.length}`],
            ["verbindungen", `Verbindungen ${model.links.length}`],
          ] as [Tab, string][]
        ).map(([id, text]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-full px-3 py-1.5 whitespace-nowrap ${tab === id ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}
          >
            {text}
          </button>
        ))}
      </nav>

      {tab === "plan" && (
        <div className="space-y-4">
          <NetworkPlan
            model={model}
            findings={findings}
            wanLabel={wanLabel}
            highlightLinks={traceResult?.linkIds ?? []}
            highlightDevices={focus.length ? focus : (traceResult?.hops.map((h) => h.deviceId) ?? [])}
            onSelect={(id) => setTrace((t) => ({ ...t, from: id }))}
          />

          <section className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
            <h3 className="font-semibold">Weg testen (wie ein Ping)</h3>
            <p className="text-sm text-slate-500">Gerät antippen oder auswählen – der Plan zeigt den Weg und wo es scheitert.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <select value={trace.from} onChange={(e) => setTrace({ ...trace, from: e.target.value })} className={input} aria-label="Von">
                <option value="">Von …</option>
                {model.devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <select value={trace.to} onChange={(e) => setTrace({ ...trace, to: e.target.value })} className={input} aria-label="Nach">
                <option value="internet">Internet</option>
                {model.devices
                  .filter((d) => d.id !== trace.from)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
            </div>
            {traceResult && (
              <div
                className={`mt-3 rounded-lg px-3 py-2 text-sm ring-1 ${traceResult.ok ? "bg-emerald-50 text-emerald-900 ring-emerald-200" : "bg-red-50 text-red-800 ring-red-200"}`}
              >
                <p className="font-semibold">{traceResult.ok ? "✓ funktioniert" : "✗ funktioniert so nicht"}</p>
                <p>{traceResult.message}</p>
                {traceResult.hops.length > 0 && (
                  <p className="mt-1 text-xs">{traceResult.hops.map((h) => (h.port ? `${h.name} (${h.port})` : h.name)).join(" → ")}</p>
                )}
                {traceResult.note && <p className="mt-1 text-xs">{traceResult.note}</p>}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold">Prüfung</h3>
            {findings.length === 0 ? (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-emerald-200">
                Alles schlüssig – so würde das Netz funktionieren.
              </p>
            ) : (
              <ul className="space-y-2">
                {findings.map((f, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onMouseEnter={() => setFocus(f.deviceIds ?? [])}
                      onMouseLeave={() => setFocus([])}
                      onClick={() => setFocus(f.deviceIds ?? [])}
                      className={`block w-full rounded-lg px-3 py-2 text-left text-sm ring-1 ${LEVEL_STYLE[f.level]}`}
                    >
                      <span className="text-xs font-semibold uppercase opacity-70">
                        {f.level === "fehler" ? "Fehler" : f.level === "warnung" ? "Hinweis" : "Info"} · {f.area}
                      </span>
                      <span className="block">{f.message}</span>
                      {f.hint && <span className="block text-xs opacity-80">→ {f.hint}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {tab === "netze" && <NetworksTab model={model} update={update} />}
      {tab === "geraete" && <DevicesTab model={model} update={update} ateraDevices={ateraDevices} />}
      {tab === "verbindungen" && <LinksTab model={model} update={update} />}
    </div>
  );
}

type Updater = (change: (m: NetworkModel) => NetworkModel) => void;

function NetworksTab({ model, update }: { model: NetworkModel; update: Updater }) {
  const wan = model.wan;
  const setWan = (fields: Partial<NetworkModel["wan"]>) => update((m) => ({ ...m, wan: { ...m.wan, ...fields } }));
  const setNet = (id: string, fields: Partial<NetNetwork>) =>
    update((m) => ({ ...m, networks: m.networks.map((n) => (n.id === id ? { ...n, ...fields } : n)) }));
  const addNetwork = () =>
    update((m) => {
      const vlans = new Set(m.networks.map((n) => n.vlan));
      let vlan = 10;
      while (vlans.has(vlan)) vlan += 10;
      return {
        ...m,
        networks: [
          ...m.networks,
          { id: newId("net"), name: `Netz ${vlan}`, vlan, subnet: `192.168.${vlan}.0/24`, gateway: `192.168.${vlan}.1` },
        ],
      };
    });
  const routers = model.devices.filter((d) => d.kind === "firewall" || d.kind === "router");
  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-xl bg-white p-4 ring-1 ring-slate-200">
        <h3 className="font-semibold">Internetanschluss (WAN)</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={label}>
            Gateway-Gerät
            <select value={wan.firewallId ?? ""} onChange={(e) => setWan({ firewallId: e.target.value || undefined })} className={input}>
              <option value="">automatisch (erste Firewall)</option>
              {routers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            Art
            <select value={wan.mode} onChange={(e) => setWan({ mode: e.target.value as NetworkModel["wan"]["mode"] })} className={input}>
              <option value="statisch">Feste IP</option>
              <option value="dhcp">DHCP (vom Providerrouter)</option>
              <option value="pppoe">PPPoE (Einwahl)</option>
            </select>
          </label>
          <label className={label}>
            Provider / Anschluss
            <input
              value={wan.provider ?? ""}
              onChange={(e) => setWan({ provider: e.target.value })}
              placeholder="z. B. Magenta 300/50"
              className={input}
            />
          </label>
          {wan.mode === "statisch" ? (
            <>
              <label className={label}>
                WAN-IP
                <input
                  value={wan.ip ?? ""}
                  onChange={(e) => setWan({ ip: e.target.value })}
                  placeholder="203.0.113.10"
                  className={input}
                  inputMode="decimal"
                />
              </label>
              <label className={label}>
                Prefix
                <input
                  value={wan.prefix ?? ""}
                  onChange={(e) => setWan({ prefix: e.target.value === "" ? undefined : Number(e.target.value.replace("/", "")) })}
                  placeholder="29"
                  className={input}
                  inputMode="numeric"
                />
              </label>
              <label className={label}>
                Gateway des Providers
                <input
                  value={wan.gateway ?? ""}
                  onChange={(e) => setWan({ gateway: e.target.value })}
                  placeholder="203.0.113.9"
                  className={input}
                  inputMode="decimal"
                />
              </label>
              <label className={label}>
                DNS
                <input value={wan.dns ?? ""} onChange={(e) => setWan({ dns: e.target.value })} placeholder="1.1.1.1" className={input} />
              </label>
            </>
          ) : (
            <label className={`${label} sm:col-span-2`}>
              Netz des Providerrouters (falls davor einer hängt)
              <input
                value={wan.upstreamSubnet ?? ""}
                onChange={(e) => setWan({ upstreamSubnet: e.target.value })}
                placeholder="z. B. 192.168.178.0/24"
                className={input}
              />
            </label>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Netze / VLANs</h3>
          <button
            type="button"
            onClick={addNetwork}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium"
          >
            + Netz
          </button>
        </div>
        {model.networks.map((n) => {
          const cidr = parseCidr(n.subnet);
          return (
            <div key={n.id} className="space-y-2 rounded-xl bg-white p-3 ring-1 ring-slate-200">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <label className={label}>
                  Name
                  <input value={n.name} onChange={(e) => setNet(n.id, { name: e.target.value })} className={input} />
                </label>
                <label className={label}>
                  VLAN
                  <input
                    value={n.vlan}
                    onChange={(e) => setNet(n.id, { vlan: Number(e.target.value) || 0 })}
                    className={input}
                    inputMode="numeric"
                  />
                </label>
                <label className={label}>
                  Netz
                  <input
                    value={n.subnet}
                    onChange={(e) => setNet(n.id, { subnet: e.target.value })}
                    placeholder="192.168.20.0/24"
                    className={input}
                  />
                </label>
                <label className={label}>
                  Gateway
                  <input
                    value={n.gateway ?? ""}
                    onChange={(e) => setNet(n.id, { gateway: e.target.value })}
                    className={input}
                    inputMode="decimal"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={Boolean(n.dhcp?.enabled)}
                    onChange={(e) => {
                      const base = cidr ? cidr.network : 0;
                      const suggest = (offset: number) =>
                        cidr ? [base >>> 24, (base >>> 16) & 255, (base >>> 8) & 255, (base & 255) + offset].join(".") : "";
                      setNet(n.id, {
                        dhcp: { enabled: e.target.checked, start: n.dhcp?.start || suggest(100), end: n.dhcp?.end || suggest(200) },
                      });
                    }}
                  />
                  DHCP
                </label>
                {n.dhcp?.enabled && (
                  <>
                    <label className={label}>
                      von
                      <input
                        value={n.dhcp.start ?? ""}
                        onChange={(e) => setNet(n.id, { dhcp: { ...n.dhcp!, start: e.target.value } })}
                        className={input}
                      />
                    </label>
                    <label className={label}>
                      bis
                      <input
                        value={n.dhcp.end ?? ""}
                        onChange={(e) => setNet(n.id, { dhcp: { ...n.dhcp!, end: e.target.value } })}
                        className={input}
                      />
                    </label>
                  </>
                )}
                <label className={label}>
                  DNS
                  <input value={n.dns ?? ""} onChange={(e) => setNet(n.id, { dns: e.target.value })} className={input} />
                </label>
              </div>
              <button
                type="button"
                onClick={() => update((m) => ({ ...m, networks: m.networks.filter((x) => x.id !== n.id) }))}
                className="text-xs text-slate-400 hover:text-red-600"
              >
                Netz entfernen
              </button>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function DevicesTab({ model, update, ateraDevices }: { model: NetworkModel; update: Updater; ateraDevices: AteraDevice[] }) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const results = useMemo(() => (query.trim() ? searchCatalog(query).slice(0, 12) : []), [query]);
  const add = (device: Omit<NetDevice, "id">) => {
    const id = newId("dev");
    update((m) => ({ ...m, devices: [...m.devices, { id, ...device }] }));
    setEditing(id);
    setQuery("");
  };
  const missingFromAtera = ateraDevices.filter((a) => !model.devices.some((d) => d.name.toLowerCase() === a.name.toLowerCase()));
  const setDevice = (id: string, fields: Partial<NetDevice>) =>
    update((m) => ({ ...m, devices: m.devices.map((d) => (d.id === id ? { ...d, ...fields } : d)) }));

  return (
    <div className="space-y-4">
      <section className="space-y-2 rounded-xl bg-white p-4 ring-1 ring-slate-200">
        <h3 className="font-semibold">Gerät aus der Bibliothek</h3>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="z. B. „unifi 24“, „securepoint“, „terra server“, „thinkpad“"
          className={input}
        />
        {results.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
            {results.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() =>
                    add({
                      name: entry.model,
                      kind: entry.kind,
                      vendor: entry.vendor,
                      model: entry.model,
                      catalogId: entry.id,
                      ports: entry.ports,
                    })
                  }
                  className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <span>
                    <span className="font-medium">{entry.vendor}</span> {entry.model}
                  </span>
                  <span className="shrink-0 text-xs text-slate-500">{entry.info ?? DEVICE_KINDS[entry.kind]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() => add({ name: "Neues Gerät", kind: "sonstiges" })}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          >
            Eigenes Gerät
          </button>
          {missingFromAtera.length > 0 && (
            <button
              type="button"
              onClick={() =>
                update((m) => ({
                  ...m,
                  devices: [
                    ...m.devices,
                    ...missingFromAtera.map((a) => ({
                      id: newId("dev"),
                      name: a.name,
                      kind: (/server/i.test(a.os ?? "") ? "server" : "client") as DeviceKind,
                      model: a.os ?? undefined,
                    })),
                  ],
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            >
              {missingFromAtera.length} Geräte aus Atera übernehmen
            </button>
          )}
        </div>
      </section>

      <ul className="space-y-2">
        {model.devices.map((d) => (
          <li key={d.id} className="rounded-xl bg-white ring-1 ring-slate-200">
            <button
              type="button"
              onClick={() => setEditing(editing === d.id ? null : d.id)}
              className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left"
            >
              <span>
                <span className="font-medium">{d.name}</span>
                <span className="ml-2 text-xs text-slate-500">
                  {[DEVICE_KINDS[d.kind], [d.vendor, d.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="shrink-0 text-xs text-slate-600">{d.ip ?? ""}</span>
            </button>
            {editing === d.id && (
              <div className="grid grid-cols-2 gap-2 border-t border-slate-100 p-3 sm:grid-cols-4">
                <label className={label}>
                  Name
                  <input value={d.name} onChange={(e) => setDevice(d.id, { name: e.target.value })} className={input} />
                </label>
                <label className={label}>
                  Art
                  <select value={d.kind} onChange={(e) => setDevice(d.id, { kind: e.target.value as DeviceKind })} className={input}>
                    {Object.entries(DEVICE_KINDS).map(([value, text]) => (
                      <option key={value} value={value}>
                        {text}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={label}>
                  Netz
                  <select
                    value={d.networkId ?? ""}
                    onChange={(e) => setDevice(d.id, { networkId: e.target.value || undefined })}
                    className={input}
                  >
                    <option value="">–</option>
                    {model.networks.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name} (VLAN {n.vlan})
                      </option>
                    ))}
                  </select>
                </label>
                <label className={label}>
                  IP (leer = DHCP)
                  <input
                    value={d.ip ?? ""}
                    onChange={(e) => setDevice(d.id, { ip: e.target.value || undefined })}
                    className={input}
                    inputMode="decimal"
                  />
                </label>
                <label className={label}>
                  Hersteller
                  <input value={d.vendor ?? ""} onChange={(e) => setDevice(d.id, { vendor: e.target.value })} className={input} />
                </label>
                <label className={label}>
                  Modell
                  <input value={d.model ?? ""} onChange={(e) => setDevice(d.id, { model: e.target.value })} className={input} />
                </label>
                <label className={label}>
                  Standort
                  <input
                    value={d.location ?? ""}
                    onChange={(e) => setDevice(d.id, { location: e.target.value })}
                    placeholder="z. B. Serverschrank HE 22"
                    className={input}
                  />
                </label>
                <label className={label}>
                  Seriennummer
                  <input value={d.serial ?? ""} onChange={(e) => setDevice(d.id, { serial: e.target.value })} className={input} />
                </label>
                <label className={`${label} col-span-2 sm:col-span-4`}>
                  Notiz (keine Passwörter – die liegen in Keeper)
                  <input value={d.notes ?? ""} onChange={(e) => setDevice(d.id, { notes: e.target.value })} className={input} />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    update((m) => ({
                      ...m,
                      devices: m.devices.filter((x) => x.id !== d.id),
                      links: m.links.filter((l) => l.from !== d.id && l.to !== d.id),
                    }))
                  }
                  className="justify-self-start text-xs text-slate-400 hover:text-red-600"
                >
                  Gerät entfernen
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LinksTab({ model, update }: { model: NetworkModel; update: Updater }) {
  const empty = { from: "", fromPort: "", to: "", toPort: "", medium: "kupfer" as Medium, untagged: "", tagged: [] as string[] };
  const [draft, setDraft] = useState(empty);
  const devices = new Map(model.devices.map((d) => [d.id, d]));
  const ports = (id: string) => devices.get(id)?.ports ?? [];
  const usedPorts = new Set(model.links.flatMap((l) => [`${l.from}|${l.fromPort}`, `${l.to}|${l.toPort}`]));
  const net = (id?: string) => model.networks.find((n) => n.id === id);
  const addLink = () => {
    if (!draft.from || !draft.to) return;
    const link: NetLink = {
      id: newId("lnk"),
      from: draft.from,
      fromPort: draft.fromPort || undefined,
      to: draft.to,
      toPort: draft.toPort || undefined,
      medium: draft.medium,
      untagged: draft.untagged || undefined,
      tagged: draft.tagged,
    };
    update((m) => ({ ...m, links: [...m.links, link] }));
    setDraft({ ...empty, from: draft.from, medium: draft.medium });
  };
  const deviceSelect = (key: "from" | "to") => (
    <select value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value, [`${key}Port`]: "" })} className={input}>
      <option value="">Gerät …</option>
      {model.devices.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </select>
  );
  const portInput = (key: "from" | "to") => (
    <>
      <input
        value={draft[`${key}Port`]}
        onChange={(e) => setDraft({ ...draft, [`${key}Port`]: e.target.value })}
        list={`ports-${key}`}
        placeholder="Port"
        className={input}
      />
      <datalist id={`ports-${key}`}>
        {ports(draft[key])
          .filter((p) => !usedPorts.has(`${draft[key]}|${p}`))
          .map((p) => (
            <option key={p} value={p} />
          ))}
      </datalist>
    </>
  );

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-xl bg-white p-4 ring-1 ring-slate-200">
        <h3 className="font-semibold">Verbindung hinzufügen</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {deviceSelect("from")}
          {portInput("from")}
          {deviceSelect("to")}
          {portInput("to")}
          <select
            value={draft.medium}
            onChange={(e) => setDraft({ ...draft, medium: e.target.value as Medium })}
            className={input}
            aria-label="Medium"
          >
            {Object.entries(MEDIA).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
          <select
            value={draft.untagged}
            onChange={(e) => setDraft({ ...draft, untagged: e.target.value })}
            className={input}
            aria-label="Untagged"
          >
            <option value="">untagged: –</option>
            {model.networks.map((n) => (
              <option key={n.id} value={n.id}>
                untagged: {n.name} (VLAN {n.vlan})
              </option>
            ))}
          </select>
        </div>
        {model.networks.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-xs text-slate-500">tagged (Trunk):</span>
            {model.networks.map((n) => (
              <label key={n.id} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={draft.tagged.includes(n.id)}
                  onChange={(e) =>
                    setDraft({ ...draft, tagged: e.target.checked ? [...draft.tagged, n.id] : draft.tagged.filter((id) => id !== n.id) })
                  }
                />
                VLAN {n.vlan}
              </label>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={addLink}
          disabled={!draft.from || !draft.to}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Verbinden
        </button>
      </section>

      <ul className="divide-y divide-slate-100 rounded-xl bg-white ring-1 ring-slate-200">
        {model.links.map((l) => (
          <li key={l.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-medium">
                {devices.get(l.from)?.name}
                {l.fromPort && <span className="text-slate-500"> ({l.fromPort})</span>} ↔ {devices.get(l.to)?.name}
                {l.toPort && <span className="text-slate-500"> ({l.toPort})</span>}
              </span>
              <span className="block text-xs text-slate-500">
                {[
                  MEDIA[l.medium],
                  net(l.untagged) ? `untagged VLAN ${net(l.untagged)!.vlan}` : null,
                  l.tagged?.length ? `tagged ${l.tagged.map((id) => net(id)?.vlan).join(", ")}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <button
              type="button"
              onClick={() => update((m) => ({ ...m, links: m.links.filter((x) => x.id !== l.id) }))}
              className="text-xs text-slate-400 hover:text-red-600"
            >
              Entfernen
            </button>
          </li>
        ))}
      </ul>
      {firewallOf(model) === undefined && model.devices.length > 0 && (
        <p className="text-sm text-amber-700">Tipp: Eine Firewall oder einen Router anlegen – sie ist das Gateway für die Prüfung.</p>
      )}
    </div>
  );
}
