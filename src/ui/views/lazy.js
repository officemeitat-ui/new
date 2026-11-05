// Später geladene Ansichten: Im Build eigene Dateien, geladen beim ersten Öffnen der Ansicht, eines
// Dialogs oder einer Aktion, spätestens kurz nach dem Start im Hintergrund (nur Bereiche der eigenen
// Rolle). Hier stehen nur die Kopfdaten, damit Seitenleiste, Suche, Cleo, Rollen und ACTIONS[name]
// alles schon vorher kennen (registerLazy in context.js). Das Modul selbst bleibt unverändert und
// registriert sich beim Laden wie gewohnt.
//
// Angaben je Modul: views (wie bei registerView, ohne render), modals, actions (alle Namen),
// hints (registerObjectHint), todo (Kennungen von registerTodo: Platzhalter halten die Reihenfolge
// in „Zu erledigen“). Reihenfolge hier = frühere Reihenfolge in views/index.js.
// test/lazy.test.js vergleicht alles mit dem echten Modul: Neue Aktion, neuer Dialog oder geänderte
// Beschriftung im Modul → hier nachtragen. Anleitung: docs/ERWEITERN.md, „Später laden“.

import { app, registerLazy } from '../context.js'
import { registerTodo, SOURCES } from '../modals/todo.js'
import { weatherEnabled, winterOpen } from '../weather.js'

const KPI_MODULES = ['planung', 'auswertung', 'reklamationen', 'fakturierung', 'material']
/** Kennzahlen nur für Rollen, die mindestens einen dieser Bereiche sehen. */
export const kpiAvailable = () => !app.access || app.access.all || KPI_MODULES.some((m) => app.access.sees(m))

// Zwei Pakete: „alle“ sieht jede Rolle (auch Vorarbeiter am Handy), „büro“ die übrigen Bereiche.
const ALLE = () => import('./lazy-alle.js')
const BUERO = () => import('./lazy-buero.js')

/** registerLazy plus Platzhalter in „Zu erledigen“. */
function lazy(load, { todo = [], ...spec }) {
  const entry = registerLazy(load, spec)
  for (const id of todo) {
    // Quelle eines immer geladenen Moduls, schon registriert (customer-portal.js): nur an diese Stelle rücken
    const idx = SOURCES.findIndex((s) => s.id === id)
    if (idx >= 0) SOURCES.push(...SOURCES.splice(idx, 1))
    else registerTodo({ id, module: entry.module, lazy: entry, title: '', compute: () => [], render: () => '' })
  }
}

// kpi.js
lazy(ALLE, {
  views: [
    {
      id: 'kennzahlen',
      order: 2,
      label: 'Kennzahlen',
      group: 'auswertung',
      module: '*',
      section: 'start',
      noWeek: true,
      // nur, wer mindestens eine Kennzahl sehen kann (nicht z. B. Vorarbeiter oder Prüfer)
      available: kpiAvailable,
      icon: '<path d="M3.5 20.5h17"/><rect x="5" y="11" width="3" height="7" rx="1"/><rect x="10.5" y="6" width="3" height="12" rx="1"/><rect x="16" y="9" width="3" height="9" rx="1"/>',
      text: 'Dashboard: Stunden, Besetzung, Krankenstand, Umsatz, offene Posten',
    },
  ],
  actions: 'kpi-period',
})

// guide.js: Anleitung mit allen Hilfe-Themen (help/topics.js); Cleo lädt die Themen über help/lazy.js
lazy(ALLE, {
  views: [
    {
      id: 'anleitung',
      order: 3,
      label: 'Anleitung',
      group: 'start',
      section: 'start',
      module: '*',
      noWeek: true,
      icon: '<path d="M4 4.5h6.5A2.5 2.5 0 0 1 13 7v13a2 2 0 0 0-2-2H4zM20 4.5h-6.5A2.5 2.5 0 0 0 11 7v13a2 2 0 0 1 2-2h7z"/><path d="M15.5 9h2.5M15.5 12h2.5"/>',
      text: 'Hilfe: alle Funktionen erklärt, Cleo fragen',
    },
  ],
  actions: 'guide-search guide-chapter guide-jump guide-print',
})

// calculation.js
lazy(BUERO, {
  // Löhne, Zuschläge und Marge: nur Vollzugriff (nicht die Lohnverrechnung)
  views: [{ id: 'kalkulation', order: 62, label: 'Kalkulation', group: 'auswertung', module: 'auswertung', noWeek: true, available: () => !app.access || !!app.access.all, text: 'Stunden und Preis je Objekt' }],
  modals: 'calc-settings',
  actions: 'calc-object calc-settings calc-pdf calc-add calc-remove calc-save calc-settings-save calc-budget',
})

// proof.js
lazy(BUERO, {
  views: [
    {
      id: 'nachweis',
      order: 58,
      label: 'Leistungsnachweis',
      group: 'auswertung',
      module: 'planung',
      icon: '<path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z"/><path d="M14 2.5V8h5.5M8.5 14.5l2.3 2.3 4.7-4.8"/>',
      noWeek: true,
      text: 'Nachweis für Kunden je Objekt und Monat',
    },
  ],
  modals: 'proof proof-mail',
  actions: 'proof-month proof-settings proof-search proof-open proof-pdf proof-zip proof-mail-open proof-mail-send proof-mail-all',
})

// staff.js
lazy(BUERO, {
  views: [{ id: 'staff', order: 80, label: 'Mitarbeitende', group: 'stamm' }],
  modals: 'employee import',
  actions: 'import-template emp-edit emp-save emp-delete import-open import-preview import-run',
})

// sites.js
lazy(BUERO, {
  views: [{ id: 'sites', order: 90, label: 'Objekte & Leistungen', group: 'stamm' }],
  modals: 'object task',
  actions: 'waste-add waste-remove waste-redraw waste-import waste-file obj-edit key-add key-remove obj-geocode obj-save obj-delete task-edit task-save task-delete',
})

// trainings.js
lazy(BUERO, {
  views: [
    {
      id: 'unterweisungen',
      order: 205,
      label: 'Unterweisungen & Fristen',
      group: 'stamm',
      module: 'unterweisungen',
      icon: '<path d="M12 3 2.5 8 12 13l9.5-5z"/><path d="M6 10.2V15c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.8M21.5 8v5.5"/>',
      noWeek: true,
      text: 'Sicherheitsunterweisung, Führerschein, Arbeitserlaubnis',
    },
  ],
  modals: 'tr-record tr-session tr-types',
  // sig-clear: Unterschriftsfeld (signature.js, auch im Schlüsselbuch)
  actions: `sig-clear tr-team tr-only tr-search tr-record-open tr-record-redraw tr-csv tr-session-pdf tr-record-save tr-record-delete tr-session-open
    ts-redraw ts-pick ts-save tr-types-open tt-add tt-save`,
  todo: ['unterweisungen'],
})

// rules.js
lazy(BUERO, {
  views: [{ id: 'rules', order: 110, label: 'Regeln & Feiertage', group: 'stamm' }],
  actions: 'rules-save holiday-all-work rules-reset travel-estimate geo-all travel-add travel-delete freeday-add freeday-delete skills-save',
})

// system.js
lazy(BUERO, {
  views: [{ id: 'system', order: 130, label: 'Systemcheck', group: 'stamm', module: 'stammdaten', noWeek: true, available: () => !app.access || !!app.access.all, text: 'Inbetriebnahme prüfen' }],
  actions: 'system-run system-copy',
})

// vehicles.js
lazy(BUERO, {
  views: [
    {
      id: 'fahrzeuge',
      order: 95,
      label: 'Fahrzeuge & Reifen',
      group: 'fuhrpark',
      module: 'fahrzeuge',
      noWeek: true,
      mobile: {
        icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 10.5V8.3l1.4-3.6A1.5 1.5 0 0 1 5.3 3.7h5.4a1.5 1.5 0 0 1 1.4 1l1.4 3.6v2.2a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M3 8h10" stroke="currentColor" stroke-width="1.5"/><circle cx="5" cy="11.5" r="1.3" fill="currentColor"/><circle cx="11" cy="11.5" r="1.3" fill="currentColor"/></svg>',
        label: 'Reifen',
      },
    },
  ],
  modals: 'veh-edit veh-ws veh-import veh-plan veh-propose veh-done veh-km veh-mail',
  actions: `veh-filter veh-tab veh-csv veh-edit-open veh-set veh-save veh-del veh-due-add veh-due-del veh-km-open vk-save veh-ws-open veh-ws-set
    veh-ws-add veh-ws-del veh-ws-save veh-import-open veh-import-run veh-plan-open vp-update vp-next vp-save vp-cancel veh-propose-open vq-run
    vq-apply veh-done-open vd-save veh-mail-open vm-ws vm-send vm-mailto vm-ics vm-send-ws veh-import-text`,
  todo: ['reifen'],
})

// complaints.js
lazy(BUERO, {
  views: [{ id: 'reklamationen', order: 72, label: 'Reklamationen', group: 'service', module: 'reklamationen', noWeek: true, text: 'Beschwerden je Objekt' }],
  modals: 'complaint',
  actions: 'complaint-filter complaint-object complaint-open complaint-redraw complaint-pdf complaint-csv complaint-new complaint-save',
  hints: true,
  // kundenbereich: Platz für customer-portal.js (immer geladen), damit „Zu erledigen“ die Reihenfolge behält
  todo: ['reklamationen', 'kundenbereich'],
})

// material.js
lazy(BUERO, {
  views: [
    {
      id: 'material',
      order: 80,
      label: 'Material & Lager',
      group: 'lager',
      module: 'material',
      icon: '<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9M7.8 5.2l8.5 4.6"/>',
      noWeek: true,
      text: 'Bestand, Bestellungen, Verbrauch',
    },
  ],
  modals: 'mat-article mat-book mat-inventory mat-order mat-request mat-supplier mat-location mat-import',
  actions: `mat-tab mat-cat mat-search mat-only mat-order-filter mat-req-filter mat-month mat-span mat-kind mat-journal-art mat-article-open
    mat-order-open mat-request-open mat-supplier-open mat-import-text mat-stock-csv mat-usage-csv mat-order-pdf mat-inv-loc mat-inv-pdf mat-starter
    mat-import-open mat-import-run mat-article-save mat-article-delete mat-book-open mat-book-redraw mat-book-line-add mat-book-line-del mat-book-save
    mat-inventory-open mat-inv-save mat-cancel mat-order-new mat-order-from mat-order-line-add mat-order-line-del mat-order-save mat-order-delete
    mat-order-mark mat-order-send mat-order-cancel mat-order-receive mat-request-new mat-request-line-add mat-request-save mat-request-issue
    mat-request-order mat-request-reject mat-request-done mat-supplier-save mat-supplier-delete mat-location-open mat-location-save
    mat-location-delete mat-settings-save mat-goto`,
  hints: true,
  todo: ['material'],
})

// keys.js
lazy(BUERO, {
  views: [
    {
      id: 'schluessel',
      order: 74,
      label: 'Schlüsselbuch',
      group: 'service',
      module: 'schluessel',
      icon: '<circle cx="8" cy="15" r="4.5"/><path d="m11.2 11.8 9.3-9.3M17 6l3 3M14.5 8.5l2 2"/>',
      noWeek: true,
      text: 'Schlüssel, Ausgabe, Rückgabe, Quittung',
    },
  ],
  modals: 'key-edit key-move key-lost',
  actions: `keys-mode keys-obj keys-all keys-open-object key-edit-open keys-csv keys-person-pdf key-loss-pdf keys-import key-save key-delete
    key-move-open key-move-redraw key-move-save key-lost-open key-lost-save key-found key-customer`,
  hints: true,
  todo: ['schluessel'],
})

// invoicing.js: Fakturierung mit Bankabgleich (invoicing-bank.js), Textbausteinen und Zahlungsbedingungen (invoicing-texte.js)
lazy(BUERO, {
  views: [
    {
      id: 'fakturierung',
      order: 64,
      label: 'Fakturierung',
      group: 'auswertung',
      section: 'finanzen',
      module: 'fakturierung',
      icon: '<path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2z"/><path d="M9 7.5h6M9 11h6M9 14.5h3.5"/>',
      noWeek: true,
      text: 'Angebote, Rechnungen, offene Posten, Mahnungen',
    },
  ],
  modals: 'fak-bank-import fak-bank-assign fak-text fak-terms fak-edit fak-doc fak-pay fak-remind fak-mail fak-einv fak-export fak-proof fak-cust fak-art fak-rec fak-import fak-conv fak-collect',
  actions: `fak-bank-file fak-bank-map fak-bank-take fak-bank-apply fak-bank-all fak-bank-ignore fak-bank-reopen fak-bank-undo fak-bank-assign-open
    fak-bank-pick fak-bank-amt fak-bank-q fak-bank-assign-save fak-bank-goto fak-tab fak-year fak-state fak-search fak-cust-search fak-run-month
    fak-open fak-act fak-recalc fak-pdf fak-export-open fak-export fak-new fak-customer fak-object fak-date fak-line-add fak-line-del fak-article
    fak-from-calc fak-draft-save fak-draft-delete fak-finalize fak-copy fak-convert fak-offer-state fak-storno fak-correct fak-pay-open fak-pay-save
    fak-pay-del fak-remind-open fak-remind fak-mail-open fak-mail-send fak-run fak-idx-add fak-idx-del fak-rec-open fak-rec-line-add fak-rec-save
    fak-rec-del fak-cust-open fak-cust-save fak-cust-del fak-cust-from-objects fak-art-open fak-art-save fak-art-del fak-art-starter
    fak-settings-save fak-proof-open fak-proof-month fak-proof-create fak-text-kind fak-text-open fak-terms-open fak-text-check fak-terms-preview
    fak-tb-insert fak-ph-insert fak-text-save fak-text-del fak-terms-save fak-terms-del fak-terms-starter fak-text-starter fak-cust-group fak-art-search
    fak-art-group fak-art-all fak-cust-tab fak-cust-preview fak-einv-open fak-einv-format fak-einv-check fak-einv-download fak-terms-pick fak-tb-line
    fak-pay-skonto fak-cust-contact-add fak-cust-contact-del fak-import-open fim-files fim-reset fim-step fim-to-map fim-kind fim-col fim-open
    fim-check fim-take fim-apply fim-tool
    fak-conv-create fak-collect-open fak-collect-customer fak-collect-one fak-collect-create fak-line-type fak-line-move`,
  hints: true,
  todo: ['fakturierung'],
})

// invoicing-laeufe.js und invoicing-sepa.js (mit invoicing.js geladen): Festschreiben und senden, Mahnlauf,
// Angebote nachfassen, SEPA-Lastschrift
lazy(BUERO, {
  module: 'fakturierung',
  modals: 'fak-batch fak-dunning fak-block fak-followup fak-followup-mail fak-sepa fak-return',
  actions: `fak-goto-offers fak-batch-open fak-batch-step fak-batch-filter fak-batch-pick fak-batch-spick fak-batch-all fak-batch-scope
    fak-batch-opts fak-batch-cancel fak-batch-final fak-batch-send fak-batch-print fak-dunning-open fak-dunning-pick fak-dunning-all
    fak-dunning-opts fak-dunning-run fak-block-open fak-block-scope fak-block-back fak-block-save fak-block-clear fak-followup-open
    fak-followup-save fak-followup-mail-open fak-followup-send fak-mandate-pdf fak-mandate-check fak-mandate-ref fak-sepa-open
    fak-sepa-date fak-sepa-pick fak-sepa-all fak-sepa-block fak-sepa-notice fak-sepa-noted fak-sepa-file fak-return-open fak-return-save`,
  todo: ['fakturierung-angebote'],
})

// weather.js: Wetter mit Radar, Karte und Grafiken; Zähler und Sichtbarkeit kommen aus ui/weather.js (immer geladen).
// winterprotokoll: Platzhalter für winterlog.js (immer geladen), damit „Zu erledigen“ die Reihenfolge behält.
lazy(BUERO, {
  views: [
    {
      id: 'wetter',
      order: 47,
      label: 'Wetter & Winterdienst',
      group: 'plan',
      module: 'planung',
      noWeek: true,
      available: weatherEnabled,
      text: 'Vorhersage, Warnungen, Winterdienst',
      badge: () => winterOpen().length,
    },
  ],
  actions: 'wx-refresh wx-loc wx-create wx-cancel',
  todo: ['winterprotokoll', 'winterdienst'],
})
