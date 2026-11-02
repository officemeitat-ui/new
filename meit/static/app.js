/* ME-IT Cockpit – Weboberfläche (ohne Build-Schritt, ohne externe Abhängigkeiten). */
"use strict";

// ---------------------------------------------------------------- Helfer
const $app = document.getElementById("app");
const state = { customers: [], services: [], chat: [] };

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v; // nur für bereits escaptes Markdown
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

async function api(path, opts = {}) {
  const init = { headers: {}, ...opts };
  if (opts.body && typeof opts.body !== "string") {
    init.body = JSON.stringify(opts.body);
    init.headers["Content-Type"] = "application/json";
  }
  const res = await fetch(path, init);
  const type = res.headers.get("content-type") || "";
  const data = type.includes("json") ? await res.json() : await res.text();
  if (!res.ok) {
    let msg = data && data.detail ? data.detail : res.statusText;
    if (Array.isArray(msg)) msg = msg.map((d) => `${(d.loc || []).slice(-1)[0]}: ${d.msg}`).join(", ");
    throw new Error(msg);
  }
  return data;
}

function toast(text, isError = false) {
  const el = h("div", { class: "toast" + (isError ? " error" : "") }, text);
  document.getElementById("toast-root").append(el);
  setTimeout(() => el.remove(), isError ? 6000 : 3000);
}

const eur = (n) => new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);
const eur2 = (n) => new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" }).format(n || 0);
function dt(s) {
  if (!s) return "–";
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d) ? s : d.toLocaleDateString("de-AT");
}
const badge = (text, cls) => h("span", { class: `badge ${cls || text}` }, text);
const STATUS_LABEL = { neu: "neu", in_arbeit: "in Arbeit", wartet: "wartet", geloest: "gelöst" };

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Kleiner, sicherer Markdown-Renderer: erst escapen, dann nur eigene Tags einsetzen. */
function md(text) {
  const lines = escapeHtml(text).split("\n");
  const out = [];
  let list = null, inCode = false, code = [], table = [];
  const inline = (s) => s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])_([^_]+)_(?=[\s).,]|$)/g, "$1<em>$2</em>");
  const flushList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const flushTable = () => {
    if (!table.length) return;
    const rows = table.filter((r) => r.replace(/[|:\-\s]/g, "") !== ""); // Trennzeilen |---| entfernen
    const cells = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
    out.push("<div class='table-wrap'><table>");
    rows.forEach((r, i) => {
      const tag = i === 0 ? "th" : "td";
      out.push("<tr>" + cells(r).map((c) => `<${tag}>${c}</${tag}>`).join("") + "</tr>");
    });
    out.push("</table></div>");
    table = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("```")) {
      if (inCode) { out.push(`<pre><code>${code.join("\n")}</code></pre>`); code = []; inCode = false; }
      else { flushList(); flushTable(); inCode = true; }
      continue;
    }
    if (inCode) { code.push(raw); continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) { flushList(); table.push(line.trim()); continue; }
    flushTable();
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flushList(); const n = Math.min(m[1].length + 1, 4); out.push(`<h${n}>${inline(m[2])}</h${n}>`); }
    else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { if (list !== "ul") { flushList(); out.push("<ul>"); list = "ul"; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { if (list !== "ol") { flushList(); out.push("<ol>"); list = "ol"; } out.push(`<li>${inline(m[1])}</li>`); }
    else if (!line.trim()) { flushList(); }
    else { flushList(); out.push(`<p>${inline(line)}</p>`); }
  }
  if (inCode) out.push(`<pre><code>${code.join("\n")}</code></pre>`);
  flushList(); flushTable();
  return h("div", { class: "md", html: out.join("") });
}

function modal(title, body, actions = []) {
  const root = document.getElementById("modal-root");
  const close = () => { backdrop.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const backdrop = h("div", { class: "modal-backdrop", onclick: (e) => { if (e.target === backdrop) close(); } },
    h("div", { class: "modal", role: "dialog", "aria-modal": "true" },
      h("div", { class: "modal-head" }, h("h2", {}, title), h("button", { class: "close", onclick: close, "aria-label": "Schließen" }, "×")),
      h("div", { class: "modal-body" }, body),
      actions.length ? h("div", { class: "modal-foot" }, actions.map((a) => typeof a === "function" ? a(close) : a)) : null));
  document.addEventListener("keydown", onKey);
  root.append(backdrop);
  return close;
}

/** Formular aus Felddefinitionen bauen. */
function form(fields, values = {}) {
  const el = h("form", { class: "form-grid", onsubmit: (e) => e.preventDefault() });
  for (const f of fields) {
    const v = values[f.name] ?? f.value ?? "";
    let input;
    if (f.type === "textarea") input = h("textarea", { name: f.name, placeholder: f.placeholder || "", rows: f.rows || 4 }, v);
    else if (f.type === "select") {
      input = h("select", { name: f.name }, f.options.map((o) => {
        const [val, label] = Array.isArray(o) ? o : [o, o];
        return h("option", { value: val, selected: String(val) === String(v) }, label);
      }));
    } else if (f.type === "checkbox") input = h("input", { type: "checkbox", name: f.name, checked: !!v, style: "width:auto" });
    else input = h("input", { type: f.type || "text", name: f.name, value: v, placeholder: f.placeholder || "", step: f.step || null, required: f.required || null });
    el.append(h("div", { class: f.full ? "full" : "" }, h("label", {}, f.label), input));
  }
  return el;
}

function readForm(el) {
  const out = {};
  for (const input of el.querySelectorAll("[name]")) {
    if (input.type === "checkbox") out[input.name] = input.checked;
    else if (input.type === "number") out[input.name] = input.value === "" ? 0 : Number(input.value);
    else out[input.name] = input.value;
  }
  return out;
}

async function withBusy(btn, fn) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.replaceChildren(h("span", { class: "spinner" }), " bitte warten …");
  try { return await fn(); }
  catch (e) { toast(e.message, true); }
  finally { btn.disabled = false; btn.textContent = label; }
}

async function loadCustomers() {
  state.customers = await api("/api/customers");
  return state.customers;
}
const customerOptions = (withEmpty = false) =>
  (withEmpty ? [["", "– kein Kunde –"]] : []).concat(state.customers.map((c) => [c.id, c.name]));

function setTitle(title, actions = []) {
  document.getElementById("page-title").textContent = title;
  document.getElementById("topbar-actions").replaceChildren(...actions);
  document.title = `${title} · ME-IT Cockpit`;
}

function table(columns, rows, onClick) {
  if (!rows.length) return h("div", { class: "empty" }, "Keine Einträge.");
  return h("div", { class: "table-wrap" }, h("table", {},
    h("thead", {}, h("tr", {}, columns.map((c) => h("th", { class: c.num ? "num" : "" }, c.label)))),
    h("tbody", {}, rows.map((r) => h("tr", { class: onClick ? "clickable" : "", onclick: onClick ? () => onClick(r) : null },
      columns.map((c) => h("td", { class: c.num ? "num" : "" }, c.render ? c.render(r) : (r[c.key] ?? ""))))))));
}

function copyButton(getText, label = "Kopieren") {
  return h("button", { class: "btn small", onclick: async () => {
    try { await navigator.clipboard.writeText(getText()); toast("In Zwischenablage kopiert"); }
    catch { toast("Kopieren nicht möglich – bitte manuell markieren", true); }
  } }, label);
}

// ---------------------------------------------------------------- KI-Status
async function refreshAiStatus() {
  const el = document.getElementById("ai-status");
  try {
    const s = await api("/api/health");
    document.getElementById("brand-name").textContent = s.company;
    const llm = s.llm;
    if (llm.active_provider !== "none") {
      el.className = "ai-status on";
      el.replaceChildren(h("span", { class: "dot" }), `${llm.active_local ? "Offline-KI" : "Cloud-KI"} aktiv`, h("br"),
        h("span", { class: "small muted" }, llm.active_model));
    } else {
      el.className = "ai-status off";
      el.replaceChildren(h("span", { class: "dot" }), "KI offline – Regeln aktiv", h("br"),
        h("span", { class: "small muted" }, (llm.primary.detail || "").slice(0, 80)));
    }
  } catch {
    el.className = "ai-status off";
    el.textContent = "Server nicht erreichbar";
  }
}

// ---------------------------------------------------------------- Ansichten
const views = {};

views.dashboard = async () => {
  setTitle("Übersicht", [h("a", { class: "btn primary", href: "#/tickets?neu=1" }, "+ Ticket")]);
  const d = await api("/api/dashboard");
  const kpi = (label, value, sub, cls = "") => h("div", { class: `card kpi ${cls}` },
    h("div", { class: "label" }, label), h("div", { class: "value" }, value), h("div", { class: "sub" }, sub));
  $app.replaceChildren(
    h("div", { class: "grid kpis" },
      kpi("Wiederkehrender Umsatz", eur(d.mrr), `pro Monat · ${eur(d.mrr * 12)} pro Jahr`),
      kpi("Kunden", d.customers, `${d.managed_customers} mit Managed-Vertrag`),
      kpi("Offene Tickets", d.open_tickets, `${d.critical_tickets} dringend`),
      kpi("Geräte ohne Support", d.assets_eol, `${d.assets_eol_soon} bald · ${d.warranty_soon} Garantie < 90 Tage`),
      kpi("Umsatz-Potenzial", eur(d.radar_annual), `${d.radar_count} Chancen · +${eur(d.radar_monthly)}/Monat`, "accent")),
    h("div", { class: "grid two" },
      h("div", { class: "card" },
        h("div", { class: "card-head" }, h("h2", {}, "Top-Verkaufschancen"), h("a", { class: "btn small", href: "#/radar" }, "Alle anzeigen")),
        d.top_opportunities.length ? h("ul", { class: "list" }, d.top_opportunities.map((o) => h("li", {},
          h("div", { class: "row" }, h("strong", {}, o.title), h("span", { class: "spacer" }),
            h("span", { class: "small" }, o.monthly ? `+${eur(o.monthly)}/Mon.` : eur(o.once))),
          h("div", { class: "small muted" }, `${o.customer} · ${o.reason}`)))) : h("div", { class: "empty" }, "Keine offenen Chancen.")),
      h("div", { class: "stack" },
        h("div", { class: "card" },
          h("h2", {}, "Verträge laufen aus (90 Tage)"),
          d.contracts_ending.length ? h("ul", { class: "list" }, d.contracts_ending.map((c) => h("li", { class: "row" },
            h("a", { href: `#/kunde/${c.id}` }, c.name), h("span", { class: "spacer" }), badge(dt(c.contract_end), "warn"))))
            : h("div", { class: "muted small" }, "Keine Vertragsenden in den nächsten 90 Tagen.")),
        h("div", { class: "card" },
          h("h2", {}, "Letzte KI-Agenten-Läufe"),
          d.recent_agent_runs.length ? table([
            { label: "Agent", key: "agent" }, { label: "Provider", key: "provider" },
            { label: "Status", render: (r) => badge(r.ok ? "ok" : "Fallback", r.ok ? "ok" : "warn") },
            { label: "Dauer", num: true, render: (r) => `${(r.duration_ms / 1000).toFixed(1)} s` },
          ], d.recent_agent_runs) : h("div", { class: "muted small" }, "Noch keine Läufe – probiere den Assistenten oder die Ticket-Triage.")))),
    h("div", { class: "card", style: "margin-top:1rem" },
      h("h2", {}, "Fokus 2026–2030"),
      h("div", { class: "grid kpis", style: "margin:0" },
        ["Managed Services statt Stundenabrechnung – planbarer MRR",
          "NIS2/NISG 2026: Registrierung & Nachweise für Kunden begleiten",
          "Security-Pakete (MFA, EDR, Backup, Awareness) standardisieren",
          "Private KI-Box: lokale KI als DSGVO-konformes Produkt",
          "KI-Agenten intern: mehr Kunden pro Techniker"].map((t) => h("div", { class: "small" }, "✓ ", t))),
      h("p", { class: "small muted" }, "Details: docs/STRATEGIE-2026-2030.md im Projektordner.")));
};

views.kunden = async () => {
  setTitle("Kunden", [h("button", { class: "btn primary", onclick: () => customerForm() }, "+ Kunde")]);
  const rows = await loadCustomers();
  $app.replaceChildren(h("div", { class: "card" }, table([
    { label: "Kunde", render: (r) => h("strong", {}, r.name) },
    { label: "Branche", key: "industry" },
    { label: "MA", key: "employees", num: true },
    { label: "Paket", render: (r) => badge(r.package, r.package === "keins" ? "warn" : "info") },
    { label: "MRR", num: true, render: (r) => eur(r.mrr) },
    { label: "Tickets", key: "open_tickets", num: true },
    { label: "Geräte", key: "asset_count", num: true },
    { label: "Vertragsende", render: (r) => dt(r.contract_end) },
  ], rows, (r) => { location.hash = `#/kunde/${r.id}`; })));
};

function customerForm(c = null) {
  const f = form([
    { name: "name", label: "Firmenname", required: true },
    { name: "contact_name", label: "Ansprechpartner" },
    { name: "email", label: "E-Mail", type: "email" },
    { name: "phone", label: "Telefon" },
    { name: "address", label: "Adresse", full: true },
    { name: "industry", label: "Branche" },
    { name: "employees", label: "Mitarbeiter", type: "number" },
    { name: "package", label: "Paket", type: "select", options: ["keins", "basis", "pro", "premium"] },
    { name: "mrr", label: "MRR (€/Monat)", type: "number", step: "0.01" },
    { name: "contract_end", label: "Vertragsende", type: "date" },
    { name: "booked_services", label: "Gebuchte Leistungen (Codes, kommagetrennt)", placeholder: "MW, SEC, BCK" },
    { name: "notes", label: "Notizen", type: "textarea", full: true },
  ], c ? { ...c, booked_services: (c.booked_services || []).join(", ") } : {});
  modal(c ? "Kunde bearbeiten" : "Neuer Kunde", f, [
    (close) => h("button", { class: "btn primary", onclick: async (e) => withBusy(e.target, async () => {
      const data = readForm(f);
      data.booked_services = data.booked_services.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
      const saved = await api(c ? `/api/customers/${c.id}` : "/api/customers", { method: c ? "PUT" : "POST", body: data });
      close(); toast("Gespeichert"); location.hash = `#/kunde/${saved.id}`; render();
    }) }, "Speichern"),
  ]);
}

views.kunde = async (id) => {
  const c = await api(`/api/customers/${id}`);
  await loadCustomers();
  setTitle(c.name, [
    h("button", { class: "btn", onclick: () => customerForm(c) }, "Bearbeiten"),
    h("button", { class: "btn", onclick: () => ticketCreate(c.id) }, "+ Ticket"),
    h("button", { class: "btn", onclick: () => assetForm(null, c.id) }, "+ Gerät"),
    h("button", { class: "btn", onclick: (e) => withBusy(e.target, async () => {
      const r = await api("/api/agents/report", { method: "POST", body: { customer_id: c.id } });
      modal("Monatsbericht", h("div", {}, h("p", { class: "small muted" }, `Erstellt mit: ${r.provider}`), md(r.text)), [copyButton(() => r.text)]);
    }) }, "Monatsbericht (KI)"),
    h("a", { class: "btn", href: `#/security?kunde=${c.id}` }, "Security-Check"),
    h("button", { class: "btn primary", onclick: () => quoteCreate(c.id) }, "Angebot (KI)"),
  ]);
  $app.replaceChildren(
    h("div", { class: "grid kpis" },
      h("div", { class: "card kpi" }, h("div", { class: "label" }, "Paket / MRR"), h("div", { class: "value" }, eur(c.mrr)), h("div", { class: "sub" }, `Paket: ${c.package}`)),
      h("div", { class: "card kpi" }, h("div", { class: "label" }, "Mitarbeiter"), h("div", { class: "value" }, c.employees), h("div", { class: "sub" }, c.industry || "–")),
      h("div", { class: "card kpi" }, h("div", { class: "label" }, "Kontakt"), h("div", { style: "font-weight:600;margin-top:.3rem" }, c.contact_name || "–"),
        h("div", { class: "sub" }, [c.email, c.phone].filter(Boolean).join(" · "))),
      h("div", { class: "card kpi" }, h("div", { class: "label" }, "Gebuchte Leistungen"), h("div", { class: "row", style: "margin-top:.4rem" },
        c.booked_services.length ? c.booked_services.map((s) => badge(s, "info")) : h("span", { class: "muted" }, "keine")))),
    c.notes ? h("div", { class: "card", style: "margin-bottom:1rem" }, h("strong", {}, "Notizen: "), c.notes) : null,
    h("div", { class: "grid two" },
      h("div", { class: "card" }, h("h2", {}, `Verkaufschancen (${c.opportunities.length})`),
        c.opportunities.length ? h("ul", { class: "list" }, c.opportunities.map((o) => h("li", {},
          h("div", { class: "row" }, badge(["", "niedrig", "mittel", "hoch"][o.priority], ["", "", "info", "hoch"][o.priority]), h("strong", {}, o.title), h("span", { class: "spacer" }),
            h("span", { class: "small" }, [o.once ? eur(o.once) : "", o.monthly ? `+${eur(o.monthly)}/Mon.` : ""].filter(Boolean).join(" · "))),
          h("div", { class: "small muted" }, o.reason)))) : h("div", { class: "empty" }, "Keine Chancen erkannt.")),
      h("div", { class: "card" }, h("div", { class: "card-head" }, h("h2", {}, "Tickets")),
        table([
          { label: "#", key: "id" }, { label: "Titel", key: "title" },
          { label: "Prio", render: (r) => badge(r.priority) }, { label: "Status", render: (r) => badge(STATUS_LABEL[r.status] || r.status, r.status) },
        ], c.tickets, (r) => ticketDetail(r.id)))),
    h("div", { class: "card", style: "margin-top:1rem" }, h("h2", {}, "Geräte"), assetTable(c.assets.map((a) => ({ ...a })))),
    h("div", { class: "grid two", style: "margin-top:1rem" },
      h("div", { class: "card" }, h("h2", {}, "Angebote"), table([
        { label: "Titel", key: "title" }, { label: "Einmalig", num: true, render: (r) => eur(r.total_once) },
        { label: "Monatlich", num: true, render: (r) => eur(r.total_monthly) }, { label: "Status", render: (r) => badge(r.status) },
      ], c.quotes, () => { location.hash = "#/angebote"; })),
      h("div", { class: "card" }, h("h2", {}, "Security-Checks"), table([
        { label: "Datum", render: (r) => dt(r.created_at) }, { label: "Score", num: true, render: (r) => `${Math.round(r.score)}/100` },
        { label: "Bewertung", render: (r) => badge(r.level) },
      ], c.assessments, async (r) => {
        const a = await api(`/api/security/assessments/${r.id}`);
        modal("Security-Bericht", md(a.report), [copyButton(() => a.report)]);
      }))),
    h("div", { class: "row", style: "margin-top:1rem" }, h("span", { class: "spacer" }),
      h("button", { class: "btn danger small", onclick: async () => {
        if (!confirm(`Kunde „${c.name}“ inkl. Geräten und Angeboten wirklich löschen?`)) return;
        await api(`/api/customers/${c.id}`, { method: "DELETE" }); toast("Kunde gelöscht"); location.hash = "#/kunden";
      } }, "Kunde löschen")));
};

// ---- Tickets
let ticketFilter = "offen";
views.tickets = async (_, params) => {
  await loadCustomers();
  setTitle("Tickets", [h("button", { class: "btn primary", onclick: () => ticketCreate() }, "+ Ticket")]);
  const query = ticketFilter === "offen" ? "?open_only=true" : ticketFilter === "geloest" ? "?status=geloest" : "";
  const rows = await api(`/api/tickets${query}`);
  const tabs = h("div", { class: "tabs" }, [["offen", "Offen"], ["alle", "Alle"], ["geloest", "Gelöst"]].map(([k, l]) =>
    h("button", { class: ticketFilter === k ? "active" : "", onclick: () => { ticketFilter = k; render(); } }, l)));
  $app.replaceChildren(tabs, h("div", { class: "card" }, table([
    { label: "#", key: "id" },
    { label: "Titel", render: (r) => h("div", {}, h("strong", {}, r.title), r.ai_suggestion?.summary && r.ai_suggestion.summary !== r.title
      ? h("div", { class: "small muted" }, r.ai_suggestion.summary) : null) },
    { label: "Kunde", render: (r) => r.customer_name || "–" },
    { label: "Kategorie", render: (r) => r.category || "–" },
    { label: "Priorität", render: (r) => badge(r.priority) },
    { label: "Status", render: (r) => badge(STATUS_LABEL[r.status] || r.status, r.status) },
    { label: "Erstellt", render: (r) => dt(r.created_at) },
  ], rows, (r) => ticketDetail(r.id))));
  if (params.get("neu")) ticketCreate();
};

function ticketCreate(customerId = null) {
  const f = form([
    { name: "customer_id", label: "Kunde", type: "select", options: customerOptions(true), value: customerId ?? "" },
    { name: "title", label: "Betreff", required: true, full: true, placeholder: "z. B. Outlook startet nicht" },
    { name: "description", label: "Beschreibung", type: "textarea", full: true, placeholder: "Was genau passiert? Seit wann? Wer ist betroffen?" },
    { name: "auto_triage", label: "Automatisch mit KI einordnen (Kategorie, Priorität, Lösungsvorschlag)", type: "checkbox", value: true, full: true },
  ]);
  modal("Neues Ticket", f, [
    (close) => h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
      const data = readForm(f);
      data.customer_id = data.customer_id ? Number(data.customer_id) : null;
      const t = await api("/api/tickets", { method: "POST", body: data });
      close(); toast(`Ticket #${t.id} angelegt`);
      if (location.hash.startsWith("#/tickets")) history.replaceState(null, "", "#/tickets");
      await render(); ticketDetail(t.id);
    }) }, "Anlegen"),
  ]);
}

async function ticketDetail(id) {
  let t;
  try { t = await api(`/api/tickets/${id}`); } catch (e) { return toast(e.message, true); }
  const s = t.ai_suggestion;
  const edit = form([
    { name: "status", label: "Status", type: "select", options: Object.entries(STATUS_LABEL) },
    { name: "priority", label: "Priorität", type: "select", options: ["niedrig", "normal", "hoch", "kritisch"] },
    { name: "category", label: "Kategorie" },
    { name: "time_spent_min", label: "Aufwand (Minuten)", type: "number" },
    { name: "solution", label: "Lösung (wird zu Trainings-/Wissensdaten)", type: "textarea", full: true, placeholder: "Was war die Ursache, was hat geholfen?" },
  ], t);
  const aiBox = s ? h("div", { class: "card", style: "background:var(--surface-2);margin:1rem 0" },
    h("div", { class: "card-head" }, h("h3", { style: "margin:0" }, "KI-Vorschlag"), h("span", { class: "small muted" }, s.provider)),
    s.error ? h("p", { class: "small", style: "color:var(--warn)" }, s.error) : null,
    h("p", {}, h("strong", {}, "Zusammenfassung: "), s.summary),
    h("div", {}, h("strong", {}, "Lösungsschritte:"), h("ol", {}, (s.steps || []).map((x) => h("li", {}, x)))),
    s.hint ? h("p", {}, h("strong", {}, "Verkaufschance: "), s.hint) : null,
    h("p", { class: "small muted" }, `Geschätzter Aufwand: ${s.minutes} min`),
    s.sources && (s.sources.kb.length || s.sources.tickets.length) ? h("p", { class: "small muted" }, "Quellen: ",
      [...s.sources.kb.map((k) => `Wissen „${k.title}“`), ...s.sources.tickets.map((k) => `Ticket #${k.id}`)].join(", ")) : null,
    h("div", { class: "row" }, h("strong", {}, "Antwortentwurf an den Kunden"), h("span", { class: "spacer" }), copyButton(() => s.reply)),
    h("pre", { style: "white-space:pre-wrap;font-family:inherit;margin:.4rem 0 0" }, s.reply)) : null;
  modal(`#${t.id} ${t.title}`, h("div", {},
    h("p", { class: "muted small" }, `${t.customer_name || "Kein Kunde"} · erstellt ${dt(t.created_at)}`),
    h("p", { style: "white-space:pre-wrap" }, t.description || h("em", { class: "muted" }, "Keine Beschreibung")),
    aiBox, edit), [
    h("button", { class: "btn danger", onclick: async () => {
      if (!confirm("Ticket löschen?")) return;
      await api(`/api/tickets/${t.id}`, { method: "DELETE" }); document.querySelector(".modal-backdrop")?.remove(); toast("Gelöscht"); render();
    } }, "Löschen"),
    t.status === "geloest" && t.solution ? h("button", { class: "btn", onclick: async (e) => withBusy(e.target, async () => {
      await api(`/api/tickets/${t.id}/to-kb`, { method: "POST" }); toast("Als Wissensartikel gespeichert");
    }) }, "→ Wissensdatenbank") : null,
    (close) => h("button", { class: "btn", onclick: (e) => withBusy(e.target, async () => {
      await api(`/api/tickets/${t.id}/triage`, { method: "POST" }); close(); ticketDetail(t.id); render();
    }) }, s ? "KI-Triage erneut" : "KI-Triage starten"),
    (close) => h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
      await api(`/api/tickets/${t.id}`, { method: "PUT", body: readForm(edit) }); close(); toast("Gespeichert"); render();
    }) }, "Speichern"),
  ].filter(Boolean));
}

// ---- Geräte
function assetTable(rows) {
  return table([
    { label: "Name", render: (r) => h("strong", {}, r.name) },
    ...(rows.some((r) => r.customer_name) ? [{ label: "Kunde", key: "customer_name" }] : []),
    { label: "Typ", key: "type" },
    { label: "Betriebssystem", render: (r) => r.os || "–" },
    { label: "Support", render: (r) => {
      const status = r.eol_status || "ok";
      return status === "ok" ? badge("ok") : badge(status === "abgelaufen" ? `abgelaufen ${dt(r.eol_date)}` : `endet ${dt(r.eol_date)}`, status);
    } },
    { label: "Kauf", render: (r) => dt(r.purchase_date) },
    { label: "Garantie bis", render: (r) => dt(r.warranty_end) },
  ], rows, (r) => assetForm(r));
}

views.assets = async (_, params) => {
  await loadCustomers();
  const filter = params.get("kunde") || "";
  setTitle("Geräte", [h("button", { class: "btn primary", onclick: () => assetForm(null, filter ? Number(filter) : null) }, "+ Gerät")]);
  const rows = await api(`/api/assets${filter ? `?customer_id=${filter}` : ""}`);
  const select = h("select", { style: "max-width:320px", onchange: (e) => { location.hash = e.target.value ? `#/assets?kunde=${e.target.value}` : "#/assets"; } },
    customerOptions(true).map(([v, l]) => h("option", { value: v, selected: String(v) === filter }, v ? l : "Alle Kunden")));
  const eol = rows.filter((r) => r.eol_status === "abgelaufen").length;
  $app.replaceChildren(h("div", { class: "row", style: "margin-bottom:1rem" }, select, h("span", { class: "spacer" }),
    h("span", { class: "muted small" }, `${rows.length} Geräte · ${eol} ohne Herstellersupport`)),
  h("div", { class: "card" }, assetTable(rows)));
};

function assetForm(a = null, customerId = null) {
  const types = ["pc", "notebook", "server", "firewall", "switch", "accesspoint", "nas", "drucker", "smartphone", "sonstiges"];
  const f = form([
    { name: "customer_id", label: "Kunde", type: "select", options: customerOptions(), value: a?.customer_id ?? customerId ?? "" },
    { name: "name", label: "Gerätename", required: true },
    { name: "type", label: "Typ", type: "select", options: types },
    { name: "os", label: "Betriebssystem / Firmware", placeholder: "z. B. Windows 11 Pro 24H2" },
    { name: "serial", label: "Seriennummer" },
    { name: "purchase_date", label: "Kaufdatum", type: "date" },
    { name: "warranty_end", label: "Garantie bis", type: "date" },
    { name: "notes", label: "Notizen", type: "textarea", full: true },
  ], a || {});
  modal(a ? "Gerät bearbeiten" : "Neues Gerät", f, [
    a ? (close) => h("button", { class: "btn danger", onclick: async () => {
      if (!confirm("Gerät löschen?")) return;
      await api(`/api/assets/${a.id}`, { method: "DELETE" }); close(); toast("Gelöscht"); render();
    } }, "Löschen") : null,
    (close) => h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
      const data = readForm(f); data.customer_id = Number(data.customer_id);
      await api(a ? `/api/assets/${a.id}` : "/api/assets", { method: a ? "PUT" : "POST", body: data });
      close(); toast("Gespeichert"); render();
    }) }, "Speichern"),
  ].filter(Boolean));
}

// ---- Wissen
views.wissen = async () => {
  setTitle("Wissensdatenbank", [
    h("button", { class: "btn", onclick: (e) => withBusy(e.target, async () => {
      const r = await api("/api/kb/reindex", { method: "POST" });
      toast(r.indexed ? `${r.indexed} Artikel semantisch indexiert` : "Kein Embedding-Modell erreichbar – Stichwortsuche aktiv");
    }) }, "Neu indexieren"),
    h("button", { class: "btn primary", onclick: () => articleForm() }, "+ Artikel"),
  ]);
  const articles = await api("/api/kb");
  const results = h("div");
  const showList = (items, scored = false) => results.replaceChildren(items.length ? h("div", { class: "stack" }, items.map((a) =>
    h("details", { class: "card" },
      h("summary", { style: "cursor:pointer" }, h("strong", {}, a.title), " ", a.tags ? h("span", { class: "small muted" }, `· ${a.tags}`) : null,
        scored ? h("span", { class: "small muted" }, ` · Treffer ${Math.round(a.score * 100)} % (${a.mode})`) : null),
      h("div", { style: "margin-top:.6rem" }, md(a.content)),
      h("div", { class: "row" }, h("span", { class: "spacer" }), h("button", { class: "btn small", onclick: () => articleForm(a) }, "Bearbeiten"))))) :
    h("div", { class: "empty" }, "Nichts gefunden."));
  let timer;
  const search = h("input", { type: "search", placeholder: "Suchen … (z. B. „Drucker druckt nicht“ – mit KI auch sinngemäß)", oninput: (e) => {
    clearTimeout(timer);
    const q = e.target.value.trim();
    timer = setTimeout(async () => { if (!q) return showList(articles); showList(await api(`/api/kb/search?q=${encodeURIComponent(q)}&limit=10`), true); }, 350);
  } });
  showList(articles);
  $app.replaceChildren(h("div", { class: "card", style: "margin-bottom:1rem" }, search), results);
};

function articleForm(a = null) {
  const f = form([
    { name: "title", label: "Titel", required: true, full: true },
    { name: "tags", label: "Schlagworte", full: true, placeholder: "drucker, windows" },
    { name: "content", label: "Inhalt (Markdown)", type: "textarea", rows: 14, full: true },
  ], a || {});
  modal(a ? "Artikel bearbeiten" : "Neuer Artikel", f, [
    a ? (close) => h("button", { class: "btn danger", onclick: async () => {
      if (!confirm("Artikel löschen?")) return;
      await api(`/api/kb/${a.id}`, { method: "DELETE" }); close(); render();
    } }, "Löschen") : null,
    (close) => h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
      await api(a ? `/api/kb/${a.id}` : "/api/kb", { method: a ? "PUT" : "POST", body: readForm(f) }); close(); toast("Gespeichert"); render();
    }) }, "Speichern"),
  ].filter(Boolean));
}

// ---- Assistent
views.assistent = async () => {
  setTitle("KI-Assistent", [h("button", { class: "btn", onclick: () => { state.chat = []; saveChat(); render(); } }, "Neuer Chat")]);
  try { state.chat = JSON.parse(sessionStorage.getItem("meit-chat") || "[]"); } catch { state.chat = state.chat || []; }
  const log = h("div", { class: "chat-log" });
  const input = h("textarea", { placeholder: "Frag den Assistenten … (Enter = senden, Shift+Enter = neue Zeile)" });
  const sendBtn = h("button", { class: "btn primary" }, "Senden");
  const drawMsg = (m) => {
    const el = h("div", { class: `msg ${m.role}` }, m.role === "assistant" ? md(m.content) : m.content);
    if (m.steps && m.steps.length) el.append(h("details", {}, h("summary", {}, `${m.steps.length} Werkzeug(e) genutzt · ${m.provider || ""}`),
      m.steps.map((s) => h("pre", {}, `${s.tool}(${JSON.stringify(s.args)})\n→ ${JSON.stringify(s.result).slice(0, 600)}`))));
    else if (m.provider) el.append(h("div", { class: "small muted", style: "margin-top:.3rem" }, m.provider));
    log.append(el); log.scrollTop = log.scrollHeight;
  };
  const send = async (text) => {
    text = (text ?? input.value).trim();
    if (!text) return;
    input.value = "";
    state.chat.push({ role: "user", content: text }); drawMsg(state.chat.at(-1));
    const thinking = h("div", { class: "msg assistant" }, h("span", { class: "spinner" }), " denkt nach …");
    log.append(thinking); log.scrollTop = log.scrollHeight;
    sendBtn.disabled = true;
    try {
      const r = await api("/api/agents/assistant", { method: "POST", body: { messages: state.chat.map(({ role, content }) => ({ role, content })) } });
      thinking.remove();
      state.chat.push({ role: "assistant", content: r.answer, steps: r.steps, provider: r.provider });
      drawMsg(state.chat.at(-1)); saveChat();
    } catch (e) { thinking.remove(); toast(e.message, true); }
    finally { sendBtn.disabled = false; input.focus(); }
  };
  sendBtn.onclick = () => send();
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  const examples = ["Welche Kunden haben noch Windows 10?", "Was sind die 3 wichtigsten Verkaufschancen?",
    "Wie behebe ich eine hängende Druckwarteschlange?", "Welche kritischen Tickets sind offen?",
    "Leg für die Tischlerei Huber ein Ticket an: Bildschirm flackert"];
  $app.replaceChildren(h("div", { class: "card chat" },
    state.chat.length ? null : h("div", {}, h("p", { class: "muted" }, "Der Assistent arbeitet mit deinen echten Daten (Kunden, Tickets, Geräte, Wissen) – lokal, ohne Cloud."),
      h("div", { class: "chips" }, examples.map((x) => h("button", { class: "chip", onclick: () => send(x) }, x)))),
    log, h("div", { class: "chat-input" }, input, sendBtn)));
  state.chat.forEach(drawMsg);
  input.focus();
};
function saveChat() { try { sessionStorage.setItem("meit-chat", JSON.stringify(state.chat.slice(-30))); } catch { /* egal */ } }

// ---- Radar
let radarKind = "alle";
views.radar = async () => {
  setTitle("Umsatz-Radar");
  const r = await api("/api/radar");
  const kinds = { alle: "Alle", managed: "Managed", security: "Security", compliance: "NIS2", lifecycle: "Lifecycle", ki: "KI", vertrag: "Verträge", projekt: "Projekte" };
  const list = r.opportunities.filter((o) => radarKind === "alle" || o.kind === radarKind);
  $app.replaceChildren(
    h("div", { class: "grid kpis" },
      h("div", { class: "card kpi accent" }, h("div", { class: "label" }, "Potenzial (Jahreswert)"), h("div", { class: "value" }, eur(r.total_annual)), h("div", { class: "sub" }, `${r.count} Chancen`)),
      h("div", { class: "card kpi" }, h("div", { class: "label" }, "Zusätzlicher MRR"), h("div", { class: "value" }, eur(r.total_monthly)), h("div", { class: "sub" }, "pro Monat, wiederkehrend")),
      h("div", { class: "card kpi" }, h("div", { class: "label" }, "Projektumsatz"), h("div", { class: "value" }, eur(r.total_once)), h("div", { class: "sub" }, "einmalig"))),
    h("div", { class: "tabs" }, Object.entries(kinds).map(([k, l]) => h("button", { class: radarKind === k ? "active" : "", onclick: () => { radarKind = k; render(); } }, l))),
    list.length ? h("div", { class: "stack" }, list.map((o) => h("div", { class: `card prio-${o.priority}` },
      h("div", { class: "row" }, h("strong", {}, o.title), badge(o.kind, "info"), h("span", { class: "spacer" }),
        o.once ? h("span", {}, eur(o.once)) : null, o.monthly ? h("strong", {}, `+${eur(o.monthly)}/Mon.`) : null),
      h("div", { class: "small", style: "margin:.3rem 0" }, h("a", { href: `#/kunde/${o.customer_id}` }, o.customer), " · ", o.reason),
      h("div", { class: "row" }, h("span", { class: "small muted" }, `Leistung: ${o.service}`), h("span", { class: "spacer" }),
        h("button", { class: "btn small primary", onclick: () => quoteCreate(o.customer_id, `${o.title}: ${o.reason}`, [o.service_code]) }, "Angebot erstellen"))))) :
      h("div", { class: "card empty" }, "Keine Chancen in dieser Kategorie."));
};

// ---- Angebote
async function quoteCreate(customerId = null, need = "", serviceCodes = []) {
  if (!state.customers.length) await loadCustomers();
  const f = form([
    { name: "customer_id", label: "Kunde", type: "select", options: customerOptions(), value: customerId ?? "" },
    { name: "need", label: "Bedarf (Stichworte aus dem Kundengespräch genügen)", type: "textarea", full: true, value: need,
      placeholder: "z. B. 15 PCs, Backup fehlt, Chef will Schutz vor Ransomware, Interesse an KI ohne Cloud" },
  ]);
  modal("Angebot mit KI erstellen", f, [
    (close) => h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
      const data = readForm(f);
      const q = await api("/api/agents/quote", { method: "POST", body: { customer_id: Number(data.customer_id), need: data.need, service_codes: serviceCodes } });
      close(); showQuote(q);
    }) }, "Angebot erstellen"),
  ]);
}

function showQuote(q) {
  modal(q.title, h("div", {}, q.error ? h("p", { class: "small", style: "color:var(--warn)" }, q.error) : null,
    h("p", { class: "small muted" }, `Erstellt mit: ${q.provider || "–"} · Positionen und Summen werden immer im Code berechnet.`), md(q.text)),
  [copyButton(() => q.text, "Text kopieren"), h("a", { class: "btn primary", href: "#/angebote" }, "Zu den Angeboten")]);
}

views.angebote = async () => {
  await loadCustomers();
  setTitle("Angebote", [h("button", { class: "btn primary", onclick: () => quoteCreate() }, "+ Angebot (KI)")]);
  const rows = await api("/api/quotes");
  const sum = (st) => rows.filter((r) => r.status === st).reduce((a, r) => a + r.total_monthly, 0);
  $app.replaceChildren(
    h("div", { class: "grid kpis" },
      h("div", { class: "card kpi" }, h("div", { class: "label" }, "Offen (versendet)"), h("div", { class: "value" }, eur(sum("versendet"))), h("div", { class: "sub" }, "MRR in Verhandlung")),
      h("div", { class: "card kpi" }, h("div", { class: "label" }, "Gewonnen"), h("div", { class: "value" }, eur(sum("angenommen"))), h("div", { class: "sub" }, "MRR aus angenommenen Angeboten"))),
    h("div", { class: "card" }, table([
      { label: "Datum", render: (r) => dt(r.created_at) },
      { label: "Kunde", key: "customer_name" },
      { label: "Titel", key: "title" },
      { label: "Einmalig", num: true, render: (r) => eur(r.total_once) },
      { label: "Monatlich", num: true, render: (r) => eur(r.total_monthly) },
      { label: "Status", render: (r) => {
        const sel = h("select", { onclick: (e) => e.stopPropagation(), onchange: async (e) => {
          try { await api(`/api/quotes/${r.id}`, { method: "PUT", body: { status: e.target.value } });
            toast(e.target.value === "angenommen" ? "Angenommen – MRR und Leistungen beim Kunden aktualisiert" : "Status gespeichert"); render(); }
          catch (err) { toast(err.message, true); }
        } }, ["entwurf", "versendet", "angenommen", "abgelehnt"].map((s) => h("option", { value: s, selected: s === r.status }, s)));
        return sel;
      } },
    ], rows, (r) => showQuote(r))));
};

// ---- Security
views.security = async (_, params) => {
  await loadCustomers();
  setTitle("Security- & NIS2-Check");
  const questions = await api("/api/security/questions");
  const preselect = params.get("kunde") || "";
  const customerSel = h("select", {}, customerOptions().map(([v, l]) => h("option", { value: v, selected: String(v) === preselect }, l)));
  const areas = [...new Set(questions.map((q) => q.area))];
  const qForm = h("form", { onsubmit: (e) => e.preventDefault() }, areas.map((area) => h("div", { class: "card", style: "margin-bottom:1rem" },
    h("h2", {}, area), questions.filter((q) => q.area === area).map((q) => h("div", { class: "question" },
      h("div", {}, q.question),
      h("div", { class: "seg" }, ["ja", "teilweise", "nein"].map((v) => h("label", {}, h("input", { type: "radio", name: q.id, value: v, checked: v === "nein" }), h("span", {}, v)))))))));
  const result = h("div");
  const submit = h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
    const answers = {};
    for (const q of questions) answers[q.id] = qForm.querySelector(`input[name="${q.id}"]:checked`)?.value || "nein";
    const r = await api("/api/security/assess", { method: "POST", body: { customer_id: Number(customerSel.value), answers } });
    result.replaceChildren(h("div", { class: "card", style: "margin-bottom:1rem" },
      h("div", { class: "row" }, h("div", { class: "score" }, `${Math.round(r.score)}`), h("div", {}, h("div", { class: "muted" }, "von 100 Punkten"), badge(r.level)),
        h("span", { class: "spacer" }), copyButton(() => r.report, "Bericht kopieren"),
        h("button", { class: "btn primary", onclick: () => quoteCreate(Number(customerSel.value), `Maßnahmen aus Security-Check: ${r.gaps.slice(0, 5).map((g) => g.fix).join("; ")}`, r.recommended_services) }, "Angebot für Maßnahmen")),
      h("div", { class: "bar", style: "margin:.8rem 0" }, h("span", { style: `width:${r.score}%` })),
      md(r.report)));
    result.scrollIntoView({ behavior: "smooth" });
  }) }, "Auswerten");
  $app.replaceChildren(
    h("div", { class: "card", style: "margin-bottom:1rem" },
      h("p", { class: "muted small", style: "margin-top:0" }, "15 Fragen nach NIS2 Art. 21 / NISG 2026 – ideal als Gesprächsleitfaden beim Kunden. Ergebnis mit priorisierten Maßnahmen und passenden Leistungen."),
      h("div", { class: "row" }, h("label", { style: "margin:0" }, "Kunde:"), h("div", { style: "min-width:260px" }, customerSel))),
    result, qForm, h("div", { class: "row" }, h("span", { class: "spacer" }), submit));
};

// ---- Training
views.training = async () => {
  setTitle("KI-Training (eigenes ME-IT-Modell)");
  const s = await api("/api/training/stats");
  $app.replaceChildren(
    h("div", { class: "grid kpis" },
      h("div", { class: "card kpi" }, h("div", { class: "label" }, "Trainingsbeispiele"), h("div", { class: "value" }, s.examples), h("div", { class: "sub" }, `${s.from_tickets} aus Tickets · ${s.from_kb} aus Wissen`))),
    h("div", { class: "grid two" },
      h("div", { class: "card" }, h("h2", {}, "Einschätzung"), h("p", {}, s.advice),
        h("p", { class: "small muted" }, "Namen, E-Mails, Telefonnummern, IBANs und öffentliche IPs werden beim Export automatisch pseudonymisiert. Trotzdem vor dem Training stichprobenartig prüfen (DSGVO)."),
        h("a", { class: "btn primary", href: "/api/training/export", download: "" }, "Trainingsdaten exportieren (JSONL)")),
      h("div", { class: "card" }, h("h2", {}, "So trainierst du dein Modell"), md([
        "1. **Erst RAG, dann Training:** Fachwissen gehört in die Wissensdatenbank. Feintuning lohnt sich für Stil, Format und Einordnung.",
        "2. JSONL exportieren und auf den KI-PC kopieren (`training/data.jsonl`).",
        "3. Training starten (GPU, z. B. RTX 5090):",
        "```",
        "pip install -r requirements-training.txt",
        "python training/finetune_lora.py --data training/data.jsonl",
        "```",
        "4. In Ollama importieren: `ollama create meit-assistent -f training/output/Modelfile`",
        "5. In `.env` setzen: `OLLAMA_MODEL=meit-assistent` – fertig.",
        "",
        "Details und Hardware-Empfehlung: `docs/OFFLINE-KI-PC.md`",
      ].join("\n")))));
};

// ---- Einstellungen
views.einstellungen = async () => {
  setTitle("Einstellungen");
  const [s, services, log] = await Promise.all([api("/api/settings"), api("/api/services"), api("/api/agents/log?limit=30")]);
  state.services = services;
  const llm = s.llm;
  $app.replaceChildren(
    h("div", { class: "grid two" },
      h("div", { class: "card" }, h("h2", {}, "KI-Konfiguration"),
        table([{ label: "Einstellung", key: "k" }, { label: "Wert", render: (r) => r.v }], [
          { k: "Provider", v: s.llm_provider },
          { k: "Aktiv", v: llm.active_provider === "none" ? badge("keine KI – Regeln aktiv", "warn") : badge(`${llm.active_provider} · ${llm.active_model}`, "ok") },
          { k: "Status", v: llm.primary.detail },
          { k: "Ollama", v: `${s.ollama_url} · ${s.ollama_model}` },
          { k: "Embeddings", v: s.embed_model },
          { k: "Cloud-Fallback", v: s.allow_cloud_fallback ? badge("erlaubt", "warn") : badge("aus (DSGVO-sicher)", "ok") },
          { k: "Installierte Modelle", v: llm.installed_models.length ? llm.installed_models.join(", ") : "–" },
          { k: "Datenbank", v: s.db_path },
          { k: "Passwortschutz", v: s.password_protected ? "aktiv" : "aus (nur lokal betreiben!)" },
        ]),
        h("p", { class: "small muted" }, "Änderungen in der Datei .env im Projektordner, danach App neu starten. Vorlage: .env.example")),
      h("div", { class: "card" }, h("h2", {}, "Schnellstart Offline-KI"), md([
        "```",
        "ollama pull qwen3:14b     # Chat/Agenten (Deutsch gut)",
        "ollama pull bge-m3        # semantische Suche",
        "```",
        "Schwächerer PC: `qwen3:8b` · RTX 5090: `qwen3:32b` testen.",
        "Modell in `.env` über `OLLAMA_MODEL` wählen.",
      ].join("\n")))),
    h("div", { class: "card", style: "margin-top:1rem" },
      h("div", { class: "card-head" }, h("h2", {}, "Leistungskatalog & Preise"), h("button", { class: "btn small", onclick: () => serviceForm() }, "+ Leistung")),
      h("p", { class: "small muted" }, "Grundlage für Umsatz-Radar und Angebots-Agent. Beispielpreise – bitte an deine Kalkulation anpassen."),
      table([
        { label: "Code", key: "code" }, { label: "Leistung", key: "name" }, { label: "Einheit", key: "unit" },
        { label: "Preis", num: true, render: (r) => eur2(r.price) },
        { label: "Art", render: (r) => badge(r.recurring ? "monatlich" : "einmalig", r.recurring ? "ok" : "") },
        { label: "Aktiv", render: (r) => (r.active ? "ja" : "nein") },
      ], services, (r) => serviceForm(r))),
    h("div", { class: "card", style: "margin-top:1rem" }, h("h2", {}, "Agenten-Protokoll (Nachvollziehbarkeit / AI Act)"),
      table([
        { label: "Zeit", render: (r) => r.created_at }, { label: "Agent", key: "agent" }, { label: "Provider", key: "provider" },
        { label: "Eingabe", render: (r) => h("span", { class: "small" }, (r.input || "").slice(0, 90)) },
        { label: "OK", render: (r) => badge(r.ok ? "ok" : "Fallback", r.ok ? "ok" : "warn") },
      ], log)));
};

function serviceForm(svc = null) {
  const f = form([
    { name: "code", label: "Code", required: true }, { name: "name", label: "Name", required: true },
    { name: "unit", label: "Einheit", placeholder: "User/Monat, Gerät, Pauschal …" },
    { name: "price", label: "Preis netto (€)", type: "number", step: "0.01" },
    { name: "recurring", label: "Monatlich wiederkehrend", type: "checkbox" },
    { name: "active", label: "Aktiv", type: "checkbox", value: true },
    { name: "description", label: "Beschreibung", full: true },
    { name: "keywords", label: "Stichworte (für Angebots-Agent)", full: true },
  ], svc ? { ...svc, recurring: !!svc.recurring, active: !!svc.active } : {});
  modal(svc ? "Leistung bearbeiten" : "Neue Leistung", f, [
    (close) => h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
      await api(svc ? `/api/services/${svc.id}` : "/api/services", { method: svc ? "PUT" : "POST", body: readForm(f) });
      close(); toast("Gespeichert"); render();
    }) }, "Speichern"),
  ]);
}

// ---------------------------------------------------------------- Router
async function render() {
  const hash = location.hash.replace(/^#\/?/, "") || "dashboard";
  const [path, query] = hash.split("?");
  const [route, id] = path.split("/");
  const params = new URLSearchParams(query || "");
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.route === route || (route === "kunde" && a.dataset.route === "kunden")));
  document.getElementById("sidebar").classList.remove("open");
  const view = views[route] || views.dashboard;
  try { await view(id, params); }
  catch (e) { $app.replaceChildren(h("div", { class: "card empty" }, `Fehler: ${e.message}`)); }
}

document.getElementById("menu-btn").addEventListener("click", () => document.getElementById("sidebar").classList.toggle("open"));
window.addEventListener("hashchange", render);
render();
refreshAiStatus();
setInterval(refreshAiStatus, 30000);
