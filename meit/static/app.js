/* ME-IT Cockpit – Weboberfläche (ohne Build-Schritt, ohne externe Abhängigkeiten). */
"use strict";

// ---------------------------------------------------------------- Helfer
const $app = document.getElementById("app");
const state = { customers: [], services: [], chat: [], km: null, auth: null, users: [] };
/** Inhalt der Hauptfläche setzen (null/false-Einträge werden ignoriert). */
const show = (...nodes) => $app.replaceChildren(...nodes.flat().filter((x) => x !== null && x !== undefined && x !== false && x !== ""));

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
  if (res.status === 401 && state.auth && state.auth.login_required && !path.startsWith("/api/auth/")) {
    showLogin();
    throw new Error("Bitte anmelden.");
  }
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
  kmOverview();
}

// ---------------------------------------------------------------- Ansichten
const views = {};

views.dashboard = async () => {
  setTitle("Übersicht", [h("button", { class: "btn", onclick: (e) => withBusy(e.target, showBriefing) }, "Wochenbriefing (KI)"),
    h("a", { class: "btn cta", href: "#/tickets?neu=1" }, "+ Ticket")]);
  const [d, km, pay, wt] = await Promise.all([api("/api/dashboard"), api("/api/ki-mitarbeiter/overview").catch(() => null),
    api("/api/payments/summary").catch(() => null), api("/api/maintenance").catch(() => null)]);
  const kpi = (label, value, sub, cls = "", href = null, onclick = null) => h(href ? "a" : "div", { class: `card kpi ${cls}`, href, onclick, style: href ? "text-decoration:none;color:inherit" : null },
    h("div", { class: "label" }, label), h("div", { class: "value" }, value), h("div", { class: "sub" }, sub));
  const nrrVal = d.nrr && d.nrr.nrr !== null ? `${d.nrr.nrr.toLocaleString("de-AT")} %` : "–";
  const share = d.recurring_share && d.recurring_share.share !== null ? `${Math.round(d.recurring_share.share)} %` : "–";
  show(
    h("div", { class: "grid kpis" },
      kpi("Net Revenue Retention", nrrVal, d.nrr && d.nrr.nrr !== null ? "Ziel: über 100 % (Bestand wächst)" : "Verlauf wird aufgezeichnet", "", "#/wachstum"),
      kpi("Anteil wiederkehrend", share, "Ziel: über 60 %", "", "#/wachstum"),
      kpi("Kunden-Health", `${d.health.counts.risiko} Risiko`, `${d.health.counts.beobachten} beobachten · ${d.health.counts.gesund} gesund`, d.health.counts.risiko ? "" : "", "#/wachstum"),
      kpi("Unverrechnet", eur(d.unbilled_value), "Stunden + Projekte → Rechnungslauf", d.unbilled_value > 0 ? "" : "", "#/abrechnung"),
      pay ? kpi("Offene Forderungen", eur(pay.open_total), `${eur(pay.overdue_total)} überfällig · ${pay.dunning_due} Mahnvorschläge${pay.missing_receipts ? ` · ${pay.missing_receipts} ohne Beleg` : ""}`, "",
        "#/abrechnung", () => { billingTab = "zahlungen"; }) : null,
      km ? kpi("KI-Mitarbeiter", `${km.pending_approval} Freigaben`, `${km.unprocessed} neu · ca. ${(Math.round(km.minutes_saved / 6) / 10).toLocaleString("de-AT")} h gespart (7 Tage)`, "", "#/posteingang") : null),
    h("div", { class: "grid kpis" },
      kpi("Wiederkehrender Umsatz", eur(d.mrr), `pro Monat · ${eur(d.mrr * 12)} pro Jahr`),
      kpi("Kunden", d.customers, `${d.managed_customers} mit Managed-Vertrag`),
      kpi("Offene Tickets", d.open_tickets, `${d.critical_tickets} dringend · ${d.sla.breached_open} SLA verletzt`, d.sla.breached_open ? "" : "", "#/sla"),
      kpi("Geräte ohne Support", d.assets_eol, `${d.assets_eol_soon} bald · ${d.warranty_soon} Garantie < 90 Tage`),
      wt ? kpi("Wartung", `${wt.open} fällig`, wt.tasks ? `${wt.overdue} überfällig · ${wt.done_this_month} erledigt (Monat)` : `${wt.customers_without_plan} Managed-Kunden ohne Plan`, "", "#/wartung") : null,
      kpi("Umsatz-Potenzial", eur(d.radar_annual), `${d.radar_count} Chancen · +${eur(d.radar_monthly)}/Monat`, "accent")),
    h("div", { class: "grid two" },
      h("div", { class: "card" },
        h("div", { class: "card-head" }, h("h2", {}, "Top-Verkaufschancen"), h("a", { class: "btn small", href: "#/radar" }, "Alle anzeigen")),
        d.top_opportunities.length ? h("ul", { class: "list" }, d.top_opportunities.map((o) => h("li", {},
          h("div", { class: "row" }, h("strong", {}, o.title), h("span", { class: "spacer" }),
            h("span", { class: "small" }, o.monthly ? `+${eur(o.monthly)}/Mon.` : eur(o.once))),
          h("div", { class: "small muted" }, `${o.customer} · ${o.reason}`)))) : h("div", { class: "empty" }, "Keine offenen Chancen.")),
      h("div", { class: "stack" },
        d.renewals && d.renewals.length ? h("div", { class: "card" },
          h("div", { class: "card-head" }, h("h2", {}, "Lizenzen: Verlängerung/Frist"), h("a", { class: "btn small", href: "#/lizenzen" }, "Alle")),
          h("ul", { class: "list" }, d.renewals.map((r) => h("li", { class: "row" }, h("span", {}, h("strong", {}, r.name), h("span", { class: "small muted" }, ` · ${r.customer_name}`)),
            h("span", { class: "spacer" }), badge(r.state === "kündigungsfrist" ? `Frist ${dt(r.notice_deadline)}` : dt(r.next_renewal), SUB_STATE[r.state]))))) : null,
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
  show(h("div", { class: "card" }, table([
    { label: "Kunde", render: (r) => h("strong", {}, r.name) },
    { label: "Branche", key: "industry" },
    { label: "MA", key: "employees", num: true },
    { label: "Paket", render: (r) => badge(r.package, r.package === "keins" ? "warn" : "info") },
    { label: "MRR", num: true, render: (r) => eur(r.mrr) },
    { label: "Health", render: (r) => badge(`${r.health_score} ${r.health_status}`, r.health_status) },
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
    { name: "uid", label: "UID-Nummer (für Rechnungen)" },
    { name: "supplier_no", label: "Unsere Lieferantennummer beim Kunden (E-Rechnung)" },
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
      modal("Monatsbericht", h("div", {}, h("p", { class: "small muted" }, `Erstellt mit: ${r.provider}`), md(r.text)),
        [copyButton(() => r.text), archiveButton(`Monatsbericht ${r.month} – ${c.name}`, () => r.text, c.id, "bericht")]);
    }) }, "Monatsbericht (KI)"),
    h("a", { class: "btn", href: `#/security?kunde=${c.id}` }, "Security-Check"),
    h("button", { class: "btn", onclick: (e) => withBusy(e.target, async () => {
      const r = await api("/api/agents/qbr", { method: "POST", body: { customer_id: c.id } });
      modal("Quartalsgespräch (QBR)", h("div", {}, h("p", { class: "small muted" }, `Erstellt mit: ${r.provider}`), md(r.text)),
        [copyButton(() => r.text), archiveButton(`QBR ${r.period || ""} – ${c.name}`.replace("  ", " "), () => r.text, c.id, "qbr")]);
      render();
    }) }, "QBR erstellen (KI)"),
    h("button", { class: "btn primary", onclick: () => quoteCreate(c.id) }, "Angebot (KI)"),
  ]);
  const health = h("div", { class: "card", style: "margin-bottom:1rem" },
    h("div", { class: "card-head" }, h("h2", {}, "Health Score"), badge(`${c.health.score}/100 ${c.health.status}`, c.health.status)),
    h("div", { class: "bar", style: "margin-bottom:.7rem" }, h("span", { style: `width:${c.health.score}%` })),
    h("div", { class: "row small" }, c.health.factors.map((f) => h("span", { class: `badge ${f.delta > 0 ? "ok" : "warn"}` }, `${f.delta > 0 ? "+" : ""}${f.delta} ${f.text}`))),
    c.qbrs.length ? h("p", { class: "small muted", style: "margin-bottom:0" }, "Letzte QBRs: ",
      c.qbrs.slice(0, 4).map((q) => h("a", { href: "#", style: "margin-right:.6rem", onclick: async (e) => {
        e.preventDefault(); const full = await api(`/api/qbrs/${q.id}`);
        modal(`QBR ${q.period}`, md(full.text), [copyButton(() => full.text), archiveButton(`QBR ${q.period} – ${c.name}`, () => full.text, c.id, "qbr")]);
      } }, `${q.period} (${dt(q.created_at)})`))) : h("p", { class: "small muted", style: "margin-bottom:0" }, "Noch kein Quartalsgespräch – Health Score und nächste Hebel machen daraus ein Strategiegespräch statt Nachverhandlung."));
  show(
    h("div", { class: "grid kpis" },
      h("div", { class: "card kpi" }, h("div", { class: "label" }, "Paket / MRR"), h("div", { class: "value" }, eur(c.mrr)), h("div", { class: "sub" }, `Paket: ${c.package}`)),
      h("div", { class: "card kpi" }, h("div", { class: "label" }, "Mitarbeiter"), h("div", { class: "value" }, c.employees), h("div", { class: "sub" }, c.industry || "–")),
      h("div", { class: "card kpi" }, h("div", { class: "label" }, "Kontakt"), h("div", { style: "font-weight:600;margin-top:.3rem" }, c.contact_name || "–"),
        h("div", { class: "sub" }, [c.email, c.phone].filter(Boolean).join(" · "))),
      h("div", { class: "card kpi" }, h("div", { class: "label" }, "Gebuchte Leistungen"), h("div", { class: "row", style: "margin-top:.4rem" },
        c.booked_services.length ? c.booked_services.map((s) => badge(s, "info")) : h("span", { class: "muted" }, "keine")))),
    health,
    c.notes ? h("div", { class: "card", style: "margin-bottom:1rem" }, h("strong", {}, "Notizen: "), c.notes) : null,
    await portalCard(c),
    await (async () => { const subs = await api(`/api/subscriptions?customer_id=${c.id}`).catch(() => []);
      return h("div", { class: "card", style: "margin-bottom:1rem" }, h("div", { class: "card-head" }, h("h2", {}, "Lizenzen & Verträge"),
        h("button", { class: "btn small", onclick: () => subscriptionForm(null, c.id) }, "+ Lizenz/Vertrag")),
        subs.length ? subscriptionTable(subs, false) : h("p", { class: "small muted", style: "margin:0" }, "Noch keine Lizenzen erfasst (M365, Virenschutz, Domains, Zertifikate, Wartung …).")); })(),
    await maintenanceCard(c),
    await (async () => { const docs = await api(`/api/documents?customer_id=${c.id}&limit=50`).catch(() => []);
      return h("div", { class: "card", style: "margin-bottom:1rem" }, h("div", { class: "card-head" }, h("h2", {}, `Dokumente (${docs.length})`),
        h("a", { class: "btn small", href: "#/dokumente" }, "Alle Dokumente")),
        docs.length ? docsTable(docs, false) : h("p", { class: "small muted", style: "margin:0" }, "Noch keine Dokumente – Rechnungen, Angebote und Berichte landen hier automatisch als PDF (und in SharePoint/OneDrive, falls eingerichtet).")); })(),
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
        modal("Security-Bericht", md(a.report), [copyButton(() => a.report), archiveButton(`Security-Check ${dt(a.created_at)} – ${c.name}`, () => a.report, c.id, "bericht")]);
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
  const query = ticketFilter === "offen" ? "?open_only=true" : ticketFilter === "geloest" ? "?status=geloest" : ticketFilter === "meine" ? "?open_only=true&mine=true" : "";
  const rows = await api(`/api/tickets${query}`);
  const tabs = h("div", { class: "tabs" }, [["offen", "Offen"], ...(state.auth && state.auth.user ? [["meine", "Meine"]] : []), ["alle", "Alle"], ["geloest", "Gelöst"]].map(([k, l]) =>
    h("button", { class: ticketFilter === k ? "active" : "", onclick: () => { ticketFilter = k; render(); } }, l)));
  show(tabs, h("div", { class: "card" }, table([
    { label: "#", key: "id" },
    { label: "Titel", render: (r) => h("div", {}, h("strong", {}, r.title), r.ai_suggestion?.summary && r.ai_suggestion.summary !== r.title
      ? h("div", { class: "small muted" }, r.ai_suggestion.summary) : null) },
    { label: "Kunde", render: (r) => r.customer_name || "–" },
    { label: "Kategorie", render: (r) => r.category || "–" },
    ...(state.users.length ? [{ label: "Zuständig", render: (r) => r.assigned_name || "–" }] : []),
    { label: "Priorität", render: (r) => badge(r.priority) },
    { label: "SLA", render: (r) => slaBadge(r.sla) },
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
    ...(state.users.length ? [{ name: "assigned_to", label: "Zuständig", type: "select", options: userOptions(), value: t.assigned_to || 0 }] : []),
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
    t.customer_id ? (close) => h("button", { class: "btn", onclick: () => { close(); timeForm({ ticket_id: t.id, description: t.title }); } }, "Zeit buchen") : null,
    (close) => h("button", { class: "btn", onclick: (e) => withBusy(e.target, async () => {
      await api(`/api/tickets/${t.id}/triage`, { method: "POST" }); close(); ticketDetail(t.id); render();
    }) }, s ? "KI-Triage erneut" : "KI-Triage starten"),
    (close) => h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
      const body = readForm(edit); if ("assigned_to" in body) body.assigned_to = Number(body.assigned_to);
      await api(`/api/tickets/${t.id}`, { method: "PUT", body }); close(); toast("Gespeichert"); render();
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
  show(h("div", { class: "row", style: "margin-bottom:1rem" }, select, h("span", { class: "spacer" }),
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
      h("summary", { style: "cursor:pointer" }, h("strong", {}, a.title), " ", a.public ? badge("Portal", "ok") : null, " ", a.tags ? h("span", { class: "small muted" }, `· ${a.tags}`) : null,
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
  show(h("div", { class: "card", style: "margin-bottom:1rem" }, search), results);
};

function articleForm(a = null) {
  const f = form([
    { name: "title", label: "Titel", required: true, full: true },
    { name: "tags", label: "Schlagworte", full: true, placeholder: "drucker, windows" },
    { name: "content", label: "Inhalt (Markdown)", type: "textarea", rows: 14, full: true },
    { name: "public", label: "Im Kundenportal für die KI-Hilfe freigeben (nur Anleitungen ohne Admin-Schritte/Interna)", type: "checkbox", full: true },
  ], a ? { ...a, public: !!a.public } : {});
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
  show(h("div", { class: "card chat" },
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
  show(
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
    { name: "tiers", label: "3 Pakete anbieten: Premium als Anker → Einstieg → Empfehlung (Value-Based Pricing)", type: "checkbox", value: true, full: true },
  ]);
  modal("Angebot mit KI erstellen", f, [
    (close) => h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
      const data = readForm(f);
      const q = await api("/api/agents/quote", { method: "POST", body: { customer_id: Number(data.customer_id), need: data.need, service_codes: serviceCodes, tiers: data.tiers } });
      close(); showQuote(q);
    }) }, "Angebot erstellen"),
  ]);
}

function showQuote(q) {
  const open = !["angenommen", "abgelehnt"].includes(q.status || "entwurf");
  modal(q.title, h("div", {}, q.error ? h("p", { class: "small", style: "color:var(--warn)" }, q.error) : null,
    h("p", { class: "small muted" }, `Erstellt mit: ${q.provider || "–"} · Positionen und Summen werden immer im Code berechnet.`), md(q.text)),
  [copyButton(() => q.text, "Text kopieren"),
    h("a", { class: "btn small", href: `/api/quotes/${q.id}/pdf`, target: "_blank", rel: "noopener" }, "PDF"),
    open ? (close) => h("button", { class: "btn small", onclick: () => { close(); sendDocModal("quote", q.id, "Angebot"); } }, "Per Mail senden") : null,
    location.hash.startsWith("#/angebote") ? null : h("a", { class: "btn primary", href: "#/angebote" }, "Zu den Angeboten")].filter(Boolean));
}

views.angebote = async () => {
  await loadCustomers();
  setTitle("Angebote", [h("button", { class: "btn primary", onclick: () => quoteCreate() }, "+ Angebot (KI)")]);
  const rows = await api("/api/quotes");
  const sum = (st) => rows.filter((r) => r.status === st).reduce((a, r) => a + r.total_monthly, 0);
  show(
    h("div", { class: "grid kpis" },
      h("div", { class: "card kpi" }, h("div", { class: "label" }, "Offen (versendet)"), h("div", { class: "value" }, eur(sum("versendet"))), h("div", { class: "sub" }, "MRR in Verhandlung")),
      h("div", { class: "card kpi" }, h("div", { class: "label" }, "Gewonnen"), h("div", { class: "value" }, eur(sum("angenommen"))), h("div", { class: "sub" }, "MRR aus angenommenen Angeboten"))),
    h("div", { class: "card" }, table([
      { label: "Datum", render: (r) => dt(r.created_at) },
      { label: "Kunde", key: "customer_name" },
      { label: "Titel", render: (r) => h("div", {}, r.title, (r.tiers || []).length ? h("div", { class: "small muted" },
        r.chosen_tier ? `Paket: ${(r.tiers.find((t) => t.key === r.chosen_tier) || {}).label || r.chosen_tier}` : `${r.tiers.length} Pakete`) : null) },
      { label: "Einmalig", num: true, render: (r) => eur(r.total_once) },
      { label: "Monatlich", num: true, render: (r) => eur(r.total_monthly) },
      { label: "Status", render: (r) => {
        const save = async (status, tier = null) => {
          try { await api(`/api/quotes/${r.id}`, { method: "PUT", body: { status, tier } });
            toast(status === "angenommen" ? "Angenommen – MRR und Leistungen beim Kunden aktualisiert" : "Status gespeichert"); render(); }
          catch (err) { toast(err.message, true); render(); }
        };
        const sel = h("select", { onclick: (e) => e.stopPropagation(), onchange: (e) => {
          if (e.target.value === "angenommen" && (r.tiers || []).length && r.status !== "angenommen") {
            modal("Welches Paket wurde beauftragt?", h("div", { class: "stack" }, r.tiers.map((t) => h("button", { class: `btn ${t.recommended ? "primary" : ""}`, style: "width:100%;justify-content:space-between",
              onclick: () => { document.querySelector(".modal-backdrop")?.remove(); save("angenommen", t.key); } },
              h("span", {}, t.label), h("span", {}, `${eur(t.total_once)} + ${eur(t.total_monthly)}/Mon.`)))));
            return;
          }
          save(e.target.value);
        } }, ["entwurf", "versendet", "angenommen", "abgelehnt"].map((s) => h("option", { value: s, selected: s === r.status }, s)));
        return sel;
      } },
      { label: "", render: (r) => h("div", { class: "row", style: "justify-content:flex-end;flex-wrap:nowrap" },
        h("a", { class: "btn small", href: `/api/quotes/${r.id}/pdf`, target: "_blank", rel: "noopener", onclick: (e) => e.stopPropagation() }, "PDF"),
        ["entwurf", "versendet"].includes(r.status) ? h("button", { class: "btn small", title: r.sent_at ? `versendet am ${dt(r.sent_at)}` : "", onclick: (e) => { e.stopPropagation(); sendDocModal("quote", r.id, "Angebot"); } }, r.status === "versendet" ? "Erneut senden" : "Senden") : null) },
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
        archiveButton(`Security- & NIS2-Check – ${customerSel.selectedOptions[0]?.textContent || ""}`, () => r.report, Number(customerSel.value), "bericht"),
        h("button", { class: "btn primary", onclick: () => quoteCreate(Number(customerSel.value), `Maßnahmen aus Security-Check: ${r.gaps.slice(0, 5).map((g) => g.fix).join("; ")}`, r.recommended_services) }, "Angebot für Maßnahmen")),
      h("div", { class: "bar", style: "margin:.8rem 0" }, h("span", { style: `width:${r.score}%` })),
      md(r.report)));
    result.scrollIntoView({ behavior: "smooth" });
  }) }, "Auswerten");
  show(
    h("div", { class: "card", style: "margin-bottom:1rem" },
      h("p", { class: "muted small", style: "margin-top:0" }, "15 Fragen nach NIS2 Art. 21 / NISG 2026 – ideal als Gesprächsleitfaden beim Kunden. Ergebnis mit priorisierten Maßnahmen und passenden Leistungen."),
      h("div", { class: "row" }, h("label", { style: "margin:0" }, "Kunde:"), h("div", { style: "min-width:260px" }, customerSel))),
    result, qForm, h("div", { class: "row" }, h("span", { class: "spacer" }), submit));
};

// ---- Training
views.training = async () => {
  setTitle("KI-Training (eigenes ME-IT-Modell)");
  const s = await api("/api/training/stats");
  show(
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
  await loadUsers(true);
  state.services = services;
  const llm = s.llm;
  show(
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
    h("div", { class: "card", style: "margin-top:1rem" },
      h("div", { class: "card-head" }, h("h2", {}, "Benutzer & Rollen"), h("button", { class: "btn small", onclick: () => userForm() }, "+ Benutzer")),
      h("p", { class: "small muted" }, state.auth && state.auth.login_required
        ? "Anmeldung ist aktiv. Admins verwalten Benutzer, Preise, Import und Sicherung; Technik und Vertrieb arbeiten im Tagesgeschäft."
        : "Noch kein Benutzer angelegt – das Cockpit ist offen (Einzelplatz). Sobald du den ersten Benutzer (Admin) anlegst, ist eine Anmeldung Pflicht."),
      table([{ label: "Name", key: "name" }, { label: "E-Mail", key: "email" }, { label: "Rolle", render: (r) => badge((state.auth.roles || {})[r.role] || r.role, r.role === "admin" ? "info" : "") },
        { label: "Aktiv", render: (r) => (r.active ? "ja" : "nein") }, { label: "Letzte Anmeldung", render: (r) => r.last_login_at || "–" }], state.allUsers || [], (r) => userForm(r))),
    await brandingCard(),
    await docsSettingsCard(),
    state.users.length ? await routingCard() : null,
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

// ---- KI-Mitarbeiter: Posteingang
const CAT_LABEL = { support: "Support", anfrage: "Anfrage", termin: "Termin", beleg: "Beleg", info: "Info", nachfassen: "Nachfassen" };
const MSG_STATUS = { neu: "neu", freigabe: "Freigabe", beantwortet: "beantwortet", erledigt: "erledigt", gesendet: "gesendet", manuell: "manuell erledigt", ignoriert: "ignoriert" };
let inboxTab = "freigabe";

async function kmOverview() {
  try { state.km = await api("/api/ki-mitarbeiter/overview"); } catch { state.km = null; }
  const b = document.getElementById("inbox-badge");
  if (b && state.km) { const n = state.km.pending_approval + state.km.unprocessed; b.hidden = !n; b.textContent = n; }
  return state.km;
}

function manualMessageForm() {
  const f = form([
    { name: "from_name", label: "Name" }, { name: "from_email", label: "E-Mail", type: "email" },
    { name: "company", label: "Firma" }, { name: "phone", label: "Telefon" },
    { name: "channel", label: "Kanal", type: "select", options: [["manuell", "manuell"], ["telefon", "Telefonnotiz"], ["email", "E-Mail (eingefügt)"]] },
    { name: "subject", label: "Betreff", full: true },
    { name: "body", label: "Nachricht / Telefonnotiz", type: "textarea", rows: 8, full: true, placeholder: "E-Mail-Text einfügen oder Telefonnotiz schreiben …" },
  ]);
  modal("Nachricht erfassen", f, [
    (close) => h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
      const m = await api("/api/inbox", { method: "POST", body: { ...readForm(f), process: true } });
      close(); toast(`Eingeordnet als: ${CAT_LABEL[m.category] || m.category}`); await render(); messageDetail(m.id);
    }) }, "Erfassen & vom KI-Mitarbeiter bearbeiten lassen"),
  ]);
}

views.posteingang = async () => {
  const km = await kmOverview();
  setTitle("Posteingang", [
    h("button", { class: "btn", onclick: () => voiceNoteForm() }, "Sprachnotiz"),
    h("button", { class: "btn", onclick: () => manualMessageForm() }, "+ Nachricht erfassen"),
    h("button", { class: "btn", onclick: (e) => withBusy(e.target, async () => {
      const r = await api("/api/agents/followups", { method: "POST" });
      toast(r.created ? `${r.created} Nachfass-Entwurf/Entwürfe zur Freigabe angelegt` : "Nichts nachzufassen"); render();
    }) }, "Nachfassen prüfen"),
    h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
      const r = await api("/api/inbox/fetch", { method: "POST" });
      toast(`${r.new} neue E-Mail(s) abgerufen und bearbeitet`); render();
    }) }, "Postfach abrufen"),
  ]);
  const query = { freigabe: "?status=freigabe", neu: "?status=neu", erledigt: "?status=beantwortet,erledigt,gesendet,manuell,ignoriert", alle: "" }[inboxTab];
  const rows = await api(`/api/inbox${query}`);
  const tabs = h("div", { class: "tabs" }, [["freigabe", `Zur Freigabe (${km ? km.pending_approval : "?"})`], ["neu", `Neu (${km ? km.unprocessed : "?"})`], ["erledigt", "Erledigt"], ["alle", "Alle"]].map(([k, l]) =>
    h("button", { class: inboxTab === k ? "active" : "", onclick: () => { inboxTab = k; render(); } }, l)));
  const banner = km && km.unprocessed ? h("div", { class: "card", style: "margin-bottom:1rem;display:flex;gap:1rem;align-items:center;flex-wrap:wrap" },
    h("div", { style: "flex:1;min-width:220px" }, h("strong", {}, `${km.unprocessed} neue Nachricht(en)`), h("div", { class: "small muted" }, "Der KI-Mitarbeiter sortiert, liest Daten aus, legt Tickets/Leads/Belege an und schreibt Antwortentwürfe.")),
    h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
      const r = await api("/api/inbox/process-new", { method: "POST" }); toast(`${r.processed} Nachricht(en) bearbeitet`); inboxTab = "freigabe"; render();
    }) }, "Jetzt bearbeiten lassen")) : null;
  show(banner || "", tabs, h("div", { class: "card" }, table([
    { label: "Art", render: (r) => r.direction === "out" ? badge("Entwurf → raus", "info") : (r.category ? badge(CAT_LABEL[r.category] || r.category, "info") : badge("neu")) },
    { label: "Von / An", render: (r) => r.direction === "out" ? `An: ${r.to_email}` : h("div", {}, h("strong", {}, r.from_name || r.from_email || "–"),
      h("div", { class: "small muted" }, [r.company || r.customer_name, r.from_email].filter(Boolean).join(" · "))) },
    { label: "Betreff", render: (r) => h("div", {}, r.subject || "(ohne Betreff)", r.ai_result && r.ai_result.summary && r.ai_result.summary !== r.subject
      ? h("div", { class: "small muted" }, r.ai_result.summary) : null) },
    { label: "Kanal", key: "channel" },
    { label: "Status", render: (r) => badge(MSG_STATUS[r.status] || r.status, r.status) },
    { label: "Eingang", render: (r) => dt(r.created_at) },
  ], rows, (r) => messageDetail(r.id))));
};

async function messageDetail(id) {
  const m = await api(`/api/inbox/${id}`);
  const km = state.km || await kmOverview();
  const smtp = km && km.mail && km.mail.smtp;
  const ai = m.ai_result || {};
  const incoming = m.direction === "in";
  const replyCats = ["support", "anfrage", "termin"];
  const needsText = !incoming || (replyCats.includes(m.category) && m.from_email);
  const reply = h("textarea", { rows: 10 }, incoming ? (m.draft_reply || "") : (m.body || ""));
  const linkBtn = (() => {
    if (!m.linked_type) return null;
    if (m.linked_type === "ticket") return h("button", { class: "btn small", onclick: () => ticketDetail(m.linked_id) }, `Ticket #${m.linked_id} öffnen`);
    if (m.linked_type === "lead") return h("a", { class: "btn small", href: "#/leads" }, `Lead #${m.linked_id}`);
    if (m.linked_type === "receipt") return h("a", { class: "btn small", href: "#/belege" }, `Beleg #${m.linked_id}`);
    if (m.linked_type === "quote") return h("a", { class: "btn small", href: "#/angebote" }, `Angebot #${m.linked_id}`);
    return null;
  })();
  const q = ai.qualification || {};
  const rc = ai.receipt || {};
  const analysis = incoming && m.category ? h("div", { class: "card", style: "background:var(--surface-2);margin:1rem 0" },
    h("div", { class: "card-head" }, h("h3", { style: "margin:0" }, "Analyse des KI-Mitarbeiters"), h("span", { class: "small muted" }, ai.provider || "")),
    ai.error ? h("p", { class: "small", style: "color:var(--warn)" }, ai.error) : null,
    h("div", { class: "row" }, badge(CAT_LABEL[m.category] || m.category, "info"), ai.urgency && ai.urgency !== "normal" ? badge(`Dringlichkeit: ${ai.urgency}`, ai.urgency === "hoch" ? "hoch" : "") : null,
      ai.lead_score !== undefined ? badge(`Lead-Score ${ai.lead_score}/100`, ai.lead_score >= 60 ? "ok" : "") : null, m.customer_name ? badge(`Kunde: ${m.customer_name}`, "ok") : null, linkBtn),
    h("p", {}, h("strong", {}, "Zusammenfassung: "), ai.summary || "–"),
    ai.need ? h("p", {}, h("strong", {}, "Bedarf: "), ai.need) : null,
    Object.keys(q).length ? h("p", { class: "small" }, h("strong", {}, "Qualifizierung: "),
      [q.mitarbeiter ? `${q.mitarbeiter} Mitarbeiter` : "", q.zeitrahmen ? `Zeitrahmen: ${q.zeitrahmen}` : "", q.budget ? `Budget: ${q.budget}` : "",
        (q.offene_fragen || []).length ? `Offene Fragen: ${q.offene_fragen.join("; ")}` : ""].filter(Boolean).join(" · ") || "–") : null,
    m.category === "beleg" ? h("p", { class: "small" }, h("strong", {}, "Beleg: "),
      `${rc.vendor || "?"} · Nr. ${rc.invoice_no || "?"} · ${rc.invoice_date ? dt(rc.invoice_date) : "Datum ?"} · ${eur2(rc.amount)} · ${rc.category || ""}`) : null) : null;
  const actions = [
    h("button", { class: "btn danger", onclick: async () => { await api(`/api/inbox/${m.id}/ignore`, { method: "POST" }); document.querySelector(".modal-backdrop")?.remove(); toast("Ignoriert"); render(); } }, "Ignorieren"),
    incoming ? (close) => h("button", { class: "btn", onclick: (e) => withBusy(e.target, async () => {
      await api(`/api/inbox/${m.id}/process`, { method: "POST" }); close(); messageDetail(m.id); render();
    }) }, "Neu analysieren") : null,
    needsText ? h("button", { class: "btn", onclick: async () => { await api(`/api/inbox/${m.id}/draft`, { method: "PUT", body: { text: reply.value } }); toast("Entwurf gespeichert"); } }, "Entwurf speichern") : null,
    needsText ? (close) => h("button", { class: "btn", onclick: (e) => withBusy(e.target, async () => {
      try { await navigator.clipboard.writeText(reply.value); } catch { /* ignorieren */ }
      await api(`/api/inbox/${m.id}/approve`, { method: "POST", body: { text: reply.value, manual: true } });
      close(); toast("Text kopiert – als manuell erledigt markiert"); render();
    }) }, "Kopieren & manuell erledigt") : null,
    (close) => h("button", { class: "btn primary", disabled: needsText && !smtp ? true : null, title: needsText && !smtp ? "SMTP in .env einrichten, um direkt zu senden" : null,
      onclick: (e) => withBusy(e.target, async () => {
        const r = await api(`/api/inbox/${m.id}/approve`, { method: "POST", body: { text: reply.value } });
        close(); toast(r.sent ? `Gesendet an ${r.to}` : "Erledigt"); render();
      }) }, needsText ? "Freigeben & senden" : "Geprüft – erledigt"),
  ].filter(Boolean);
  modal(m.subject || "(ohne Betreff)", h("div", {},
    h("p", { class: "muted small" }, incoming ? `Von ${m.from_name || ""} <${m.from_email || "–"}>${m.phone ? " · " + m.phone : ""} · ${m.channel} · ${dt(m.created_at)}` : `An ${m.to_email} · Nachfass-Entwurf · ${dt(m.created_at)}`),
    incoming ? h("pre", { style: "white-space:pre-wrap;font-family:inherit;background:var(--surface-2);padding:.8rem;border-radius:8px;max-height:260px;overflow:auto" }, m.body) : null,
    (m.attachments || []).length ? h("p", { class: "small muted" }, "Anhänge: ", m.attachments.join(", ")) : null,
    analysis,
    needsText ? h("div", {}, h("label", {}, incoming ? "Antwortentwurf (bearbeitbar)" : "Nachricht (bearbeitbar)"), reply,
      !smtp ? h("p", { class: "small muted" }, "Direktes Senden ist aus, weil kein SMTP eingerichtet ist (siehe Steuerung). Bis dahin: kopieren, im eigenen Mailprogramm senden, „manuell erledigt“.") : null) : null,
    (m.thread || []).length ? h("div", {}, h("h3", {}, "Gesendet"), m.thread.map((t) => h("pre", { style: "white-space:pre-wrap;font-family:inherit;border-left:3px solid var(--ok);padding-left:.7rem" }, `${dt(t.sent_at || t.created_at)} → ${t.to_email}\n${t.body}`))) : null), actions);
}

// ---- Leads & Pipeline
const STAGES = [["neu", "Neu"], ["erstgespraech", "Erstgespräch"], ["pitch", "Pitch"], ["angebot", "Angebotsbesprechung"], ["gewonnen", "Gewonnen"]];
views.leads = async () => {
  setTitle("Leads & Pipeline", [
    h("button", { class: "btn", onclick: (e) => withBusy(e.target, async () => {
      const r = await api("/api/agents/followups", { method: "POST" }); toast(r.created ? `${r.created} Nachfass-Entwurf/Entwürfe im Posteingang` : "Nichts nachzufassen");
    }) }, "Nachfassen prüfen"),
    h("a", { class: "btn", href: "#/wachstum" }, "Aktivitäten-Kaskade"),
  ]);
  const leads = await api("/api/leads");
  const col = ([key, label]) => {
    const items = leads.filter((l) => l.stage === key);
    return h("div", { class: "stage" }, h("div", { class: "small muted" }, label), h("div", { class: "n" }, items.length),
      items.map((l) => h("div", { class: "lead-card", onclick: () => leadDetail(l.id) }, h("strong", {}, l.company || l.name || l.email),
        h("div", { class: "small muted" }, `${l.name && l.company ? l.name + " · " : ""}Score ${l.score}${l.owner ? " · " + l.owner : ""}`),
        l.next_step ? h("div", { class: "small" }, "→ ", l.next_step) : null)));
  };
  const lost = leads.filter((l) => l.stage === "verloren");
  show(
    h("p", { class: "muted small", style: "margin-top:0" }, "Drei Gespräche, drei Entscheidungen: Erstgespräch (Warum ändern?) → Pitch (Warum wir?) → Angebotsbesprechung (Warum jetzt?). Der Preis kommt erst nach Referenz, ROI und Zeitplan."),
    h("div", { class: "pipeline" }, STAGES.map(col)),
    lost.length ? h("div", { class: "card", style: "margin-top:1rem" }, h("h2", {}, `Verloren (${lost.length})`),
      table([{ label: "Lead", render: (l) => l.company || l.name }, { label: "E-Mail", key: "email" }, { label: "Notiz", key: "notes" }], lost, (l) => leadDetail(l.id))) : null);
};

async function leadDetail(id) {
  const l = await api(`/api/leads/${id}`);
  const f = form([
    { name: "name", label: "Name" }, { name: "company", label: "Firma" }, { name: "email", label: "E-Mail" }, { name: "phone", label: "Telefon" },
    { name: "stage", label: "Phase", type: "select", options: [...STAGES, ["verloren", "Verloren"]] },
    ...(state.users.length ? [{ name: "owner_id", label: "Verantwortlich", type: "select", options: userOptions(), value: l.owner_id || 0 }] : []),
    { name: "next_step", label: "Nächster Schritt (mit Datum)" }, { name: "risk", label: "Risiko" },
    { name: "score", label: "Lead-Score (0–100)", type: "number" },
    { name: "need", label: "Bedarf", type: "textarea", full: true }, { name: "notes", label: "Notizen (Diagnose, Business Impact, ROI, Timing)", type: "textarea", full: true },
  ], l);
  const q = l.qualification || {};
  modal(l.company || l.name || "Lead", h("div", {},
    h("p", { class: "small muted" }, `Quelle: ${l.source || "–"} · seit ${dt(l.created_at)} · Nachfassungen: ${l.followups}${l.last_contact_at ? " · letzter Kontakt " + dt(l.last_contact_at) : ""}`),
    Object.keys(q).length ? h("p", { class: "small" }, h("strong", {}, "Qualifizierung: "), JSON.stringify(q).replace(/[{}"]/g, "").replace(/,/g, " · ")) : null,
    f,
    l.messages.length ? h("div", {}, h("h3", {}, "Nachrichten"), h("ul", { class: "list" }, l.messages.map((m) => h("li", { class: "row", style: "cursor:pointer", onclick: () => messageDetail(m.id) },
      badge(m.direction === "in" ? "rein" : "raus", "info"), m.subject || "(ohne Betreff)", h("span", { class: "spacer" }), h("span", { class: "small muted" }, dt(m.created_at)))))) : null), [
    (close) => h("button", { class: "btn danger", onclick: async () => { if (!confirm("Lead löschen?")) return; await api(`/api/leads/${l.id}`, { method: "DELETE" }); close(); render(); } }, "Löschen"),
    l.customer_id ? h("a", { class: "btn", href: `#/kunde/${l.customer_id}` }, "Zum Kunden") :
      (close) => h("button", { class: "btn", onclick: (e) => withBusy(e.target, async () => {
        const r = await api(`/api/leads/${l.id}/convert`, { method: "POST" }); close(); toast("Als Kunde angelegt"); location.hash = `#/kunde/${r.customer_id}`;
      }) }, "In Kunden umwandeln"),
    l.customer_id ? (close) => h("button", { class: "btn", onclick: () => { close(); quoteCreate(l.customer_id, l.need); } }, "Angebot (KI)") : null,
    (close) => h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
      const body = readForm(f); if ("owner_id" in body) body.owner_id = Number(body.owner_id);
      await api(`/api/leads/${l.id}`, { method: "PUT", body }); close(); toast("Gespeichert"); render();
    }) }, "Speichern"),
  ].filter(Boolean));
}

// ---- Belege
let receiptTab = "offen";
views.belege = async () => {
  const upload = h("input", { type: "file", accept: "application/pdf", multiple: true, hidden: true, onchange: async (e) => {
    let ok = 0;
    for (const f of e.target.files) {
      const res = await fetch("/api/receipts/upload", { method: "POST", body: f, headers: { "Content-Type": "application/pdf", "X-Filename": encodeURIComponent(f.name) } });
      if (res.ok) ok++; else { const d = await res.json().catch(() => ({})); toast(`${f.name}: ${d.detail || "Upload fehlgeschlagen"}`, true); }
    }
    if (ok) { toast(`${ok} Beleg(e) erfasst und abgelegt – bitte Beträge prüfen`); render(); }
  } });
  setTitle("Belege (für Steuerberater)", [
    upload, h("button", { class: "btn", onclick: () => upload.click() }, "PDF hochladen"),
    h("a", { class: "btn", href: "/api/receipts/export.csv?status=alle", download: "" }, "Alle als CSV"),
    h("a", { class: "btn primary", href: "/api/receipts/export.csv?status=geprueft&mark=true", download: "", onclick: () => setTimeout(render, 1500) }, "Geprüfte exportieren"),
  ]);
  const rows = await api(`/api/receipts${receiptTab === "alle" ? "" : "?status=" + receiptTab}`);
  const sum = rows.reduce((a, r) => a + (r.amount || 0), 0);
  show(
    h("div", { class: "tabs" }, [["offen", "Offen"], ["geprueft", "Geprüft"], ["exportiert", "Exportiert"], ["alle", "Alle"]].map(([k, lbl]) =>
      h("button", { class: receiptTab === k ? "active" : "", onclick: () => { receiptTab = k; render(); } }, lbl))),
    h("p", { class: "small muted" }, `${rows.length} Beleg(e) · Summe ${eur2(sum)}. Rechnungen aus dem Posteingang landen automatisch hier – das PDF zusätzlich in Buchhaltung/Eingangsrechnungen (lokal bzw. SharePoint/OneDrive). Bitte Beträge vor dem Export prüfen.`),
    h("div", { class: "card" }, table([
      { label: "Datum", render: (r) => dt(r.invoice_date) }, { label: "Lieferant", key: "vendor" }, { label: "Rechnungsnr.", key: "invoice_no" },
      { label: "Betrag", num: true, render: (r) => eur2(r.amount) }, { label: "Kategorie", key: "category" }, { label: "Status", render: (r) => badge(r.status) },
      { label: "PDF", render: (r) => r.document_id ? h("a", { class: "btn small", href: `/api/documents/${r.document_id}/download`, target: "_blank", rel: "noopener", onclick: (e) => e.stopPropagation() }, "PDF") : "–" },
    ], rows, (r) => receiptForm(r))));
};

function receiptForm(r) {
  const f = form([
    { name: "vendor", label: "Lieferant" }, { name: "invoice_no", label: "Rechnungsnummer" }, { name: "invoice_date", label: "Datum", type: "date" },
    { name: "amount", label: "Betrag brutto (€)", type: "number", step: "0.01" }, { name: "category", label: "Kategorie" },
    { name: "status", label: "Status", type: "select", options: [["offen", "offen"], ["geprueft", "geprüft"], ["exportiert", "exportiert"]] },
    { name: "note", label: "Notiz", full: true },
  ], r);
  modal("Beleg prüfen", f, [
    (close) => h("button", { class: "btn danger", onclick: async () => { if (!confirm("Beleg löschen?")) return; await api(`/api/receipts/${r.id}`, { method: "DELETE" }); close(); render(); } }, "Löschen"),
    (close) => h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
      await api(`/api/receipts/${r.id}`, { method: "PUT", body: readForm(f) }); close(); toast("Gespeichert"); render();
    }) }, "Speichern"),
  ]);
}

// ---- KI-Mitarbeiter: Steuerung
views["ki-mitarbeiter"] = async () => {
  setTitle("KI-Mitarbeiter – Steuerung");
  const [o, services] = await Promise.all([kmOverview(), api("/api/services")]);
  const price = (code, fallback) => (services.find((s) => s.code === code) || {}).price ?? fallback;
  const kpi = (label, value, sub) => h("div", { class: "card kpi" }, h("div", { class: "label" }, label), h("div", { class: "value" }, value), h("div", { class: "sub" }, sub));
  const modeRow = (cat) => {
    const seg = h("div", { class: "seg" }, ["entwurf", "autopilot"].map((v) => h("label", {},
      h("input", { type: "radio", name: `mode-${cat}`, value: v, checked: o.modes[cat] === v, onchange: async () => {
        try { await api("/api/ki-mitarbeiter/modes", { method: "PUT", body: { modes: { [cat]: v } } }); toast(`${CAT_LABEL[cat]}: ${v === "autopilot" ? "Autopilot" : "Entwurf mit Freigabe"}`); }
        catch (e) { toast(e.message, true); }
      } }), h("span", {}, v === "entwurf" ? "Entwurf + Freigabe" : "Autopilot"))));
    return h("div", { class: "question" }, h("div", {}, h("strong", {}, CAT_LABEL[cat]), h("div", { class: "small muted" }, o.categories[cat])), seg);
  };
  // ROI-Rechner: Wirkung vor Preis
  const roiForm = form([
    { name: "people", label: "Mitarbeiter mit Routinearbeit", type: "number", value: 3 },
    { name: "hours", label: "Routine-Stunden pro Woche je Person", type: "number", value: 6 },
    { name: "share", label: "Davon automatisierbar (%)", type: "number", value: 50 },
    { name: "rate", label: "Interne Kosten je Stunde (€)", type: "number", value: 45 },
    { name: "setup", label: "Einrichtung (€)", type: "number", value: price("KIMA", 3900) },
    { name: "monthly", label: "Betrieb (€/Monat)", type: "number", value: price("KIMAM", 249) },
  ]);
  const roiOut = h("div", { style: "margin-top:.8rem" });
  const calc = () => {
    const v = readForm(roiForm);
    const hoursMonth = v.people * v.hours * (v.share / 100) * 4.33;
    const saving = hoursMonth * v.rate;
    const net = saving - v.monthly;
    const payback = net > 0 ? v.setup / net : null;
    const roi1 = ((saving * 12) - (v.setup + v.monthly * 12)) / (v.setup + v.monthly * 12) * 100;
    const text = `Zeitgewinn: ca. ${Math.round(hoursMonth)} Stunden pro Monat (${Math.round(hoursMonth / 4.33)} h/Woche).\n` +
      `Wert der Zeit: ${eur(saving)} pro Monat, ${eur(saving * 12)} pro Jahr.\n` +
      `Kosten: ${eur(v.setup)} einmalig + ${eur(v.monthly)} pro Monat.\n` +
      (payback ? `Amortisation nach ca. ${payback.toFixed(1).replace(".", ",")} Monaten. ROI im ersten Jahr: ${Math.round(roi1)} %.` : "Bei diesen Annahmen rechnet es sich (noch) nicht – Umfang oder Annahmen prüfen.");
    roiOut.replaceChildren(h("div", { class: "grid kpis", style: "margin:0" },
      kpi("Zeitgewinn", `${Math.round(hoursMonth)} h`, "pro Monat"), kpi("Wert", eur(saving), "pro Monat"),
      kpi("Amortisation", payback ? `${payback.toFixed(1).replace(".", ",")} Mon.` : "–", "Einrichtung ÷ Nettoersparnis"),
      kpi("ROI Jahr 1", `${Math.round(roi1)} %`, "nach allen Kosten")), h("div", { class: "row", style: "margin-top:.6rem" }, h("span", { class: "spacer" }), copyButton(() => text, "Ergebnis für Kunden kopieren")));
  };
  roiForm.addEventListener("input", calc);
  calc();
  const formUrl = `${location.origin}/anfrage`;
  const embed = `<iframe src="${formUrl}" style="width:100%;min-height:720px;border:0" title="Anfrage"></iframe>`;
  show(
    h("div", { class: "grid kpis" },
      kpi(`Nachrichten (${o.days} Tage)`, o.received, `${o.processed} bearbeitet`),
      kpi("Automatisch erledigt", o.auto_handled, "Autopilot ohne Eingriff"),
      kpi("Warten auf Freigabe", o.pending_approval, `${o.unprocessed} noch unbearbeitet`),
      kpi("Zeitersparnis (Schätzung)", `${(Math.round(o.minutes_saved / 6) / 10).toLocaleString("de-AT")} h`, `in ${o.days} Tagen · ${o.followups_sent} Nachfassungen`)),
    h("div", { class: "grid two" },
      h("div", { class: "card" }, h("h2", {}, "Arbeitsweise je Nachrichtenart"),
        h("p", { class: "small muted" }, "Empfehlung: mit „Entwurf + Freigabe“ starten. Wenn die Entwürfe ein paar Wochen passen, einzelne Arten auf Autopilot stellen. Autopilot sendet nur, wenn SMTP eingerichtet ist."),
        Object.keys(o.categories).map(modeRow)),
      h("div", { class: "stack" },
        h("div", { class: "card" }, h("h2", {}, "Postfach"),
          h("div", { class: "row" }, o.mail.provider === "graph"
            ? badge(o.mail.imap ? "Microsoft 365 verbunden" : "Microsoft 365 nicht konfiguriert", o.mail.imap ? "ok" : "warn")
            : [badge(o.mail.imap ? "Abruf (IMAP) verbunden" : "Abruf (IMAP) aus", o.mail.imap ? "ok" : "warn"), badge(o.mail.smtp ? "Versand (SMTP) verbunden" : "Versand (SMTP) aus", o.mail.smtp ? "ok" : "warn")],
            o.poll_minutes ? badge(`automatisch alle ${o.poll_minutes} min`, "info") : null),
          h("p", { class: "small muted" }, o.mail.last_fetch ? `Letzter Abruf: ${o.mail.last_fetch}` : "Noch nicht abgerufen.", o.mail.last_error ? h("span", { style: "color:var(--bad)" }, ` Fehler: ${o.mail.last_error}`) : null),
          md(["**Microsoft 365** (empfohlen bei M365): App-Registrierung, siehe docs/KI-MITARBEITER.md", "```", "MAIL_PROVIDER=graph", "GRAPH_TENANT_ID=…", "GRAPH_CLIENT_ID=…", "GRAPH_CLIENT_SECRET=…", "GRAPH_MAILBOX=office@deine-firma.at", "```",
            "**Andere Anbieter** (IMAP/SMTP) in `.env` (danach neu starten):", "```", "MAIL_IMAP_HOST=imap.dein-provider.at", "MAIL_IMAP_USER=office@deine-firma.at", "MAIL_IMAP_PASSWORD=App-Kennwort",
            "MAIL_SMTP_HOST=smtp.dein-provider.at", "MAIL_FROM=office@deine-firma.at", "MAIL_POLL_MINUTES=5", "BOOKING_URL=https://… (optional)", "```"].join("\n"))),
        h("div", { class: "card" }, h("h2", {}, "Anfrageformular für die Website"),
          o.public_form_enabled ? h("div", {}, h("p", { class: "small" }, "Anfragen landen direkt im Posteingang, der Interessent bekommt einen Antwortentwurf mit Qualifizierungsfragen. Kein Passwort nötig, mit Spam- und Missbrauchsschutz."),
            h("div", { class: "row" }, h("a", { class: "btn small", href: "/anfrage", target: "_blank", rel: "noopener" }, "Formular öffnen"), copyButton(() => formUrl, "Link kopieren"), copyButton(() => embed, "Einbettungscode kopieren")),
            h("p", { class: "small muted" }, "Für Besucher von außen muss die App über eine Domain erreichbar sein (Reverse-Proxy, nur /anfrage und /api/public/ freigeben). Termin-Link: ", o.booking_url || "nicht gesetzt (BOOKING_URL)")) :
            h("p", { class: "muted" }, "Deaktiviert (PUBLIC_FORM_ENABLED=false)")))),
    h("div", { class: "card", style: "margin-top:1rem" }, h("h2", {}, "ROI-Rechner für das Kundengespräch"),
      h("p", { class: "small muted" }, "Erst die Wirkung, dann der Preis: Gemeinsam mit dem Kunden ausfüllen, Ergebnis kopieren und ins Angebot übernehmen."),
      roiForm, roiOut));
};

// ---- Wachstum / Customer Success
const SELFCHECK = [
  ["m1", "Marketing", "Wir haben einen Kanal für Anfragen, den wir per Budget hoch- und runterdrehen können (z. B. beworbenes Webinar)."],
  ["m2", "Marketing", "Der Vertrieb bekommt jede Woche fertige Kontaktlisten (warm und kalt) mit Telefonnummer."],
  ["s1", "Sales", "Unser Verkauf läuft in drei Gesprächen: Diagnose – Pitch – Entscheidung."],
  ["s2", "Sales", "Den Preis nennen wir erst nach Referenz, ROI und Zeitplan."],
  ["c1", "Customer Success", "Jeder Kunde hat einen aktuellen Health Score."],
  ["c2", "Customer Success", "Mit den wichtigsten Kunden führen wir jedes Quartal ein Strategiegespräch (QBR)."],
  ["t1", "Team", "Wochenziele werden montags festgelegt und freitags abgeglichen."],
  ["t2", "Team", "Was nicht im System steht, ist nicht passiert – auch für die Geschäftsführung."],
  ["f1", "Firmenwert", "Der Anteil wiederkehrender Umsätze steigt jedes Quartal messbar."],
  ["f2", "Firmenwert", "Wir kennen unsere NRR und sie liegt über 100 %."],
];

views.wachstum = async () => {
  setTitle("Customer Success & Wachstum");
  const g = await api("/api/growth");
  const n = g.nrr, rs = g.recurring_share, hl = g.health, p = g.pipeline;
  const kpi = (label, value, sub, cls = "") => h("div", { class: `card kpi ${cls}` }, h("div", { class: "label" }, label), h("div", { class: "value" }, value), h("div", { class: "sub" }, sub));
  const auto = {
    c1: [true, "Cockpit berechnet ihn automatisch"],
    c2: (() => { const managed = hl.customers.length; return [false, `${managed} Kunden – QBR-Status siehe Health-Faktoren`]; })(),
    f2: n.nrr !== null ? [n.nrr > 100, `aktuell ${n.nrr.toLocaleString("de-AT")} %`] : [false, "Verlauf wird aufgezeichnet"],
    f1: rs.share !== null ? [false, `aktuell ${Math.round(rs.share)} % (Schätzung) – Entwicklung quartalsweise vergleichen`] : [false, ""],
  };
  const saved = g.selfcheck || {};
  const checks = SELFCHECK.map(([key, area, text]) => {
    const box = h("input", { type: "checkbox", checked: saved[key] ?? (auto[key] ? auto[key][0] : false), onchange: async () => {
      const all = {}; checks.forEach((c) => { all[c.key] = c.box.checked; });
      await api("/api/growth/settings", { method: "PUT", body: { selfcheck: all } }); scoreEl.textContent = `${Object.values(all).filter(Boolean).length}/10`;
    } });
    return { key, box, el: h("label", { class: "check" }, box, h("span", {}, h("strong", {}, `${area}: `), text, auto[key] && auto[key][1] ? h("span", { class: "small muted" }, ` (${auto[key][1]})`) : null)) };
  });
  const scoreEl = h("span", {}, `${checks.filter((c) => c.box.checked).length}/10`);
  const target = h("input", { type: "number", step: "0.5", min: "0.5", value: p.target_closings_per_week, style: "width:90px" });
  show(
    h("div", { class: "grid kpis" },
      kpi("Net Revenue Retention", n.nrr !== null ? `${n.nrr.toLocaleString("de-AT")} %` : "–", n.nrr !== null ? `+${eur(n.expansion)} Upsell · −${eur(n.churn + n.contraction)} Verlust (12 Mon.)` : n.note, n.nrr > 100 ? "accent" : ""),
      kpi("Anteil wiederkehrend", rs.share !== null ? `${Math.round(rs.share)} %` : "–", `${eur(rs.annual_recurring)} p.a. vs. ${eur(rs.one_time_12m)} Projekte/Stunden (Schätzung)`),
      kpi("Kunden im Risiko", hl.counts.risiko, `${eur(hl.mrr_at_risk)} MRR gefährdet`),
      kpi("Selbst-Check", h("span", {}, scoreEl), "Punkte erfüllt – jede Lücke ist ein Hebel")),
    h("div", { class: "card" }, h("div", { class: "card-head" }, h("h2", {}, "Health Score je Kunde"), h("span", { class: "small muted" }, "Niedrig zuerst – hier entsteht Churn oder der nächste Upsell")),
      table([
        { label: "Kunde", render: (r) => h("a", { href: `#/kunde/${r.customer_id}` }, r.customer) },
        { label: "Health", render: (r) => badge(`${r.score} ${r.status}`, r.status) },
        { label: "MRR", num: true, render: (r) => eur(r.mrr) },
        { label: "Wichtigste Faktoren", render: (r) => h("span", { class: "small" }, r.factors.filter((f) => f.delta < 0).slice(0, 3).map((f) => f.text).join(" · ") || "–") },
        { label: "", render: (r) => h("button", { class: "btn small", onclick: (e) => { e.stopPropagation(); withBusy(e.target, async () => {
          const q = await api("/api/agents/qbr", { method: "POST", body: { customer_id: r.customer_id } });
          modal("Quartalsgespräch (QBR)", md(q.text), [copyButton(() => q.text)]); render();
        }); } }, "QBR") },
      ], hl.customers)),
    h("div", { class: "card", style: "margin-top:1rem" },
      h("div", { class: "card-head" }, h("h2", {}, "Aktivitäten-Kaskade (rückwärts geplant)"),
        h("div", { class: "row small" }, "Ziel-Abschlüsse pro Woche:", target, h("button", { class: "btn small", onclick: async () => {
          await api("/api/growth/settings", { method: "PUT", body: { target_closings_per_week: Number(target.value) } }); render();
        } }, "Berechnen"))),
      h("div", { class: "pipeline" }, p.stages.map((st) => h("div", { class: "stage" }, h("div", { class: "small muted" }, st.label),
        h("div", { class: "n" }, st.needed_per_week.toLocaleString("de-AT")), h("div", { class: "small" }, "pro Woche nötig"),
        h("div", { class: "small muted" }, `aktuell: ${st.current} · Quote: ${st.conversion_in !== null ? Math.round(st.conversion_in * 100) + " %" : "–"}`)))),
      h("p", { class: "small muted" }, p.own_data ? "Quoten aus euren eigenen Leads berechnet." : "Noch zu wenige Leads – Quoten sind Annahmen und werden automatisch durch eure echten Werte ersetzt.")),
    h("div", { class: "grid two", style: "margin-top:1rem" },
      h("div", { class: "card" }, h("h2", {}, "10-Punkte-Selbst-Check"), checks.map((c) => c.el)),
      h("div", { class: "card" }, h("h2", {}, "MRR-Verlauf (letzte Änderungen)"), table([
        { label: "Datum", render: (r) => dt(r.created_at) }, { label: "Kunde", key: "customer_name" },
        { label: "Änderung", num: true, render: (r) => `${r.new_mrr - r.old_mrr >= 0 ? "+" : ""}${eur(r.new_mrr - r.old_mrr)}` }, { label: "Grund", key: "reason" },
      ], g.mrr_history.slice(0, 15)))));
};

// ---- Daten: Import & Sicherung
views.daten = async () => {
  setTitle("Import & Datensicherung");
  const [b, rmm] = await Promise.all([api("/api/backup"), api("/api/rmm/status")]);
  let csvText = "";
  const kind = h("select", {}, h("option", { value: "customers" }, "Kunden"), h("option", { value: "assets" }, "Geräte (auch RMM-Export: NinjaOne, Datto, Atera …)"));
  const createCust = h("input", { type: "checkbox", checked: true, style: "width:auto" });
  const result = h("div");
  const file = h("input", { type: "file", accept: ".csv,text/csv,text/plain", onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    csvText = await f.text();
    run(false);
  } });
  const run = async (commit) => {
    if (!csvText) return toast("Bitte zuerst eine CSV-Datei wählen", true);
    try {
      const r = await api(`/api/import/${kind.value}`, { method: "POST", body: { csv: csvText, commit, create_customers: createCust.checked } });
      const cols = Object.entries(r.columns).map(([c, f]) => `${c} → ${f}`).join(" · ");
      const previewCols = r.preview.length ? Object.keys(r.preview[0]).filter((k) => k !== "booked_services") : [];
      result.replaceChildren(h("div", { class: "card", style: "margin-top:1rem" },
        h("h3", {}, commit ? "Import abgeschlossen" : "Vorschau – noch nichts gespeichert"),
        h("p", { class: "small" }, `${r.total} Zeilen · ${commit ? "angelegt" : "neu"}: ${r.created} · ${commit ? "aktualisiert" : "wird aktualisiert"}: ${r.updated} · übersprungen: ${r.skipped.length}`
          + (r.new_customers.length ? ` · neue Kunden: ${r.new_customers.join(", ")}` : "")),
        h("p", { class: "small muted" }, "Erkannte Spalten: ", cols || "–"),
        r.skipped.length ? h("details", {}, h("summary", { class: "small" }, "Übersprungene Zeilen"), h("ul", { class: "small" }, r.skipped.slice(0, 50).map((x) => h("li", {}, `Zeile ${x.row}: ${x.reason}`)))) : null,
        r.preview.length ? table(previewCols.map((k) => ({ label: k, key: k })), r.preview) : null,
        !commit ? h("div", { class: "row", style: "margin-top:.8rem" }, h("span", { class: "spacer" }),
          h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, () => run(true)) }, "Jetzt importieren")) : null));
      if (commit) toast("Import fertig");
    } catch (e) { toast(e.message, true); }
  };
  show(
    h("div", { class: "grid two" },
      h("div", { class: "card" }, h("h2", {}, "Daten importieren (CSV)"),
        h("p", { class: "small muted" }, "Excel: „Speichern unter → CSV (Trennzeichen-getrennt)“. Spalten werden automatisch erkannt (deutsch/englisch, z. B. Firma, Ansprechpartner, Hostname, Betriebssystem, Seriennummer, Garantie bis). Erst Vorschau, dann Import. Erneuter Geräte-Import aktualisiert bestehende Geräte."),
        h("div", { class: "form-grid" }, h("div", {}, h("label", {}, "Was importieren?"), kind), h("div", {}, h("label", {}, "CSV-Datei"), file),
          h("label", { class: "check full" }, createCust, h("span", {}, "Unbekannte Kunden aus Geräte-Import automatisch anlegen")))),
      h("div", { class: "card" }, h("h2", {}, "Datensicherung"),
        h("p", { class: "small" }, b.hours > 0 ? `Automatisch alle ${b.hours} h, die letzten ${b.keep} Sicherungen bleiben erhalten.` : "Automatische Sicherung ist aus (BACKUP_HOURS=0)."),
        h("p", { class: "small muted" }, `Ordner: ${b.dir}`, h("br"), `Letzte Sicherung: ${b.last || "noch keine"}`, b.error ? h("span", { style: "color:var(--bad)" }, ` · Fehler: ${b.error}`) : null),
        h("div", { class: "row" }, h("button", { class: "btn", onclick: (e) => withBusy(e.target, async () => { await api("/api/backup/run", { method: "POST" }); toast("Sicherung erstellt"); render(); }) }, "Jetzt sichern"),
          h("a", { class: "btn primary", href: "/api/backup/download" }, "Sicherung herunterladen")),
        h("p", { class: "small muted" }, "Tipp: Den Sicherungsordner zusätzlich auf NAS oder ins Offsite-Backup aufnehmen (3-2-1-Regel). Wiederherstellen: App stoppen, Sicherungsdatei als data/meit.db einsetzen, starten."),
        b.backups.length ? table([{ label: "Datei", key: "file" }, { label: "Größe", num: true, render: (r) => `${r.size_kb} KB` }, { label: "Erstellt", key: "created" }], b.backups.slice(0, 8)) : null)),
    h("div", { class: "card", style: "margin-top:1rem" }, h("div", { class: "card-head" }, h("h2", {}, "RMM: NinjaOne"),
      rmm.configured ? h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
        const r = await api("/api/rmm/sync", { method: "POST" });
        toast(`${r.assets_created} Geräte neu, ${r.assets_updated} aktualisiert${r.alert_tickets ? `, ${r.alert_tickets} Alarm-Tickets` : ""}`); render();
      }) }, "Jetzt abgleichen") : badge("nicht eingerichtet", "warn")),
      rmm.configured ? h("p", { class: "small" }, `Instanz: ${rmm.url} · ${rmm.sync_hours ? `automatisch alle ${rmm.sync_hours} h` : "Abgleich per Knopf"} · Alarme → Tickets: ${rmm.alert_tickets ? "ja" : "nein"}`,
        rmm.last ? h("span", { class: "muted" }, ` · letzter Abgleich ${rmm.last.at}: ${rmm.last.assets_created} neu / ${rmm.last.assets_updated} aktualisiert`) : null,
        rmm.error ? h("span", { style: "color:var(--bad)" }, ` · Fehler: ${rmm.error}`) : null)
        : md(["Organisationen werden zu Kunden, Geräte inkl. Betriebssystem, Seriennummer und „zuletzt gesehen“ werden übernommen (Support-Ende-Erkennung, Umsatz-Radar). In NinjaOne: *Administration → Apps → API* → Client-App (API Services, Client Credentials, Scope Monitoring). Dann in `.env`:", "```", "NINJA_URL=https://eu.ninjarmm.com", "NINJA_CLIENT_ID=…", "NINJA_CLIENT_SECRET=…", "NINJA_SYNC_HOURS=6", "NINJA_ALERT_TICKETS=true", "```"].join("\n"))),
    result);
};

// ---- Team: Benutzer, Login, Wochenrhythmus
const userOptions = () => [[0, "– niemand –"], ...state.users.map((u) => [u.id, u.name])];
async function loadUsers(all = false) {
  try { const list = await api("/api/users"); state.allUsers = list; state.users = list.filter((u) => u.active); } catch { state.users = []; }
  return all ? state.allUsers : state.users;
}

function userForm(u = null) {
  const first = !(state.allUsers || []).length;
  const f = form([
    { name: "name", label: "Name", required: true }, { name: "email", label: "E-Mail (Login)", type: "email", required: true },
    { name: "role", label: "Rolle", type: "select", options: Object.entries((state.auth && state.auth.roles) || { admin: "Admin", technik: "Technik", vertrieb: "Vertrieb" }), value: first ? "admin" : (u ? u.role : "technik") },
    { name: "password", label: u ? "Neues Passwort (leer = unverändert)" : "Passwort (mind. 10 Zeichen)", type: "password" },
    { name: "active", label: "Aktiv", type: "checkbox", value: u ? !!u.active : true },
  ], u || {});
  modal(u ? "Benutzer bearbeiten" : (first ? "Ersten Benutzer (Admin) anlegen" : "Neuer Benutzer"), h("div", {},
    first ? h("p", { class: "small", style: "color:var(--warn)" }, "Danach ist eine Anmeldung Pflicht. Passwort gut merken (Passwort-Manager)!") : null, f), [
    (close) => h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
      const body = readForm(f); if (!body.password) body.password = null;
      await api(u ? `/api/users/${u.id}` : "/api/users", { method: u ? "PUT" : "POST", body });
      close(); toast("Gespeichert");
      if (first) { location.reload(); return; }
      render();
    }) }, "Speichern"),
  ]);
}

function showLogin() {
  if (document.getElementById("login-screen")) return;
  document.querySelector(".layout").style.display = "none";
  const email = h("input", { type: "email", placeholder: "E-Mail", autocomplete: "username" });
  const pw = h("input", { type: "password", placeholder: "Passwort", autocomplete: "current-password" });
  const msg = h("div", { class: "small", style: "color:var(--bad);min-height:1.2em;margin-top:.6rem" });
  const submit = async (e) => {
    e.preventDefault();
    try { await api("/api/auth/login", { method: "POST", body: { email: email.value, password: pw.value } }); location.reload(); }
    catch (err) { msg.textContent = err.message; }
  };
  document.body.append(h("div", { id: "login-screen", style: "min-height:100vh;display:grid;place-items:center;padding:16px" },
    h("form", { class: "card", style: "width:min(380px,100%)", onsubmit: submit },
      h("div", { style: "text-align:center;padding:.2rem 0 1rem" }, h("img", { src: "/brand/logo", alt: "ME-IT", style: "max-width:220px;width:100%;height:auto" }),
        h("div", { class: "small muted", style: "margin-top:.4rem" }, "Cockpit – bitte anmelden")),
      h("label", {}, "E-Mail"), email, h("label", { style: "margin-top:.7rem" }, "Passwort"), pw,
      h("button", { class: "btn primary", type: "submit", style: "width:100%;justify-content:center;margin-top:1rem" }, "Anmelden"), msg)));
  email.focus();
}

function renderUserBox() {
  const box = document.getElementById("user-box") || h("div", { id: "user-box", class: "ai-status", style: "margin-bottom:.4rem" });
  const u = state.auth && state.auth.user;
  if (!u) { box.remove(); return; }
  box.replaceChildren(h("strong", { style: "color:#fff" }, u.name), h("br"), h("span", { class: "small muted" }, (state.auth.roles || {})[u.role] || u.role), " · ",
    h("a", { href: "#", style: "color:var(--brand)", onclick: async (e) => { e.preventDefault(); await api("/api/auth/logout", { method: "POST" }); location.reload(); } }, "Abmelden"));
  const ai = document.getElementById("ai-status");
  if (!box.parentNode) ai.parentNode.insertBefore(box, ai);
}

async function showBriefing() {
  const r = await api("/api/agents/briefing", { method: "POST", body: {} });
  const to = h("input", { type: "email", placeholder: "E-Mail der Geschäftsführung", style: "max-width:280px" });
  modal(`Wochenbriefing ${r.week}`, h("div", {}, h("p", { class: "small muted" }, `Erstellt mit: ${r.provider}`), md(r.text)), [
    to, h("button", { class: "btn", onclick: (e) => withBusy(e.target, async () => {
      const s = await api("/api/agents/briefing", { method: "POST", body: { send_to: to.value } }); if (s.sent) toast(`Gesendet an ${to.value}`);
    }) }, "Per E-Mail senden"), copyButton(() => r.text)]);
}

function activityForm(defaults = {}) {
  const f = form([
    { name: "type", label: "Art", type: "select", options: Object.entries(state.activityTypes || { anruf: "Anruf" }), value: defaults.type || "anruf" },
    { name: "note", label: "Notiz", full: true },
  ]);
  modal("Aktivität erfassen", f, [(close) => h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
    await api("/api/activities", { method: "POST", body: { ...readForm(f), ref_type: defaults.ref_type || "", ref_id: defaults.ref_id || null } });
    close(); toast("Erfasst"); render();
  }) }, "Speichern")]);
}

function shiftWeek(week, delta) {
  const [y, w] = week.split("-W").map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const monday = new Date(jan4); monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (w - 1) * 7 + delta * 7);
  const t = new Date(monday); t.setUTCDate(t.getUTCDate() + 3);
  const fy = t.getUTCFullYear(); const fj4 = new Date(Date.UTC(fy, 0, 4));
  const wk = 1 + Math.round(((t - fj4) / 86400000 - 3 + ((fj4.getUTCDay() + 6) % 7)) / 7);
  return `${fy}-W${String(wk).padStart(2, "0")}`;
}

let teamWeek = null;
views.team = async () => {
  await loadUsers();
  const w = await api(`/api/team/week${teamWeek ? "?week=" + teamWeek : ""}`);
  teamWeek = w.week;
  state.activityTypes = w.activity_types;
  setTitle(`Wochenrhythmus ${w.week}`, [
    h("button", { class: "btn", onclick: () => { teamWeek = shiftWeek(w.week, -1); render(); } }, "← Vorwoche"),
    h("button", { class: "btn", onclick: () => { teamWeek = shiftWeek(w.week, 1); render(); } }, "Nächste →"),
    h("button", { class: "btn", onclick: () => activityForm() }, "+ Aktivität"),
    h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, showBriefing) }, "Wochenbriefing (KI)"),
  ]);
  const goalTypes = Object.entries(w.goal_types);
  const rows = w.rows.map((r) => {
    const inputs = {};
    const note = h("input", { value: r.review_note || "", placeholder: "Freitag: Was lief, was ändern wir?", style: "min-width:170px" });
    const cells = goalTypes.map(([t]) => {
      const act = r.actual[t] || 0; const goal = r.goals[t] || 0;
      inputs[t] = h("input", { type: "number", min: "0", value: goal || "", style: "width:54px;padding:.35rem .4rem", placeholder: "Ziel" });
      return h("td", { class: "num" }, h("div", { class: "row", style: "justify-content:flex-end;gap:.3rem;flex-wrap:nowrap" },
        h("strong", { style: `color:${goal ? (act >= goal ? "var(--ok)" : "var(--warn)") : "inherit"}` }, act), h("span", { class: "muted" }, "/"), inputs[t]));
    });
    return h("tr", {}, h("td", {}, h("strong", {}, r.name), h("div", { class: "small muted" }, `erfüllt ${r.fulfilled}`)), cells,
      h("td", {}, note), h("td", {}, h("button", { class: "btn small", onclick: async () => {
        const goals = {}; for (const [t, el] of Object.entries(inputs)) goals[t] = Number(el.value || 0);
        try { await api("/api/team/goals", { method: "PUT", body: { week: w.week, user_id: r.user_id, goals, review_note: note.value } }); toast("Gespeichert"); render(); }
        catch (e) { toast(e.message, true); }
      } }, "Speichern")));
  });
  show(
    h("p", { class: "muted small", style: "margin-top:0" }, `Montag: Ziel festlegen · Freitag: abgleichen. Ist-Werte zählt das Cockpit automatisch (Phasenwechsel bei Leads, Angebote, QBRs, gelöste Tickets) plus manuell erfasste Anrufe/Termine. Woche ${dt(w.start)} – ${dt(new Date(new Date(w.end) - 86400000).toISOString().slice(0, 10))}.`),
    h("div", { class: "card" }, h("h2", {}, "Ziel vs. Ist"), h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Person"), goalTypes.map(([, l]) => h("th", { class: "num" }, l)), h("th", {}, "Abgleich"), h("th", {}, ""))),
      h("tbody", {}, rows)))),
    h("div", { class: "card", style: "margin-top:1rem" }, h("div", { class: "card-head" }, h("h2", {}, "Top-10-Opportunity-Review"), h("a", { class: "btn small", href: "#/leads" }, "Pipeline")),
      h("p", { class: "small muted" }, "Für jeden Deal: Phase, nächster Schritt mit Datum, Risiko. Was nicht im Cockpit steht, ist nicht passiert."),
      table([
        { label: "Lead", render: (r) => h("strong", {}, r.company || r.name) }, { label: "Phase", render: (r) => badge((STAGES.find((s) => s[0] === r.stage) || [r.stage, r.stage])[1], "info") },
        { label: "Score", key: "score", num: true }, { label: "Verantwortlich", render: (r) => r.owner || "–" },
        { label: "Nächster Schritt", render: (r) => r.next_step || h("span", { style: "color:var(--warn)" }, "fehlt!") },
        { label: "Risiko", render: (r) => r.risk || "–" },
      ], w.top_opportunities, (r) => leadDetail(r.id))));
};

// ---- Abrechnung
let billingTab = "offen";
const INV_STATUS = { entwurf: "Entwurf", gestellt: "gestellt", bezahlt: "bezahlt", storniert: "storniert" };
function timeForm(defaults = {}) {
  const f = form([
    ...(defaults.ticket_id ? [] : [{ name: "customer_id", label: "Kunde", type: "select", options: customerOptions(), value: defaults.customer_id || "" }]),
    { name: "minutes", label: "Minuten", type: "number", value: defaults.minutes || 30 },
    { name: "date", label: "Datum", type: "date", value: new Date().toISOString().slice(0, 10) },
    { name: "billable", label: "Abrechnung", type: "select", options: [["auto", "automatisch (nach Vertrag)"], ["ja", "verrechenbar"], ["nein", "nicht verrechenbar (Flatrate/Kulanz)"]] },
    { name: "description", label: "Tätigkeit (steht so auf der Rechnung)", full: true, value: defaults.description || "" },
  ]);
  modal("Zeit buchen", f, [(close) => h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
    const d = readForm(f);
    const body = { minutes: Number(d.minutes), date: d.date, description: d.description, ticket_id: defaults.ticket_id || null,
      customer_id: d.customer_id ? Number(d.customer_id) : (defaults.customer_id || null), billable: d.billable === "auto" ? null : d.billable === "ja" };
    await api("/api/time", { method: "POST", body }); close(); toast("Zeit gebucht"); render();
  }) }, "Buchen")]);
}

views.abrechnung = async () => {
  await loadCustomers();
  const month = new Date().toISOString().slice(0, 7);
  const periodSel = h("input", { type: "month", value: month, style: "max-width:170px" });
  setTitle("Abrechnung", [
    h("button", { class: "btn", onclick: () => timeForm() }, "+ Zeit buchen"),
    periodSel,
    h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
      const r = await api("/api/billing/run", { method: "POST", body: { period: periodSel.value } });
      toast(r.count ? `${r.count} Rechnungsentwurf/-entwürfe erstellt` : "Nichts abzurechnen"); billingTab = "rechnungen"; render();
    }) }, "Rechnungslauf"),
  ]);
  const tabs = h("div", { class: "tabs" }, [["offen", "Unverrechnet"], ["rechnungen", "Rechnungen"], ["zahlungen", "Zahlungen & Mahnwesen"], ["zeiten", "Zeiten"], ["firma", "Firmendaten"]].map(([k, l]) =>
    h("button", { class: billingTab === k ? "active" : "", onclick: () => { billingTab = k; render(); } }, l)));
  let content;
  if (billingTab === "offen") {
    const u = await api("/api/billing/unbilled");
    content = h("div", {},
      h("div", { class: "grid kpis" }, h("div", { class: "card kpi accent" }, h("div", { class: "label" }, "Noch nicht verrechnet"), h("div", { class: "value" }, eur(u.total_value)), h("div", { class: "sub" }, "Stunden + angenommene Projekte"))),
      h("div", { class: "grid two" },
        h("div", { class: "card" }, h("h2", {}, "Verrechenbare Stunden"), table([
          { label: "Kunde", key: "customer" }, { label: "Stunden", num: true, render: (r) => r.hours.toLocaleString("de-AT") },
          { label: "Wert", num: true, render: (r) => eur(r.value) }, { label: "seit", render: (r) => dt(r.since) }], u.hours)),
        h("div", { class: "card" }, h("h2", {}, "Angenommene Projekte"), table([
          { label: "Kunde", key: "customer" }, { label: "Projekt", key: "title" }, { label: "Betrag", num: true, render: (r) => eur(r.total_once) }], u.projects))),
      h("p", { class: "small muted" }, "Der Rechnungslauf erstellt Entwürfe: Betreuungspauschale (MRR) des Monats, verrechenbare Stunden (Viertelstundentakt) und angenommene Projekte. Nummern werden erst beim Stellen vergeben – fortlaufend und lückenlos."));
  } else if (billingTab === "rechnungen") {
    const [inv, invDocs] = await Promise.all([api("/api/invoices"), api("/api/documents?ref_type=invoice&limit=1000").catch(() => [])]);
    const docOf = Object.fromEntries(invDocs.map((d) => [d.ref_id, d]));
    const act = (r, status, label, cls = "") => h("button", { class: `btn small ${cls}`, onclick: async (e) => { e.stopPropagation();
      if (status === "storniert" && !confirm("Rechnung stornieren? Die Leistungen werden wieder abrechenbar.")) return;
      try { await api(`/api/invoices/${r.id}`, { method: "PUT", body: { status } }); toast(label); render(); } catch (err) { toast(err.message, true); } } }, label);
    const open = inv.filter((r) => r.status === "gestellt").reduce((a, r) => a + r.gross, 0);
    content = h("div", {},
      h("p", { class: "small muted" }, `Offene Forderungen: ${eur2(open)} · überfällig: ${inv.filter((r) => r.overdue).length}`),
      h("div", { class: "card" }, table([
        { label: "Nr.", render: (r) => r.number ? h("span", { style: "white-space:nowrap" }, r.number) : h("em", { class: "muted" }, "Entwurf") }, { label: "Kunde", key: "customer_name" },
        { label: "Zeitraum", key: "period" }, { label: "Netto", num: true, render: (r) => eur2(r.net) }, { label: "Brutto", num: true, render: (r) => h("div", {}, eur2(r.gross),
          r.status === "gestellt" && r.paid_amount > 0 ? h("div", { class: "small muted" }, `offen ${eur2(r.gross - r.paid_amount)}`) : null) },
        { label: "Status", render: (r) => h("div", {}, r.overdue ? badge("überfällig", "bad") : badge(INV_STATUS[r.status], { entwurf: "warn", gestellt: "info", bezahlt: "ok", storniert: "" }[r.status]),
          r.sent_at ? h("div", { class: "small muted", title: r.sent_to }, `versendet ${dt(r.sent_at)}`) : null,
          r.dunning_level > 0 && r.status === "gestellt" ? h("div", {}, badge(`Mahnstufe ${r.dunning_level}`, "warn")) : null) },
        { label: "Ablage", render: (r) => docOf[r.id] ? docStatus(docOf[r.id]) : (["gestellt", "bezahlt"].includes(r.status)
          ? h("button", { class: "btn small", title: "PDF im Archiv/SharePoint ablegen", onclick: async (e) => { e.stopPropagation();
            try { await api(`/api/invoices/${r.id}/archive`, { method: "POST" }); toast("Abgelegt"); render(); } catch (err) { toast(err.message, true); } } }, "Ablegen") : "–") },
        { label: "", render: (r) => h("div", { class: "row", style: "justify-content:flex-end" },
          h("a", { class: "btn small", href: `/api/invoices/${r.id}/pdf`, target: "_blank", rel: "noopener", title: r.status === "entwurf" ? "Vorschau des Entwurfs" : "PDF im ME-IT-Design", onclick: (e) => e.stopPropagation() }, "PDF"),
          ["gestellt", "bezahlt"].includes(r.status) ? h("button", { class: `btn small ${r.sent_at ? "" : "primary"}`, onclick: (e) => { e.stopPropagation(); sendDocModal("invoice", r.id, `Rechnung ${r.number}`); } }, r.sent_at ? "Erneut senden" : "Senden") : null,
          ["gestellt", "bezahlt"].includes(r.status) ? h("a", { class: "btn small", href: `/api/invoices/${r.id}/ebinterface.xml`, title: "E-Rechnung ebInterface 6.1 (z. B. Upload auf e-rechnung.gv.at)" }, "E-Rechnung") : null,
          r.status === "entwurf" ? h("button", { class: "btn small", title: "Auftragsreferenz/Bestellnummer des Kunden (Pflicht bei Rechnungen an den Bund)", onclick: async (e) => {
            e.stopPropagation(); const v = prompt("Auftragsreferenz / Bestellnummer des Kunden:", r.order_ref || ""); if (v === null) return;
            await api(`/api/invoices/${r.id}`, { method: "PUT", body: { order_ref: v } }); toast("Gespeichert"); render(); } }, r.order_ref ? `Ref. ${r.order_ref}` : "Auftragsref.") : null,
          r.status === "entwurf" ? act(r, "gestellt", "Stellen", "primary") : null,
          r.status === "gestellt" ? act(r, "bezahlt", "Bezahlt") : null,
          ["gestellt", "bezahlt"].includes(r.status) ? act(r, "storniert", "Storno", "danger") : null,
          r.status === "entwurf" ? h("button", { class: "btn small danger", onclick: async (e) => { e.stopPropagation(); await api(`/api/invoices/${r.id}`, { method: "DELETE" }); toast("Entwurf gelöscht"); render(); } }, "Löschen") : null) },
      ], inv)),
      h("div", { class: "row", style: "margin-top:.8rem" }, h("span", { class: "spacer" }),
        h("a", { class: "btn", href: `/api/invoices/export.csv?year=${new Date().getFullYear()}` }, "Rechnungsausgangsbuch (CSV) für Buchhaltung")));
  } else if (billingTab === "zahlungen") {
    content = await paymentsTab();
  } else if (billingTab === "zeiten") {
    const rows = await api("/api/time?limit=300");
    content = h("div", { class: "card" }, table([
      { label: "Datum", render: (r) => dt(r.date) }, { label: "Kunde", key: "customer_name" }, { label: "Tätigkeit", key: "description" },
      { label: "Min.", key: "minutes", num: true }, { label: "Wer", render: (r) => r.user_name || "–" },
      { label: "Abrechnung", render: (r) => r.invoice_id ? badge("abgerechnet", "ok") : (r.billable ? badge("offen", "warn") : badge("Flatrate")) },
      { label: "", render: (r) => r.invoice_id ? "" : h("button", { class: "btn small danger", onclick: async () => { await api(`/api/time/${r.id}`, { method: "DELETE" }); render(); } }, "×") },
    ], rows));
  } else {
    const p = await api("/api/billing/profile");
    const f = form([
      { name: "name", label: "Firmenname (wie auf der Rechnung)" }, { name: "uid", label: "UID-Nummer" },
      { name: "address", label: "Anschrift", type: "textarea", rows: 3, full: true },
      { name: "email", label: "E-Mail" }, { name: "phone", label: "Telefon" },
      { name: "bank", label: "Bank" }, { name: "iban", label: "IBAN" }, { name: "bic", label: "BIC" },
      { name: "invoice_prefix", label: "Präfix Rechnungsnummer", placeholder: "z. B. RE-" },
      { name: "payment_days", label: "Zahlungsziel (Tage)", type: "number" }, { name: "vat_rate", label: "USt-Satz (%)", type: "number" },
      { name: "round_minutes", label: "Abrechnungstakt (Minuten)", type: "number" },
      { name: "kleinunternehmer", label: "Kleinunternehmer (keine USt)", type: "checkbox" },
      { name: "footer", label: "Fußzeile", full: true },
    ], p);
    content = h("div", { class: "card" }, h("p", { class: "small muted" }, "Pflichtangaben auf Rechnungen (§ 11 UStG): Name/Anschrift, UID, fortlaufende Nummer, Datum, Leistungszeitraum, Netto, Steuersatz, Steuerbetrag. Ab € 10.000 brutto auch die UID des Kunden (beim Kunden hinterlegen)."), f,
      h("div", { class: "row", style: "margin-top:1rem" }, h("span", { class: "spacer" }), h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
        await api("/api/billing/profile", { method: "PUT", body: readForm(f) }); toast("Gespeichert");
      }) }, "Speichern")));
  }
  show(tabs, content);
};

// ---- Wartungsplan
let maintTab = "faellig";
const M_RESULT = { ok: ["in Ordnung", "ok"], hinweis: ["Hinweis", "warn"], problem: ["Problem", "bad"] };
const M_INTERVAL = { woche: "wöchentlich", monat: "monatlich", quartal: "vierteljährlich", halbjahr: "halbjährlich", jahr: "jährlich" };
const resultBadge = (r) => r ? badge(...(M_RESULT[r] || [r])) : h("span", { class: "muted" }, "–");

function completeRun(run) {
  const boxes = run.checklist.map((i) => h("input", { type: "checkbox", checked: i.done, style: "width:auto" }));
  let result = "ok";
  const seg = h("div", { class: "seg" }, Object.entries(M_RESULT).map(([k, [l]]) => h("label", {},
    h("input", { type: "radio", name: "mresult", value: k, checked: k === "ok", onchange: () => { result = k; follow.parentElement.hidden = k !== "problem"; } }), h("span", {}, l))));
  const note = h("textarea", { rows: 3, placeholder: "Was wurde festgestellt/gemacht? (Hinweise und Probleme erscheinen im Monatsbericht)" });
  const minutes = h("input", { type: "number", value: 15, min: 0, style: "max-width:120px" });
  const follow = h("input", { type: "checkbox", checked: true, style: "width:auto" });
  modal(`Wartung: ${run.title}`, h("div", { class: "stack" },
    h("p", { class: "small muted", style: "margin:0" }, `${run.customer_name} · fällig ${dt(run.due_date)}`),
    h("div", {}, h("label", {}, "Checkliste"), run.checklist.length ? run.checklist.map((i, n) => h("label", { class: "row", style: "gap:.5rem;font-weight:400" }, boxes[n], h("span", {}, i.item)))
      : h("p", { class: "muted" }, "Keine Checkliste hinterlegt.")),
    h("div", {}, h("label", {}, "Ergebnis"), seg),
    h("div", {}, h("label", {}, "Notiz"), note),
    h("div", { class: "row" }, h("div", {}, h("label", {}, "Zeit (Minuten)"), minutes),
      h("label", { class: "row", style: "gap:.5rem;font-weight:400;margin-top:1.4rem", hidden: true }, follow, h("span", {}, "Folgeticket (Priorität hoch) anlegen")))), [
    (close) => h("button", { class: "btn", onclick: (e) => withBusy(e.target, async () => {
      if (!note.value.trim() && !confirm("Ohne Begründung überspringen?")) return;
      await api(`/api/maintenance/runs/${run.id}/complete`, { method: "POST", body: { skip: true, note: note.value } }); close(); toast("Übersprungen – nächster Termin geplant"); render();
    }) }, "Überspringen"),
    (close) => h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
      const r = await api(`/api/maintenance/runs/${run.id}/complete`, { method: "POST", body: {
        done: boxes.map((b) => b.checked), result, note: note.value, minutes: Number(minutes.value) || 0, followup: follow.checked } });
      close(); toast(r.followup_ticket_id ? `Erledigt – Folgeticket #${r.followup_ticket_id} angelegt` : "Wartung dokumentiert"); render();
    }) }, "Abschließen"),
  ]);
}

function taskForm(t = null, customerId = null) {
  const f = form([
    ...(t ? [] : [{ name: "customer_id", label: "Kunde", type: "select", options: customerOptions(), value: customerId || "" }]),
    { name: "title", label: "Prüfung", required: true, full: true },
    { name: "interval", label: "Rhythmus", type: "select", options: Object.entries(M_INTERVAL) },
    { name: "next_due", label: "Nächste Fälligkeit", type: "date" },
    { name: "assigned_to", label: "Zuständig", type: "select", options: [["", "– automatisch –"], ...state.users.map((u) => [u.id, u.name])] },
    { name: "estimate_min", label: "Aufwand (Minuten)", type: "number" },
    { name: "checklist", label: "Checkliste (eine Zeile pro Punkt)", type: "textarea", rows: 5, full: true },
    ...(t ? [{ name: "active", label: "aktiv", type: "checkbox" }] : []),
  ], t ? { ...t, checklist: (t.checklist || []).join("\n"), assigned_to: t.assigned_to || "" } : { interval: "monat", estimate_min: 15 });
  modal(t ? "Prüfung bearbeiten" : "Neue Prüfung", f, [
    t ? (close) => h("button", { class: "btn danger", onclick: async () => { if (!confirm("Prüfung löschen? Bisherige Nachweise bleiben nicht erhalten.")) return;
      await api(`/api/maintenance/tasks/${t.id}`, { method: "DELETE" }); close(); render(); } }, "Löschen") : null,
    (close) => h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
      const d = readForm(f);
      d.checklist = d.checklist.split("\n").map((x) => x.trim()).filter(Boolean);
      d.assigned_to = d.assigned_to ? Number(d.assigned_to) : null;
      if (!d.next_due) delete d.next_due;
      if (t) await api(`/api/maintenance/tasks/${t.id}`, { method: "PUT", body: d });
      else await api("/api/maintenance/tasks", { method: "POST", body: { ...d, customer_id: Number(d.customer_id) } });
      close(); toast("Gespeichert"); render();
    }) }, "Speichern"),
  ].filter(Boolean));
}

async function planWizard(customerId, customerName) {
  const s = await api(`/api/maintenance/suggest/${customerId}`);
  if (!s.templates.length) return toast("Alle passenden Standard-Prüfungen sind bereits angelegt – eigene über „+ Prüfung“.");
  const boxes = s.templates.map((t) => [t.key, h("input", { type: "checkbox", checked: true, style: "width:auto" })]);
  modal(`Wartungsplan für ${customerName}`, h("div", { class: "stack" },
    h("p", { class: "small muted", style: "margin:0" }, "Vorschlag passend zu den gebuchten Leistungen und Geräten. Fälligkeiten werden über den Monat verteilt, Tickets entstehen automatisch 3 Tage vorher."),
    s.templates.map((t, i) => h("label", { class: "row", style: "gap:.5rem;font-weight:400;align-items:flex-start" }, boxes[i][1],
      h("span", {}, h("strong", {}, t.title), ` · ${M_INTERVAL[t.interval]}`, h("div", { class: "small muted" }, t.checklist.join(" · ")))))), [
    (close) => h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
      const r = await api("/api/maintenance/plan", { method: "POST", body: { customer_id: customerId, templates: boxes.filter(([, b]) => b.checked).map(([k]) => k) } });
      close(); toast(`${r.created} Prüfung(en) angelegt`); render();
    }) }, "Plan anlegen")]);
}

async function maintenanceCard(c) {
  const tasks = await api(`/api/maintenance/tasks?customer_id=${c.id}`).catch(() => []);
  const month = new Date().toISOString().slice(0, 7);
  return h("div", { class: "card", style: "margin-bottom:1rem" },
    h("div", { class: "card-head" }, h("h2", {}, `Wartungsplan (${tasks.filter((t) => t.active).length})`),
      h("div", { class: "row" },
        tasks.length ? h("a", { class: "btn small", href: `/api/maintenance/protocol.pdf?customer_id=${c.id}&month=${month}`, target: "_blank", rel: "noopener" }, "Protokoll (PDF)") : null,
        tasks.length ? h("button", { class: "btn small", title: "Wartungsprotokoll des Monats im Kundenordner ablegen (lokal + SharePoint/OneDrive)", onclick: (e) => withBusy(e.target, async () => {
          const d = await api("/api/maintenance/protocol", { method: "POST", body: { customer_id: c.id, month } }); toast(`Abgelegt in ${d.folder}`); }) }, "Protokoll ablegen") : null,
        h("button", { class: "btn small", onclick: () => planWizard(c.id, c.name) }, "Standard-Plan"),
        h("button", { class: "btn small", onclick: () => taskForm(null, c.id) }, "+ Prüfung"))),
    tasks.length ? table([
      { label: "Prüfung", render: (t) => h("div", {}, t.title, t.active ? null : h("span", { class: "small muted" }, " (pausiert)")) },
      { label: "Rhythmus", render: (t) => M_INTERVAL[t.interval] || t.interval },
      { label: "Nächste", render: (t) => dt(t.next_due) },
      { label: "Zuletzt", render: (t) => t.last_done_at ? h("div", { class: "row", style: "gap:.4rem" }, dt(t.last_done_at), resultBadge(t.last_result)) : "–" },
    ], tasks, (t) => taskForm(t)) : h("p", { class: "small muted", style: "margin:0" },
      (c.package || "keins") !== "keins" ? "Noch kein Wartungsplan – „Standard-Plan“ schlägt passende Prüfungen vor (Backup-Restore-Test, Patch-Status, Security …). Nachweise erscheinen im Monatsbericht und im Kundenportal."
        : "Kein Betreuungsvertrag – Wartungsplan ist ein gutes Argument für Managed Services."));
}

views.wartung = async () => {
  await Promise.all([loadCustomers(), loadUsers()]);
  setTitle("Wartung", [h("button", { class: "btn primary", onclick: () => taskForm() }, "+ Prüfung")]);
  const ov = await api("/api/maintenance");
  const kpi = (label, value, sub, cls = "") => h("div", { class: `card kpi ${cls}` }, h("div", { class: "label" }, label), h("div", { class: "value" }, value), h("div", { class: "sub" }, sub));
  let content;
  if (maintTab === "faellig") {
    const runs = await api("/api/maintenance/runs?status=offen");
    content = h("div", { class: "card" }, table([
      { label: "Fällig", render: (r) => h("div", {}, dt(r.due_date), r.overdue ? h("div", {}, badge("überfällig", "bad")) : null) },
      { label: "Kunde", render: (r) => h("a", { href: `#/kunde/${r.customer_id}` }, r.customer_name) },
      { label: "Prüfung", render: (r) => h("div", {}, r.title, h("div", { class: "small muted" }, `${r.checklist.length} Punkte · ${M_INTERVAL[r.interval] || ""}`)) },
      { label: "Zuständig", render: (r) => r.assigned_name || "–" },
      { label: "Ticket", render: (r) => r.ticket_id ? h("a", { href: "#", onclick: (e) => { e.preventDefault(); ticketDetail(r.ticket_id); } }, `#${r.ticket_id}`) : "–" },
      { label: "", render: (r) => h("button", { class: "btn small primary", onclick: () => completeRun(r) }, "Abschließen") },
    ], runs));
  } else if (maintTab === "plan") {
    const tasks = await api("/api/maintenance/tasks");
    const managed = state.customers.filter((c) => (c.package || "keins") !== "keins" && !tasks.some((t) => t.customer_id === c.id && t.active));
    content = h("div", {},
      managed.length ? h("div", { class: "card", style: "margin-bottom:1rem;border-left:4px solid var(--accent)" },
        h("h2", {}, `${managed.length} Managed-Kunde(n) ohne Wartungsplan`),
        h("div", { class: "row" }, managed.map((c) => h("button", { class: "btn small", onclick: () => planWizard(c.id, c.name) }, `${c.name} → Plan anlegen`)))) : null,
      h("div", { class: "card" }, table([
        { label: "Kunde", render: (t) => h("a", { href: `#/kunde/${t.customer_id}`, onclick: (e) => e.stopPropagation() }, t.customer_name) },
        { label: "Prüfung", render: (t) => h("div", {}, t.title, t.active ? null : h("span", { class: "small muted" }, " (pausiert)")) },
        { label: "Rhythmus", render: (t) => M_INTERVAL[t.interval] || t.interval }, { label: "Nächste", render: (t) => dt(t.next_due) },
        { label: "Zuletzt", render: (t) => t.last_done_at ? h("div", { class: "row", style: "gap:.4rem" }, dt(t.last_done_at), resultBadge(t.last_result)) : "–" },
        { label: "Zuständig", render: (t) => t.assigned_name || "automatisch" },
      ], tasks, (t) => taskForm(t))));
  } else {
    const runs = (await api("/api/maintenance/runs?limit=200")).filter((r) => r.status !== "offen");
    content = h("div", { class: "card" }, table([
      { label: "Erledigt", render: (r) => dt(r.done_at) }, { label: "Kunde", key: "customer_name" }, { label: "Prüfung", key: "title" },
      { label: "Ergebnis", render: (r) => r.status === "uebersprungen" ? badge("übersprungen") : resultBadge(r.result) },
      { label: "Checkliste", render: (r) => `${r.checklist.filter((i) => i.done).length}/${r.checklist.length}` },
      { label: "Notiz", render: (r) => h("span", { class: "small" }, r.note || "–") }, { label: "Von", render: (r) => r.done_by_name || "–" },
    ], runs));
  }
  show(
    h("div", { class: "grid kpis" },
      kpi("Fällig", ov.open, `${ov.overdue} überfällig`, ov.overdue ? "" : "accent"),
      kpi("Nächste 7 Tage", ov.next_7_days, "Prüfungen werden zu Tickets"),
      kpi("Erledigt (Monat)", ov.done_this_month, "Nachweis im Monatsbericht & Portal"),
      kpi("Prüfungen im Plan", ov.tasks, ov.customers_without_plan ? `${ov.customers_without_plan} Managed-Kunde(n) ohne Plan` : "alle Managed-Kunden abgedeckt")),
    h("div", { class: "tabs" }, [["faellig", `Fällig (${ov.open})`], ["plan", "Plan"], ["erledigt", "Erledigt"]].map(([k, l]) =>
      h("button", { class: maintTab === k ? "active" : "", onclick: () => { maintTab = k; render(); } }, l))),
    content,
    h("p", { class: "small muted" }, "Wiederkehrende Prüfungen werden 3 Tage vor Fälligkeit automatisch zu Tickets. Abschluss mit Checkliste und Ergebnis = Nachweis für Monatsbericht, QBR, Kundenportal und NIS2 (regelmäßige Überprüfung der Maßnahmen). Geplante Wartung zählt nicht in die SLA."));
};

// ---- Zahlungen & Mahnwesen
let bankFilter = "pruefen";
const BANK_STATUS = { offen: ["offen", "warn"], vorschlag: ["Vorschlag", "info"], zugeordnet: ["zugeordnet", "ok"], ignoriert: ["ignoriert", ""], beleg_fehlt: ["Beleg fehlt", "bad"] };

async function paymentsTab() {
  const isAdmin = !state.auth?.login_required || state.auth?.user?.role === "admin";
  const [s, dun] = await Promise.all([api("/api/payments/summary"), api("/api/dunning")]);
  const bank = isAdmin ? await api(`/api/bank${bankFilter === "pruefen" ? "?status=offen,vorschlag&direction=in" : bankFilter === "belege" ? "?status=beleg_fehlt" : "?limit=300"}`).catch(() => []) : [];
  const kpi = (label, value, sub, cls = "") => h("div", { class: `card kpi ${cls}` }, h("div", { class: "label" }, label), h("div", { class: "value" }, value), h("div", { class: "sub" }, sub));
  const upload = h("input", { type: "file", accept: ".csv,.txt,.xml,.sta,.mt940,.940", multiple: true, hidden: true, onchange: async (e) => {
    for (const f of e.target.files) {
      const res = await fetch("/api/bank/import", { method: "POST", body: f, headers: { "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(f.name) } });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast(`${f.name}: ${d.detail || "Import fehlgeschlagen"}`, true); continue; }
      toast(`${f.name}: ${d.imported} neu (${d.duplicates} schon bekannt) · ${d.matched} Rechnung(en) bezahlt · ${d.suggested} Vorschläge · ${d.receipts_linked} Belege gefunden`);
    }
    render();
  } });
  const aging = s.aging; const agingTotal = Math.max(1, s.open_total);
  const seg = (v, color, label) => v > 0 ? h("span", { title: `${label}: ${eur2(v)}`, style: `width:${(v / agingTotal) * 100}%;background:${color}` }) : null;
  const sendDunning = async (p) => {
    const m = await api(`/api/dunning/${p.invoice_id}/mail`);
    const f = form([{ name: "to", label: "An", required: true }, { name: "cc", label: "Kopie (CC)" }, { name: "subject", label: "Betreff", full: true },
      { name: "text", label: "Nachricht (erscheint auch im Mahnschreiben)", type: "textarea", rows: 10, full: true }], m);
    modal(`${m.level} – Rechnung ${m.number}`, h("div", {},
      h("p", { class: "small muted" }, `${m.customer_name} · ${m.days_overdue} Tage überfällig · offen ${eur2(m.open)}${m.fees || m.interest ? `${m.fees ? ` + Spesen ${eur2(m.fees)}` : ""}${m.interest ? ` + Zinsen ${eur2(m.interest)}` : ""} = ${eur2(m.total)}` : ""}. Anhänge: Mahnschreiben (PDF mit QR-Code) + Rechnung.`),
      f, h("p", { class: "small", style: "margin-bottom:0" }, h("a", { href: `/api/dunning/${p.invoice_id}/pdf`, target: "_blank", rel: "noopener" }, "Mahnschreiben-Vorschau (PDF)"))), [
      (close) => h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
        const r = await api(`/api/dunning/${p.invoice_id}/send`, { method: "POST", body: readForm(f) }); close(); toast(`${r.level} an ${r.to} gesendet`); render();
      }) }, "Senden")]);
  };
  const assignInvoice = async (t) => {
    const rest = (i) => i.gross - (i.paid_amount || 0);
    const open = (await api("/api/invoices?status=gestellt")).filter((i) => rest(i) > 0.004)
      .sort((a, b) => (b.customer_id === t.customer_id) - (a.customer_id === t.customer_id));
    const mine = open.filter((i) => t.customer_id && i.customer_id === t.customer_id);
    const exact = open.filter((i) => Math.abs(rest(i) - t.amount) < 0.01);
    const pre = mine.length === 1 ? mine[0].id : exact.length === 1 ? exact[0].id : null;
    const box = h("div", { class: "stack" }, open.length ? open.map((i) => h("label", { class: "row", style: "gap:.5rem;font-weight:400" },
      h("input", { type: "checkbox", value: i.id, style: "width:auto", checked: i.id === pre }),
      h("span", {}, `${i.number} · ${i.customer_name} · offen ${eur2(rest(i))}`, i.customer_id === t.customer_id ? h("strong", {}, " · erkannter Kunde") : null))) : h("p", { class: "muted" }, "Keine offenen Rechnungen."));
    modal(`Zahlung ${eur2(t.amount)} zuordnen`, h("div", {}, h("p", { class: "small muted" }, `${t.partner || "–"} · ${t.text || ""}`), box), [
      (close) => h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
        const ids = [...box.querySelectorAll("input:checked")].map((x) => Number(x.value));
        if (!ids.length) throw new Error("Bitte mindestens eine Rechnung wählen");
        const r = await api(`/api/bank/${t.id}/assign`, { method: "POST", body: { invoice_ids: ids } }); close(); toast(r.match_note); render();
      }) }, "Zuordnen")]);
  };
  const assignReceipt = async (t) => {
    const receipts = (await api("/api/receipts")).sort((a, b) => Math.abs(a.amount + t.amount) - Math.abs(b.amount + t.amount)).slice(0, 25);
    const sel = h("select", {}, receipts.map((r) => h("option", { value: r.id }, `${dt(r.invoice_date)} · ${r.vendor || "–"} · ${r.invoice_no || ""} · ${eur2(r.amount)}`)));
    modal(`Beleg für ${eur2(-t.amount)} zuordnen`, h("div", {}, h("p", { class: "small muted" }, `${t.partner || "–"} · ${t.text || ""}`),
      receipts.length ? sel : h("p", { class: "muted" }, "Keine Belege vorhanden – PDF unter Belege hochladen."),
      h("p", { class: "small" }, h("a", { href: "#/belege" }, "Beleg fehlt? → Belege → PDF hochladen"))), [
      (close) => h("button", { class: "btn primary", disabled: !receipts.length, onclick: (e) => withBusy(e.target, async () => {
        await api(`/api/bank/${t.id}/assign`, { method: "POST", body: { receipt_id: Number(sel.value) } }); close(); toast("Beleg zugeordnet"); render();
      }) }, "Zuordnen")]);
  };
  const txAction = (t) => h("div", { class: "row", style: "justify-content:flex-end;flex-wrap:nowrap" },
    t.status === "vorschlag" ? h("button", { class: "btn small primary", onclick: async () => { try { const r = await api(`/api/bank/${t.id}/accept`, { method: "POST" }); toast(r.match_note); render(); } catch (err) { toast(err.message, true); } } }, "Übernehmen") : null,
    ["offen", "vorschlag"].includes(t.status) ? h("button", { class: "btn small", onclick: () => assignInvoice(t) }, "Zuordnen") : null,
    t.status === "beleg_fehlt" ? h("button", { class: "btn small", onclick: () => assignReceipt(t) }, "Beleg wählen") : null,
    ["offen", "vorschlag", "beleg_fehlt"].includes(t.status) ? h("button", { class: "btn small", title: t.amount < 0 ? "z. B. Bankspesen, Abgaben – kein eigener Beleg nötig" : "z. B. Privateinlage, Umbuchung", onclick: async () => {
      await api(`/api/bank/${t.id}/ignore`, { method: "POST", body: { note: t.amount < 0 ? "kein Beleg nötig" : "ignoriert" } }); render(); } }, t.amount < 0 ? "Kein Beleg nötig" : "Ignorieren") : null,
    t.status === "zugeordnet" ? h("button", { class: "btn small", onclick: async () => { if (!confirm("Zuordnung lösen? Bezahlte Rechnungen werden wieder offen.")) return; await api(`/api/bank/${t.id}/unassign`, { method: "POST" }); render(); } }, "Lösen") : null);
  const bankTable = table([
    { label: "Datum", render: (t) => dt(t.booking_date) },
    { label: "Auftraggeber/Empfänger", render: (t) => h("div", {}, t.partner || "–", t.iban ? h("div", { class: "small muted" }, t.iban) : null) },
    { label: "Verwendungszweck", render: (t) => h("div", { class: "small", style: "max-width:340px" }, t.text || "–", t.match_note ? h("div", { class: "muted" }, t.match_note) : null) },
    { label: "Betrag", num: true, render: (t) => h("span", { style: `color:var(--${t.amount < 0 ? "bad" : "ok"});white-space:nowrap` }, eur2(t.amount)) },
    { label: "Status", render: (t) => h("div", {}, badge(...(BANK_STATUS[t.status] || [t.status])),
      t.invoice_numbers ? h("div", { class: "small muted" }, t.invoice_numbers) : null, t.receipt_vendor ? h("div", { class: "small muted" }, `Beleg: ${t.receipt_vendor}`) : null) },
    { label: "", render: txAction },
  ], bank);
  const conf = isAdmin ? await api("/api/dunning/settings") : null;
  return h("div", {},
    h("div", { class: "grid kpis" },
      kpi("Offene Forderungen", eur2(s.open_total), `davon überfällig ${eur2(s.overdue_total)}`, "accent"),
      kpi("Ø Zahlungsdauer (DSO)", s.dso === null ? "–" : `${s.dso} Tage`, `aus ${s.paid_count_180} bezahlten Rechnungen (180 Tage)`),
      kpi("Mahnvorschläge", dun.proposals.length, dun.escalations.length ? `${dun.escalations.length} × alle Stufen ausgeschöpft` : "nach Fälligkeit + Kulanz"),
      kpi("Ausgaben ohne Beleg", s.missing_receipts, s.missing_receipts ? `${eur2(s.missing_receipts_sum)} – für den Steuerberater nachreichen` : "alles belegt")),
    h("div", { class: "card", style: "margin-bottom:1rem" },
      h("div", { class: "card-head" }, h("h2", {}, "Altersstruktur offener Rechnungen"), h("span", { class: "small muted" }, `Kontoauszug zuletzt: ${s.last_import ? dt(s.last_import) : "noch nie"}`)),
      h("div", { class: "bar stack-bar", style: "height:14px;display:flex;overflow:hidden" },
        seg(aging.nicht_faellig, "var(--ok)", "nicht fällig"), seg(aging["1_30"], "var(--accent)", "1–30 Tage"), seg(aging["31_60"], "#e8590c", "31–60 Tage"), seg(aging.ueber_60, "var(--bad)", "> 60 Tage")),
      h("div", { class: "row small", style: "margin-top:.5rem;gap:1rem" },
        h("span", {}, `nicht fällig ${eur2(aging.nicht_faellig)}`), h("span", {}, `1–30 Tage ${eur2(aging["1_30"])}`), h("span", {}, `31–60 Tage ${eur2(aging["31_60"])}`), h("span", {}, `> 60 Tage ${eur2(aging.ueber_60)}`)),
      s.iban_ok ? null : h("p", { class: "small", style: "color:var(--warn);margin-bottom:0" }, "Hinweis: Unter „Firmendaten“ ist keine gültige IBAN hinterlegt – ohne IBAN kein QR-Code „Zahlen mit Code“ auf Rechnungen und Mahnungen.")),
    h("div", { class: "card", style: "margin-bottom:1rem" },
      h("div", { class: "card-head" }, h("h2", {}, `Mahnwesen (${dun.proposals.length})`),
        dun.proposals.length && isAdmin ? h("button", { class: "btn small primary", onclick: (e) => withBusy(e.target, async () => {
          if (!confirm(`${dun.proposals.length} Mahnung(en) jetzt per Mail versenden?`)) return;
          const r = await api("/api/dunning/run", { method: "POST" }); toast(`${r.sent} versendet${r.errors.length ? `, ${r.errors.length} Fehler: ${r.errors[0].error}` : ""}`, r.errors.length > 0); render();
        }) }, "Alle senden") : null),
      h("p", { class: "small muted" }, conf && conf.auto_send ? (dun.autopilot.ready ? "Autopilot aktiv: fällige Mahnungen gehen täglich ab 8 Uhr automatisch hinaus." : `Autopilot pausiert: ${dun.autopilot.reason}.`)
        : "Freigabe-Modus: Vorschläge prüfen und senden. Tipp: vorher den aktuellen Kontoauszug importieren, damit niemand gemahnt wird, der schon bezahlt hat."),
      table([
        { label: "Rechnung", render: (p) => h("span", { style: "white-space:nowrap" }, p.number) }, { label: "Kunde", key: "customer_name" },
        { label: "überfällig", num: true, render: (p) => `${p.days_overdue} Tage` }, { label: "offen", num: true, render: (p) => eur2(p.open) },
        { label: "Stufe", render: (p) => badge(p.level, p.level_index === 0 ? "info" : "warn") }, { label: "Gesamt", num: true, render: (p) => eur2(p.total) },
        { label: "", render: (p) => h("div", { class: "row", style: "justify-content:flex-end;flex-wrap:nowrap" },
          h("a", { class: "btn small", href: `/api/dunning/${p.invoice_id}/pdf`, target: "_blank", rel: "noopener" }, "PDF"),
          isAdmin ? h("button", { class: "btn small primary", onclick: () => sendDunning(p) }, "Senden") : null) },
      ], dun.proposals),
      dun.escalations.length ? h("div", { style: "margin-top:.8rem" }, h("strong", {}, "Alle Mahnstufen ausgeschöpft – persönlich anrufen oder Inkasso:"),
        h("ul", { class: "list" }, dun.escalations.map((p) => h("li", {}, `${p.number} · ${p.customer_name} · ${p.days_overdue} Tage · ${eur2(p.total)}`)))) : null),
    isAdmin ? h("div", { class: "card", style: "margin-bottom:1rem" },
      h("div", { class: "card-head" }, h("h2", {}, "Kontoauszug & Zahlungsabgleich"),
        h("div", { class: "row" }, upload, h("button", { class: "btn small primary", onclick: () => upload.click() }, "Kontoauszug importieren"),
          h("button", { class: "btn small", onclick: (e) => withBusy(e.target, async () => { const r = await api("/api/bank/rematch", { method: "POST" }); toast(`${r.matched} zugeordnet, ${r.suggested} Vorschläge, ${r.receipts_linked} Belege gefunden`); render(); }) }, "Neu abgleichen"))),
      h("p", { class: "small muted" }, "CSV aus George, ELBA, Bank Austria & Co., CAMT.053 (XML) oder MT940. Zahlungen mit Rechnungsnummer im Verwendungszweck werden automatisch verbucht (auch Teil- und Sammelzahlungen), sonst gibt es Vorschläge über Kunde/IBAN und Betrag. Abbuchungen werden mit den Belegen abgeglichen."),
      h("div", { class: "tabs" }, [["pruefen", `Zu prüfen (${s.unassigned})`], ["belege", `Ausgaben ohne Beleg (${s.missing_receipts})`], ["alle", "Alle Buchungen"]].map(([k, l]) =>
        h("button", { class: bankFilter === k ? "active" : "", onclick: () => { bankFilter = k; render(); } }, l))),
      bankTable) : null,
    conf ? dunningSettingsCard(conf) : null);
}

function dunningSettingsCard(conf) {
  const levelForms = conf.levels.map((lv) => form([
    { name: "name", label: "Bezeichnung" }, { name: "days", label: "ab Tagen nach Fälligkeit", type: "number" },
    { name: "fee", label: "Mahnspesen (€)", type: "number", step: "0.01" }, { name: "payment_days", label: "Neue Frist (Tage)", type: "number" },
    { name: "subject", label: "Betreff", full: true }, { name: "text", label: "Text", type: "textarea", rows: 7, full: true }], lv));
  const general = form([
    { name: "auto_send", label: "Autopilot: fällige Mahnungen täglich automatisch senden", type: "checkbox", full: true },
    { name: "min_days_between", label: "Mindestabstand zwischen Stufen (Tage)", type: "number" },
    { name: "interest_rate", label: "Verzugszinsen % p. a. (0 = keine)", type: "number", step: "0.01" },
    { name: "max_import_age_days", label: "Autopilot nur bei Kontoauszug jünger als (Tage)", type: "number" }], conf);
  return h("details", { class: "card" }, h("summary", { style: "cursor:pointer;font-weight:600" }, "Einstellungen Mahnwesen"),
    h("p", { class: "small muted" }, "Platzhalter: {anrede} {nummer} {datum} {betrag} {offen} {gesamt} {faellig} {frist} {tage} {firma} {kunde}. Rechtlicher Rahmen B2B (Österreich): Verzugszinsen 9,2 %-Punkte über dem Basiszinssatz (§ 456 UGB), Pauschale € 40 (§ 458 UGB); gegenüber Verbrauchern 4 % (§ 1000 ABGB). Mahnspesen nur, wenn vereinbart bzw. angemessen."),
    general,
    levelForms.map((f, i) => h("div", { style: "margin-top:1rem;padding-top:.8rem;border-top:1px solid var(--border)" }, h("h3", { style: "margin:.2rem 0 .6rem" }, `Stufe ${i + 1}`), f)),
    h("div", { class: "row", style: "margin-top:1rem" }, h("span", { class: "spacer" }), h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
      await api("/api/dunning/settings", { method: "PUT", body: { ...readForm(general), levels: levelForms.map(readForm) } }); toast("Mahnwesen gespeichert"); render();
    }) }, "Speichern")));
}

// ---- Kundenportal (Verwaltung)
async function portalCard(c) {
  let users = [];
  try { users = await api(`/api/customers/${c.id}/portal-users`); } catch { users = []; }
  const showPw = (email, pw) => modal("Zugangsdaten Kundenportal", h("div", {},
    h("p", {}, "Bitte jetzt sicher an den Kunden übermitteln (z. B. Passwort per SMS, Link per Mail). Das Passwort wird nicht noch einmal angezeigt."),
    h("pre", { style: "background:var(--surface-2);padding:.8rem;border-radius:8px" }, `Portal:   ${location.origin}/portal\nE-Mail:   ${email}\nPasswort: ${pw}`)),
    [copyButton(() => `Portal: ${location.origin}/portal\nE-Mail: ${email}\nPasswort: ${pw}`, "Kopieren")]);
  return h("div", { class: "card", style: "margin-bottom:1rem" },
    h("div", { class: "card-head" }, h("h2", {}, "Kundenportal"), h("div", { class: "row" },
      h("a", { class: "btn small", href: "/portal", target: "_blank", rel: "noopener" }, "Portal öffnen"),
      h("button", { class: "btn small", onclick: () => {
        const f = form([{ name: "name", label: "Name" }, { name: "email", label: "E-Mail", type: "email", value: c.email }]);
        modal("Portalzugang anlegen", f, [(close) => h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
          const r = await api(`/api/customers/${c.id}/portal-users`, { method: "POST", body: readForm(f) }); close(); showPw(r.email, r.password); render();
        }) }, "Anlegen")]);
      } }, "+ Zugang"))),
    users.length ? table([{ label: "Name", key: "name" }, { label: "E-Mail", key: "email" }, { label: "Aktiv", render: (r) => r.active ? badge("aktiv", "ok") : badge("gesperrt", "warn") },
      { label: "Letzte Anmeldung", render: (r) => r.last_login_at || "–" },
      { label: "", render: (r) => h("div", { class: "row" },
        h("button", { class: "btn small", onclick: async () => { const x = await api(`/api/portal-users/${r.id}`, { method: "PUT", body: { reset_password: true } }); showPw(r.email, x.password); } }, "Neues Passwort"),
        h("button", { class: "btn small", onclick: async () => { await api(`/api/portal-users/${r.id}`, { method: "PUT", body: { active: !r.active } }); render(); } }, r.active ? "Sperren" : "Freischalten")) }], users)
      : h("p", { class: "small muted", style: "margin:0" }, "Noch kein Zugang. Im Portal sieht der Kunde seine Tickets, Geräte, Angebote (online annehmen) und Rechnungen und bekommt KI-Hilfe aus freigegebenen Anleitungen."));
}

// ---- SLA
function slaBadge(sla) {
  if (!sla) return "–";
  const parts = [["Reaktion", sla.response], ["Lösung", sla.resolution]].filter(([, x]) => x && x.state !== "keine Zusage");
  if (!parts.length) return h("span", { class: "small muted" }, "keine Zusage");
  const worst = parts.find(([, x]) => x.state === "verletzt") || parts.find(([, x]) => x.state === "knapp") || parts.find(([, x]) => x.state === "ok") || parts[0];
  const [label, x] = worst;
  const cls = { verletzt: "bad", knapp: "warn", ok: "", "erfüllt": "ok" }[x.state] || "";
  const txt = x.state === "erfüllt" ? "erfüllt" : x.state === "verletzt" ? `${label} überfällig` : `${label} in ${String(x.left_h).replace(".", ",")} h`;
  return badge(txt, cls);
}

views.sla = async () => {
  setTitle("SLA – Reaktions- & Lösungszeiten");
  const o = await api("/api/sla?days=30");
  const kpi = (label, value, sub, cls = "") => h("div", { class: `card kpi ${cls}` }, h("div", { class: "label" }, label), h("div", { class: "value" }, value), h("div", { class: "sub" }, sub));
  const prios = ["kritisch", "hoch", "normal", "niedrig"];
  const inputs = {};
  const cfgRows = Object.entries(o.config.packages).map(([pkg, pr]) => h("tr", {}, h("td", {}, h("strong", {}, pkg)),
    prios.map((p) => h("td", {}, h("div", { class: "row", style: "flex-wrap:nowrap;gap:.25rem" }, ...[0, 1].map((i) => {
      const el = h("input", { type: "number", step: "0.5", min: "0", value: pr[p][i] ?? "", placeholder: "–", style: "width:58px;padding:.3rem .4rem", title: i ? "Lösung (h)" : "Reaktion (h)" });
      (inputs[pkg] ??= {})[p] ??= []; inputs[pkg][p][i] = el; return el;
    }))))));
  show(
    h("div", { class: "grid kpis" },
      kpi("SLA verletzt (offen)", o.breached_open, "sofort handeln", o.breached_open ? "" : ""),
      kpi("Knapp (offen)", o.at_risk_open, "wird bald fällig"),
      kpi("Erfüllungsquote", o.quote !== null ? `${Math.round(o.quote)} %` : "–", `letzte ${o.days} Tage`, o.quote >= 95 ? "accent" : "")),
    h("div", { class: "card" }, h("h2", {}, "Offene Tickets nach Dringlichkeit"), table([
      { label: "#", key: "id" }, { label: "Ticket", key: "title" }, { label: "Kunde", render: (r) => r.customer || "–" }, { label: "Prio", render: (r) => badge(r.priority) },
      { label: "Reaktion", render: (r) => slaBadge({ response: r.sla.response, resolution: { state: "keine Zusage" } }) },
      { label: "Lösung", render: (r) => slaBadge({ resolution: r.sla.resolution, response: { state: "keine Zusage" } }) },
      { label: "Paket", render: (r) => r.sla.package },
    ], o.open, (r) => ticketDetail(r.id))),
    h("div", { class: "grid two", style: "margin-top:1rem" },
      h("div", { class: "card" }, h("h2", {}, "Erfüllung je Kunde (30 Tage)"), table([
        { label: "Kunde", render: (r) => h("a", { href: `#/kunde/${r.customer_id}` }, r.customer) }, { label: "Paket", key: "package" },
        { label: "Tickets", key: "tickets", num: true }, { label: "Verletzt", key: "breached", num: true },
        { label: "Quote", num: true, render: (r) => r.quote === null ? "–" : badge(`${Math.round(r.quote)} %`, r.quote >= 95 ? "ok" : r.quote >= 80 ? "warn" : "bad") },
      ], o.customers)),
      h("div", { class: "card" }, h("h2", {}, "Zusagen je Paket (Geschäftsstunden: Reaktion / Lösung)"),
        h("p", { class: "small muted" }, `Geschäftszeiten: ${o.config.business_hours.start}–${o.config.business_hours.end} Uhr, Mo–Fr. Leer = keine Zusage. Diese Werte gehören in eure Verträge.`),
        h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Paket"), prios.map((p) => h("th", {}, p)))), h("tbody", {}, cfgRows))),
        h("div", { class: "row", style: "margin-top:.6rem" }, h("span", { class: "spacer" }), h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
          const packages = {};
          for (const [pkg, pr] of Object.entries(inputs)) { packages[pkg] = {}; for (const [p, els] of Object.entries(pr)) packages[pkg][p] = els.map((el) => el.value === "" ? null : Number(el.value)); }
          await api("/api/sla/config", { method: "PUT", body: { packages } }); toast("SLA-Zusagen gespeichert"); render();
        }) }, "Speichern")))));
};

// ---- Lizenzen & Verträge
const SUB_STATE = { "abgelaufen": "bad", "kündigungsfrist": "hoch", "bald": "warn", "ok": "ok" };
async function subscriptionForm(sub = null, customerId = null) {
  if (!state.customers.length) await loadCustomers();
  const kinds = { lizenz: "Lizenz", abo: "Abo/Cloud", domain: "Domain", zertifikat: "Zertifikat", wartung: "Wartung/Support", garantie: "Garantie", sonstiges: "Sonstiges" };
  const f = form([
    { name: "customer_id", label: "Kunde", type: "select", options: customerOptions(), value: sub ? sub.customer_id : customerId ?? "" },
    { name: "name", label: "Bezeichnung", required: true, placeholder: "z. B. Microsoft 365 Business Premium" },
    { name: "vendor", label: "Hersteller/Lieferant" }, { name: "kind", label: "Art", type: "select", options: Object.entries(kinds) },
    { name: "quantity", label: "Anzahl", type: "number", step: "1", value: 1 },
    { name: "billing_cycle", label: "Abrechnung", type: "select", options: [["monat", "monatlich"], ["jahr", "jährlich"]] },
    { name: "unit_cost", label: "Einkauf je Einheit (€)", type: "number", step: "0.01" }, { name: "unit_price", label: "Verkauf je Einheit (€)", type: "number", step: "0.01" },
    { name: "renewal_date", label: "Verlängerung/Ablauf am", type: "date" }, { name: "notice_days", label: "Kündigungsfrist (Tage)", type: "number", value: 30 },
    { name: "auto_renew", label: "Verlängert sich automatisch", type: "checkbox", value: true },
    { name: "billable", label: "Über uns verrechnet (läuft im Rechnungslauf mit)", type: "checkbox", value: true },
    { name: "per_user", label: "Je Benutzer lizenziert (Abgleich mit Mitarbeiterzahl)", type: "checkbox" },
    { name: "notes", label: "Notizen (Lizenzschlüssel NICHT hier speichern)", type: "textarea", full: true },
  ], sub ? { ...sub, auto_renew: !!sub.auto_renew, billable: !!sub.billable, per_user: !!sub.per_user } : {});
  modal(sub ? "Lizenz/Vertrag bearbeiten" : "Neue Lizenz / neuer Vertrag", f, [
    sub ? (close) => h("button", { class: "btn danger", onclick: async () => { if (!confirm("Eintrag löschen?")) return; await api(`/api/subscriptions/${sub.id}`, { method: "DELETE" }); close(); render(); } }, "Löschen") : null,
    (close) => h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
      const d = readForm(f); d.customer_id = Number(d.customer_id);
      await api(sub ? `/api/subscriptions/${sub.id}` : "/api/subscriptions", { method: sub ? "PUT" : "POST", body: d }); close(); toast("Gespeichert"); render();
    }) }, "Speichern"),
  ].filter(Boolean));
}
function subscriptionTable(rows, showCustomer = true) {
  return table([
    ...(showCustomer ? [{ label: "Kunde", key: "customer_name" }] : []),
    { label: "Lizenz/Vertrag", render: (r) => h("div", {}, h("strong", {}, r.name), h("div", { class: "small muted" }, [r.vendor, r.kind].filter(Boolean).join(" · "))) },
    { label: "Anzahl", num: true, render: (r) => h("div", {}, String(r.quantity).replace(".", ","), r.seats && r.seats.diff !== 0 ? h("div", { class: "small", style: `color:${r.seats.diff < 0 ? "var(--bad)" : "var(--warn)"}` }, r.seats.diff < 0 ? `${-r.seats.diff} fehlen` : `${r.seats.diff} zu viel?`) : null) },
    { label: "Verkauf/Monat", num: true, render: (r) => eur2(r.price_month) }, { label: "Marge/Monat", num: true, render: (r) => r.margin_pct === null ? "–" : `${eur2(r.margin_month)} (${Math.round(r.margin_pct)} %)` },
    { label: "Verlängerung", render: (r) => r.next_renewal ? h("div", {}, badge(dt(r.next_renewal), SUB_STATE[r.state]), r.state === "kündigungsfrist" ? h("div", { class: "small", style: "color:var(--warn)" }, `Frist bis ${dt(r.notice_deadline)}`) : null) : "–" },
    { label: "Auto", render: (r) => (r.auto_renew ? "ja" : "nein") },
  ], rows, (r) => subscriptionForm(r));
}
views.lizenzen = async () => {
  await loadCustomers();
  setTitle("Lizenzen & Verträge", [h("button", { class: "btn primary", onclick: () => subscriptionForm() }, "+ Lizenz/Vertrag")]);
  const [rows, sum] = await Promise.all([api("/api/subscriptions"), api("/api/subscriptions/summary")]);
  const kpi = (label, value, sub, cls = "") => h("div", { class: `card kpi ${cls}` }, h("div", { class: "label" }, label), h("div", { class: "value" }, value), h("div", { class: "sub" }, sub));
  show(h("div", { class: "grid kpis" },
      kpi("Lizenzumsatz", eur(sum.price_month), "pro Monat (über uns verrechnet)"), kpi("Marge", eur(sum.margin_month), "pro Monat", "accent"),
      kpi("Verlängerungen", sum.due_60, `in 60 Tagen · ${sum.notice_soon} Kündigungsfrist läuft`), kpi("Lizenzanzahl prüfen", sum.seat_issues, "über-/unterlizenziert")),
    h("div", { class: "card" }, subscriptionTable(rows)),
    h("p", { class: "small muted" }, "Monatliche Lizenzen werden jeden Monat, Jahreslizenzen im Monat der Verlängerung automatisch im Rechnungslauf verrechnet. Kündigungsfristen und fehlende Lizenzen erscheinen im Umsatz-Radar."));
};

// ---- Ticket-Zuweisung
async function routingCard() {
  const cfg = await api("/api/team/routing");
  const cats = ["Netzwerk", "E-Mail/M365", "Hardware", "Software", "Sicherheit", "Server/Backup", "Benutzer/Zugang", "Beratung/Anfrage"];
  const enabled = h("input", { type: "checkbox", checked: cfg.enabled, style: "width:auto" });
  const boxes = {};
  const poolBoxes = Object.entries((state.auth && state.auth.roles) || {}).map(([k, l]) => {
    const el = h("input", { type: "checkbox", checked: cfg.pool_roles.includes(k), style: "width:auto" }); el.dataset.role = k;
    return h("label", { class: "row", style: "font-weight:400;margin:0" }, el, l);
  });
  const rows = cats.map((cat) => h("tr", {}, h("td", {}, cat), h("td", {}, h("div", { class: "row" }, state.users.map((u) => {
    const el = h("input", { type: "checkbox", checked: (cfg.rules[cat] || []).includes(u.id), style: "width:auto" });
    (boxes[cat] ??= []).push([u.id, el]);
    return h("label", { class: "row", style: "font-weight:400;margin:0;gap:.3rem" }, el, u.name);
  })))));
  return h("div", { class: "card", style: "margin-top:1rem" },
    h("div", { class: "card-head" }, h("h2", {}, "Automatische Ticket-Zuweisung"), h("label", { class: "row", style: "margin:0" }, enabled, "aktiv")),
    h("p", { class: "small muted" }, "Nach der KI-Einordnung bekommt das Ticket die zuständige Person mit den wenigsten offenen Tickets. Ohne Regel für die Kategorie: Pool nach Rolle. Manuell zugewiesene Tickets bleiben unverändert."),
    h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Kategorie"), h("th", {}, "Zuständig"))), h("tbody", {}, rows))),
    h("div", { class: "row", style: "margin-top:.6rem" }, h("span", { class: "small" }, "Pool ohne Regel:"), poolBoxes, h("span", { class: "spacer" }),
      h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
        const rules = {}; for (const [cat, list] of Object.entries(boxes)) rules[cat] = list.filter(([, el]) => el.checked).map(([id]) => id);
        const pool_roles = poolBoxes.map((l) => l.querySelector("input")).filter((el) => el.checked).map((el) => el.dataset.role);
        await api("/api/team/routing", { method: "PUT", body: { enabled: enabled.checked, rules, pool_roles } }); toast("Zuweisung gespeichert");
      }) }, "Speichern")));
}

// ---- Sprachnotiz
async function voiceNoteForm() {
  const st = await api("/api/voice/status").catch(() => ({ available: false }));
  const f = form([{ name: "from_name", label: "Anrufer" }, { name: "phone", label: "Telefon" }, { name: "company", label: "Firma" }, { name: "from_email", label: "E-Mail (falls bekannt)", type: "email" }]);
  let blob = null, rec = null, chunks = [], started = 0, timer = null;
  const status = h("div", { class: "small muted", style: "margin-top:.6rem" }, st.available ? "Bereit. Aufnahme läuft lokal, das Audio wird nach der Umwandlung gelöscht." : "Hinweis: Spracherkennung ist am Server noch nicht installiert (pip install -r requirements-voice.txt).");
  const player = h("audio", { controls: true, style: "width:100%;margin-top:.6rem;display:none" });
  const canRecord = !!(navigator.mediaDevices && window.MediaRecorder && window.isSecureContext);
  const recBtn = h("button", { class: "btn primary", type: "button", disabled: canRecord ? null : true, onclick: async () => {
    if (rec && rec.state === "recording") { rec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = []; rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => { stream.getTracks().forEach((t) => t.stop()); clearInterval(timer); blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        player.src = URL.createObjectURL(blob); player.style.display = "block"; recBtn.textContent = "Neu aufnehmen"; status.textContent = "Aufnahme fertig – anhören und senden."; };
      rec.start(); started = Date.now(); recBtn.textContent = "Stopp";
      timer = setInterval(() => { status.textContent = `Aufnahme läuft … ${Math.round((Date.now() - started) / 1000)} s`; }, 500);
    } catch (e) { toast(`Mikrofon nicht verfügbar: ${e.message}`, true); }
  } }, "Aufnahme starten");
  const file = h("input", { type: "file", accept: "audio/*", onchange: (e) => { blob = e.target.files[0] || null; if (blob) { player.src = URL.createObjectURL(blob); player.style.display = "block"; status.textContent = `Datei: ${blob.name}`; } } });
  modal("Sprachnotiz → Posteingang", h("div", {}, f,
    h("div", { class: "row", style: "margin-top:1rem" }, recBtn, h("span", { class: "muted small" }, "oder Sprachnachricht/Voicemail hochladen:"), h("div", { style: "max-width:260px" }, file)),
    !canRecord ? h("p", { class: "small", style: "color:var(--warn)" }, "Aufnehmen im Browser geht nur über https oder auf localhost – Datei-Upload funktioniert immer.") : null,
    player, status), [
    (close) => h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
      if (!blob) throw new Error("Bitte zuerst aufnehmen oder eine Datei wählen.");
      const q = new URLSearchParams(readForm(f));
      const res = await fetch(`/api/voice?${q}`, { method: "POST", body: blob, headers: { "Content-Type": blob.type || "audio/webm" } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Umwandlung fehlgeschlagen");
      close(); toast(`Erkannt und eingeordnet als: ${CAT_LABEL[data.category] || data.category}`); await render(); messageDetail(data.id);
    }) }, "Umwandeln & an KI-Mitarbeiter"),
  ]);
}

// ---- Corporate Design
// ---------------------------------------------------------------- Dokumente (PDF, SharePoint/OneDrive, Outlook)
const DOC_KIND = { rechnung: "Rechnung", angebot: "Angebot", beleg: "Beleg", bericht: "Bericht", qbr: "QBR", mahnung: "Mahnung", sonstiges: "Sonstiges" };
const DOC_TARGET = { local: "nur lokal", sharepoint: "SharePoint", onedrive: "OneDrive" };

function docStatus(d) {
  if (!d.remote || d.remote === "local") return h("span", { class: "badge", title: d.folder }, "lokal");
  if (d.remote_status === "ok") return d.remote_url
    ? h("a", { class: "badge ok", href: d.remote_url, target: "_blank", rel: "noopener", title: d.folder, onclick: (e) => e.stopPropagation() }, `${DOC_TARGET[d.remote]} ↗`)
    : badge("hochgeladen", "ok");
  if (d.remote_status === "fehler") return h("button", { class: "badge bad", style: "cursor:pointer;border:0", title: `${d.remote_error}\n\nKlicken zum Wiederholen`, onclick: async (e) => {
    e.stopPropagation();
    try { const r = await api(`/api/documents/${d.id}/retry`, { method: "POST" }); toast(r.remote_status === "ok" ? "Hochgeladen" : r.remote_error, r.remote_status !== "ok"); render(); }
    catch (err) { toast(err.message, true); } } }, "Upload-Fehler ↻");
  return badge("ausstehend", "warn");
}

function docsTable(rows, showCustomer = true) {
  return table([
    { label: "Datum", render: (d) => dt(d.created_at) },
    { label: "Art", render: (d) => badge(DOC_KIND[d.kind] || d.kind, "info") },
    { label: "Dokument", render: (d) => h("a", { href: `/api/documents/${d.id}/download`, target: "_blank", rel: "noopener" }, d.title || d.filename) },
    showCustomer ? { label: "Kunde", render: (d) => d.customer_name ? h("a", { href: `#/kunde/${d.customer_id}` }, d.customer_name) : "–" } : null,
    { label: "Ordner", render: (d) => h("span", { class: "small muted" }, d.folder) },
    { label: "Ablage", render: (d) => docStatus(d) },
  ].filter(Boolean), rows);
}

/** Bericht/QBR/Security-Check als PDF im Corporate Design ablegen (Kundenordner). */
function archiveButton(title, getText, customerId, kind = "bericht") {
  const btn = h("button", { class: "btn small", title: "PDF im ME-IT-Design erzeugen und im Kundenordner ablegen (lokal + SharePoint/OneDrive)", onclick: (e) => withBusy(e.target, async () => {
    const d = await api("/api/documents/report", { method: "POST", body: { title, text: getText(), customer_id: customerId || null, kind } });
    toast(d.remote_status === "fehler" ? `Lokal abgelegt – Upload fehlgeschlagen: ${d.remote_error}` : `Abgelegt in ${d.folder}`, d.remote_status === "fehler");
    setTimeout(() => btn.replaceWith(h("a", { class: "btn small", href: `/api/documents/${d.id}/download`, target: "_blank", rel: "noopener" }, "PDF öffnen")), 0);
  }) }, "Als PDF ablegen");
  return btn;
}

/** Rechnung/Angebot per Outlook (Microsoft 365) bzw. SMTP versenden – PDF im Anhang, Mail im Corporate Design. */
async function sendDocModal(kind, id, label) {
  const base = kind === "invoice" ? `/api/invoices/${id}` : `/api/quotes/${id}`;
  let m;
  try { m = await api(`${base}/mail`); } catch (err) { return toast(err.message, true); }
  const fields = [
    { name: "to", label: "An", required: true }, { name: "cc", label: "Kopie (CC)", placeholder: "z. B. buchhaltung@kunde.at" },
    { name: "subject", label: "Betreff", full: true }, { name: "text", label: "Nachricht", type: "textarea", rows: 9, full: true }];
  if (kind === "invoice") fields.push({ name: "attach_xml", label: "E-Rechnung (ebInterface 6.1 XML) zusätzlich anhängen", type: "checkbox", full: true });
  const f = form(fields, m);
  modal(`${label} per Mail senden`, h("div", {},
    h("p", { class: "small muted" }, "Versand über Ihr Postfach (Microsoft 365/Outlook bzw. SMTP) – die Mail erscheint in „Gesendete Elemente“. Das PDF im ME-IT-Design hängt automatisch an und wird zusätzlich im Archiv bzw. in SharePoint/OneDrive abgelegt."),
    f, h("p", { class: "small", style: "margin-bottom:0" }, h("a", { href: `${base}/pdf`, target: "_blank", rel: "noopener" }, "PDF-Vorschau öffnen"))), [
    (close) => h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
      const r = await api(`${base}/send`, { method: "POST", body: readForm(f) });
      close(); toast(`Gesendet an ${r.to} (${r.attachments.length} Anhang/Anhänge)${r.note ? " – " + r.note : ""}`); render();
    }) }, "Senden"),
  ]);
}

let docKind = "";
views.dokumente = async () => {
  const [st, rows] = await Promise.all([api("/api/documents/settings"), api(`/api/documents?limit=500${docKind ? "&kind=" + docKind : ""}`)]);
  setTitle("Dokumente", [
    st.errors ? h("button", { class: "btn", onclick: (e) => withBusy(e.target, async () => {
      const r = await api("/api/documents/retry-failed", { method: "POST" }); toast(`${r.ok} von ${r.tried} hochgeladen`, r.ok < r.tried); render(); }) }, `${st.errors} Upload(s) wiederholen`) : null,
    h("a", { class: "btn", href: "#/einstellungen", onclick: () => setTimeout(() => document.getElementById("docs-settings")?.scrollIntoView({ behavior: "smooth" }), 400) }, "Ablage einrichten"),
  ].filter(Boolean));
  const kpi = (label, value, sub, cls = "") => h("div", { class: `card kpi ${cls}` }, h("div", { class: "label" }, label), h("div", { class: "value" }, value), h("div", { class: "sub" }, sub));
  show(
    h("div", { class: "grid kpis" },
      kpi("Ablageziel", DOC_TARGET[st.target], st.target === "local" ? "Archivordner auf dem ME-IT-PC" : (st.graph_credentials ? "über Microsoft Graph" : "Zugangsdaten fehlen!"), "accent"),
      kpi("Dokumente", st.total, "Rechnungen, Angebote, Belege, Berichte"),
      kpi("Synchronisiert", st.target === "local" ? "–" : st.synced, st.target === "local" ? "nur lokales Archiv" : DOC_TARGET[st.target]),
      kpi("Upload-Fehler", st.errors, st.errors ? "Klick auf „Upload-Fehler“ wiederholt" : "alles in Ordnung")),
    h("div", { class: "tabs" }, [["", "Alle"], ["rechnung", "Rechnungen"], ["angebot", "Angebote"], ["beleg", "Belege"], ["bericht", "Berichte"], ["qbr", "QBR"], ["mahnung", "Mahnungen"]].map(([k, l]) =>
      h("button", { class: docKind === k ? "active" : "", onclick: () => { docKind = k; render(); } }, l))),
    h("div", { class: "card" }, docsTable(rows)),
    h("div", { class: "card", style: "margin-top:1rem" }, h("h2", {}, "So läuft der Dokumentenprozess"), md([
      "1. **Outlook / Microsoft 365** – Eingangsrechnungen kommen ins Postfach. Der KI-Mitarbeiter erkennt sie, liest Lieferant, Nummer, Datum und Betrag aus und legt das PDF in `Buchhaltung/Eingangsrechnungen/<Jahr>/<Monat>` ab.",
      "2. **Abrechnung** – beim „Stellen“ entsteht die Rechnung als PDF im ME-IT-Design und landet in `Buchhaltung/Ausgangsrechnungen/<Jahr>` und im Kundenordner. „Senden“ verschickt sie über Ihr Outlook-Postfach (PDF + E-Rechnung).",
      "3. **Angebote, Monatsberichte, QBR, Security-Checks** – per Knopfdruck als PDF in `Kunden/<Kunde>/…`, Angebote direkt per Mail an den Kunden.",
      "4. **SharePoint / OneDrive** – alles wird zusätzlich in die Dokumentbibliothek hochgeladen. Über „Synchronisieren“ (OneDrive-Client) haben Sie und Ihr Steuerberater die Ordner im Explorer.",
      "",
      `Lokales Archiv: \`${st.archive_dir}\` (wird mitgesichert – Aufbewahrungspflicht 7 Jahre, § 132 BAO).`,
    ].join("\n"))));
};

async function docsSettingsCard() {
  const s = await api("/api/documents/settings");
  const folderLabels = { rechnung: "Ausgangsrechnungen", rechnung_kunde: "Rechnungs-Kopie im Kundenordner", beleg: "Eingangsrechnungen (Belege)", angebot: "Angebote", bericht: "Berichte / QBR", mahnung: "Mahnungen" };
  const values = { ...s };
  for (const k of Object.keys(folderLabels)) values[`folder_${k}`] = s.folders[k] || "";
  const f = form([
    { name: "target", label: "Ablageziel", type: "select", options: [["local", "Nur lokal (Archivordner)"], ["sharepoint", "SharePoint (Dokumentbibliothek)"], ["onedrive", "OneDrive (eines Benutzers)"]] },
    { name: "base_folder", label: "Hauptordner in SharePoint/OneDrive", placeholder: "ME-IT" },
    { name: "sharepoint_site", label: "SharePoint-Site (nur bei SharePoint)", placeholder: "https://firma.sharepoint.com/sites/ME-IT" },
    { name: "library", label: "Dokumentbibliothek (leer = „Dokumente“)" },
    { name: "onedrive_user", label: "OneDrive-Benutzer (nur bei OneDrive)", placeholder: "office@firma.at" },
    { name: "cc", label: "Rechnungen/Angebote in Kopie an", placeholder: "z. B. buchhaltung@meit.at" },
    ...Object.entries(folderLabels).map(([k, l]) => ({ name: `folder_${k}`, label: `Ordner: ${l}` })),
    { name: "auto_invoice", label: "Rechnungen beim Stellen automatisch ablegen", type: "checkbox" },
    { name: "auto_receipts", label: "Beleg-PDFs aus dem Postfach automatisch ablegen", type: "checkbox" },
    { name: "attach_xml", label: "E-Rechnung (ebInterface) an Rechnungsmails anhängen", type: "checkbox" },
    { name: "invoice_subject", label: "Betreff Rechnungsmail", full: true },
    { name: "invoice_text", label: "Text Rechnungsmail – Platzhalter: {anrede} {nummer} {betrag} {faellig} {firma} {kunde}", type: "textarea", rows: 6, full: true },
    { name: "quote_subject", label: "Betreff Angebotsmail", full: true },
    { name: "quote_text", label: "Text Angebotsmail – Platzhalter: {anrede} {titel} {firma} {kunde}", type: "textarea", rows: 6, full: true },
  ], values);
  const collect = () => {
    const data = readForm(f); const folders = {};
    for (const k of Object.keys(folderLabels)) { folders[k] = data[`folder_${k}`]; delete data[`folder_${k}`]; }
    return { ...data, folders };
  };
  return h("div", { class: "card", style: "margin-top:1rem", id: "docs-settings" },
    h("div", { class: "card-head" }, h("h2", {}, "Dokumentenablage & Versand (Microsoft 365)"),
      docsTargetBadge(s)),
    h("p", { class: "small muted" }, "PDFs im ME-IT-Design werden immer im lokalen Archiv gespeichert und – je nach Ablageziel – zusätzlich nach SharePoint oder OneDrive hochgeladen. Ordner-Platzhalter: {kunde} {jahr} {monat}. ",
      "Microsoft 365: dieselbe App-Registrierung wie für die Mail (GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET in der .env) plus Anwendungsberechtigung Sites.Selected (mit Freigabe für die Site) oder Files.ReadWrite.All. Anleitung: docs/M365-DOKUMENTENPROZESS.md"),
    f,
    h("div", { class: "row", style: "margin-top:1rem" },
      h("button", { class: "btn", onclick: (e) => withBusy(e.target, async () => {
        await api("/api/documents/settings", { method: "PUT", body: collect() });
        const r = await api("/api/documents/test", { method: "POST" });
        toast(r.url ? `Verbindung OK: ${r.url}` : `OK: ${r.name}${r.local ? " – " + r.local : ""}`);
      }) }, "Speichern & Verbindung testen"),
      h("span", { class: "spacer" }),
      h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
        await api("/api/documents/settings", { method: "PUT", body: collect() }); toast("Dokumentenablage gespeichert");
      }) }, "Speichern")));
}

function docsTargetBadge(s) {
  if (s.target === "local") return badge("nur lokal");
  return s.graph_credentials ? badge(`${DOC_TARGET[s.target]} · Graph eingerichtet`, "ok") : badge("Graph-Zugangsdaten fehlen (.env)", "warn");
}

async function brandingCard() {
  const b = await api("/api/public/branding");
  const labels = { brand: "Markenfarbe (Cyan „ME“)", brand_2: "Türkis (Power-Ring)", primary: "Buttons/Links", accent: "Akzent (Orange)", dark: "Dunkel (Seitenleiste)", anthracite: "Anthrazit („-IT“)" };
  const inputs = Object.fromEntries(Object.keys(labels).map((k) => [k, h("input", { type: "color", value: b[k], style: "width:56px;height:36px;padding:2px" })]));
  const tagline = h("input", { value: b.tagline || "" }); const website = h("input", { value: b.website || "" });
  const preview = h("img", { src: `/brand/logo?${Date.now()}`, alt: "Logo", style: "max-height:70px;background:#fff;padding:6px;border-radius:8px;border:1px solid var(--border)" });
  const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const res = await fetch("/api/branding/logo", { method: "PUT", body: f, headers: { "Content-Type": f.type } });
    if (!res.ok) { const d = await res.json().catch(() => ({})); return toast(d.detail || "Upload fehlgeschlagen", true); }
    toast("Logo aktualisiert"); preview.src = `/brand/logo?${Date.now()}`; document.getElementById("brand-logo").src = `/brand/logo?${Date.now()}`;
  } });
  return h("div", { class: "card", style: "margin-top:1rem" },
    h("div", { class: "card-head" }, h("h2", {}, "Corporate Design"), h("a", { class: "btn small", href: b.website, target: "_blank", rel: "noopener" }, "Website")),
    h("p", { class: "small muted" }, "Gilt für Cockpit, Kundenportal, Anfrageformular, Rechnungen, PDFs und E-Mails. Standard: ME-IT-Logo und Farben von www.meit.at, Schrift Roboto (lokal, ohne Google-Server)."),
    h("div", { class: "row", style: "align-items:center;gap:1rem;margin-bottom:.8rem" }, preview, h("div", {}, h("label", {}, "Logo ersetzen (PNG/JPG/WebP)"), file)),
    h("div", { class: "form-grid" }, Object.entries(labels).map(([k, l]) => h("div", {}, h("label", {}, l), h("div", { class: "row" }, inputs[k], h("code", { class: "small" }, b[k])))),
      h("div", {}, h("label", {}, "Claim"), tagline), h("div", {}, h("label", {}, "Website"), website)),
    h("div", { class: "row", style: "margin-top:.8rem" }, h("button", { class: "btn small danger", onclick: async () => {
      if (!confirm("Corporate Design auf ME-IT-Standard zurücksetzen?")) return; await api("/api/branding/reset", { method: "POST" }); location.reload(); } }, "Auf Standard zurücksetzen"),
      h("span", { class: "spacer" }), h("button", { class: "btn primary", onclick: (e) => withBusy(e.target, async () => {
        const colors = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value]));
        await api("/api/branding", { method: "PUT", body: { colors, tagline: tagline.value, website: website.value } }); toast("Corporate Design gespeichert"); await applyBranding();
      }) }, "Speichern")));
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
  catch (e) { show(h("div", { class: "card empty" }, `Fehler: ${e.message}`)); }
}

document.getElementById("menu-btn").addEventListener("click", () => document.getElementById("sidebar").classList.toggle("open"));
window.addEventListener("hashchange", render);
async function applyBranding() {
  try {
    const b = await api("/api/public/branding");
    state.branding = b;
    const root = document.documentElement.style;
    const map = { brand: "--brand", brand_2: "--brand-2", accent: "--accent", anthracite: "--anthracite", dark: "--dark" };
    for (const [k, v] of Object.entries(map)) if (b[k]) root.setProperty(v, b[k]);
    if (b.dark) root.setProperty("--sidebar", b.dark);
    if (b.primary && !matchMedia("(prefers-color-scheme: dark)").matches) root.setProperty("--primary", b.primary);
    const claim = document.getElementById("brand-claim");
    if (claim) claim.textContent = b.tagline || "";
  } catch { /* Standardfarben aus style.css */ }
}

(async () => {
  await applyBranding();
  try { state.auth = await api("/api/auth/status"); } catch { state.auth = { login_required: false, user: null, roles: {} }; }
  if (state.auth.login_required && !state.auth.user) { showLogin(); return; }
  renderUserBox();
  await loadUsers();
  render();
})();
refreshAiStatus();
setInterval(refreshAiStatus, 30000);
