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

const KPI_MODULES = ['planung', 'auswertung', 'reklamationen', 'fakturierung', 'einkauf', 'material', 'zufriedenheit']
/** Kennzahlen nur für Rollen, die mindestens einen dieser Bereiche sehen. */
export const kpiAvailable = () => !app.access || app.access.all || KPI_MODULES.some((m) => app.access.sees(m))
/** Umsatzsteuer (UVA): wer die Fakturierung oder Einkauf & Kasse sieht (jede Rolle sieht dort nur ihre Zahlen). */
export const uvaAvailable = () => !app.access || app.access.all || ['fakturierung', 'einkauf'].some((m) => app.access.sees(m))

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
  actions: 'waste-add waste-remove waste-redraw waste-import waste-file obj-edit key-add key-remove obj-geocode obj-save spr-passt spr-ki spr-ki-ok spr-ki-weg obj-delete task-edit task-save task-delete',
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
  // kix-rek…: „Antwort mit KI entwerfen“ (ui/kix.js)
  actions: 'complaint-filter complaint-object complaint-open complaint-redraw complaint-pdf complaint-csv complaint-new complaint-save kix-rek kix-rek-copy kix-rek-take',
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

// anlagen.js: Anlagen & Prüffristen je Objekt (Feuerlöscher, Rauchwarnmelder, Spielplatz …)
lazy(BUERO, {
  views: [
    {
      id: 'anlagen',
      order: 76,
      label: 'Anlagen & Prüffristen',
      group: 'service',
      module: 'anlagen',
      icon: '<path d="M9 8.5h6v11a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 19.5z"/><path d="M12 8.5V5.5M9.5 5.5H15l2.5-2.5M12 5.5c-2.2 0-4.6.8-5.5 3.2"/><path d="M9 12.5h6"/>',
      noWeek: true,
      mobile: {
        icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 5.5h4v7.3a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 5.5V3.5M6.3 3.5H10l1.7-1.6M8 3.5c-1.5 0-3 .5-3.6 2.1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        label: 'Anlagen',
      },
      text: 'Feuerlöscher, Rauchmelder, Spielplatz: Prüfungen und Fristen',
    },
  ],
  modals: 'anl-edit anl-check anl-defect anl-types',
  actions: `anl-tab anl-filter anl-reset anl-goto anl-def-all anl-month anl-edit-open anl-redraw anl-check-redraw anl-file anl-pdf anl-csv anl-bill-csv
    anl-save anl-delete anl-check-open anl-photo anl-report anl-file-del anl-check-save anl-check-delete anl-defect-open anl-defect-save anl-types-open
    anl-type-add anl-types-save anl-appt`,
  hints: true,
  todo: ['anlagen'],
})

// regie.js: Regieberichte (Sonderleistungen vor Ort mit Unterschrift, PDF, Rechnungsentwurf)
lazy(BUERO, {
  views: [
    {
      id: 'regie',
      order: 77,
      label: 'Regieberichte',
      group: 'service',
      module: 'regie',
      icon: '<path d="M5.5 3.5h9l4 4v13h-13z"/><path d="M14.5 3.5v4h4"/><path d="M8.5 12h7M8.5 15h4"/><path d="M8 18.5c1.2-1.4 2.2-1.4 3 0s1.8 1.4 3 0"/>',
      noWeek: true,
      mobile: {
        icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 1.8h6l3 3v9.4h-9z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M5.6 8h4.8M5.6 10.4h2.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M5.3 12.8c.8-.9 1.5-.9 2 0s1.2.9 2 0" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
        label: 'Regie',
      },
      text: 'Sonderleistungen vor Ort: Stunden, Material, Fotos, Unterschrift, Rechnung',
    },
  ],
  modals: 'reg-edit reg-sign reg-view reg-settings',
  actions: `reg-filter reg-reset reg-goto reg-open reg-file reg-pdf reg-mail reg-csv reg-invoice-open reg-new reg-redraw reg-calc reg-worker-add reg-worker-del
    reg-mat-add reg-mat-del reg-photo reg-photo-del reg-preview reg-save reg-delete reg-sign-open reg-nosig reg-close reg-stock reg-skip reg-unskip
    reg-settings-open reg-settings-save kix-diktat kix-diktat-mic kix-diktat-run reg-invoice reg-invoice-all`,
  todo: ['regie'],
})

// qualitaet.js: Qualitätsmessung je Objekt (Stichprobe in Anlehnung an EN 13549, Kennzahl, Verlauf, Bericht)
lazy(BUERO, {
  views: [
    {
      id: 'qualitaet',
      order: 78,
      label: 'Qualitätsmessung',
      group: 'service',
      module: 'qualitaet',
      icon: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/><path d="m7.8 10.6 2 2 3.6-3.6"/>',
      noWeek: true,
      text: 'Stichprobe je Objekt nach EN 13549, Kennzahl, Verlauf, Bericht',
    },
  ],
  modals: 'qm-groups qm-settings qm-plan qm-rate qm-show',
  actions: `qm-tab qm-filter qm-reset qm-goto qm-show qm-file qm-pdf qm-csv qm-complaints qm-groups-open qm-groups-redraw qm-groups-live qm-settings-open
    qm-group-add qm-group-del qm-raumbuch qm-raumbuch-file qm-groups-save qm-groups-delete qm-set-add qm-set-del qm-settings-reset qm-settings-save
    qm-measure-open qm-plan-redraw qm-plan-draw qm-plan-seed qm-plan-room qm-plan-del qm-plan-add qm-plan-start qm-rate-open qm-room qm-room-prev
    qm-room-next qm-item qm-defect qm-note qm-photo qm-photo-del qm-finish-save qm-delete qm-mail qm-appt`,
  hints: true,
  todo: ['qualitaet'],
})

// arbeitsschutz.js: Arbeitsstoffverzeichnis, Betriebsanweisungen, Evaluierung mit Maßnahmen und Fristen
lazy(BUERO, {
  views: [
    {
      id: 'arbeitsschutz',
      order: 206,
      label: 'Arbeitsschutz',
      group: 'stamm',
      module: 'arbeitsschutz',
      icon: '<path d="M12 2.8 4.5 5.8v5.6c0 4.6 3.1 8.5 7.5 9.8 4.4-1.3 7.5-5.2 7.5-9.8V5.8z"/><path d="m8.7 12.1 2.3 2.3 4.4-4.6"/>',
      noWeek: true,
      text: 'Arbeitsstoffe, Betriebsanweisungen, Evaluierung mit Maßnahmen',
    },
  ],
  modals: 'asch-stoff asch-ba asch-eval asch-settings',
  actions: `asch-tab asch-search asch-only asch-all-m asch-goto asch-stoff-open asch-stoff-redraw asch-sdb-open asch-ba-open asch-ba-redraw asch-ba-pdf
    asch-eval-open asch-eval-redraw asch-verz-pdf asch-verz-csv asch-sgd-pdf asch-stoff-save asch-sdb-file asch-sdb-del asch-ba-save asch-ba-delete
    asch-ba-fill asch-ba-type asch-eval-save asch-eval-delete asch-tpl-add asch-reviewed asch-haz-add asch-haz-del asch-m-add asch-m-del asch-m-set
    asch-settings-open asch-settings-save`,
  // arbeitsstoffe: Sicherheitsdatenblätter für das Lager (eigene Quelle, Recht „Arbeitsstoffe“)
  todo: ['arbeitsschutz', 'arbeitsstoffe'],
})

// zufriedenheit.js: Kundenzufriedenheit (Umfrage im Kundenbereich je Quartal, Auswertung, NPS, Hinweise)
lazy(BUERO, {
  views: [
    {
      id: 'zufriedenheit',
      order: 75,
      label: 'Kundenzufriedenheit',
      group: 'service',
      module: 'zufriedenheit',
      icon: '<circle cx="12" cy="12" r="8.5"/><path d="M8.3 14.2c.9 1.3 2.2 2 3.7 2s2.8-.7 3.7-2"/><path d="M9.2 9.6v.6M14.8 9.6v.6"/>',
      noWeek: true,
      text: 'Umfrage im Kundenbereich: Zufriedenheit, NPS, Verlauf je Quartal',
    },
  ],
  modals: 'kz-answer kz-settings kz-links kz-round kz-invite',
  actions: `kz-tab kz-filter kz-reset kz-goto kz-answer kz-complaints kz-csv kz-pdf kz-sync kz-appt kz-done kz-undone kz-settings-open kz-q-add
    kz-q-del kz-settings-reset kz-settings-save kz-links-open kz-links-save kz-round-open kz-round-redraw kz-round-count kz-round-save kz-round-close
    kz-round-reopen kz-invite-open kz-invite-pick kz-invite-one kz-invite-send`,
  hints: true,
  todo: ['zufriedenheit'],
})

// bewerber.js: Bewerbungen (Status bis Zusage oder Absage, Unterlagen, Gespräch, Absage-Mail, als Mitarbeiter:in anlegen)
lazy(BUERO, {
  views: [
    {
      id: 'bewerber',
      order: 81,
      label: 'Bewerbungen',
      group: 'stamm',
      module: 'bewerber',
      icon: '<circle cx="9.5" cy="8" r="3.5"/><path d="M3 20a6.5 6.5 0 0 1 13 0"/><path d="M18.5 8v6M15.5 11h6"/>',
      noWeek: true,
      mail: false,
      text: 'Bewerber:innen, Gespräche, Zusage, Absage',
    },
  ],
  modals: 'bew-edit bew-settings',
  actions: `bew-filter bew-reset bew-tile bew-edit-open bew-open bew-doc-open bew-save bew-doc bew-doc-drop bew-doc-del bew-status bew-contact bew-reject
    bew-delete bew-hire bew-settings-open bew-settings-reset bew-settings-save bew-interview`,
  todo: ['bewerber'],
})

// eintritt.js: Eintritts- und Austritts-Checklisten (Fristen, Unterweisung, Schlüssel, Plan am Handy, Einsätze)
lazy(BUERO, {
  views: [
    {
      id: 'eintritt',
      order: 82,
      label: 'Eintritt & Austritt',
      group: 'stamm',
      module: 'eintritt',
      icon: '<path d="M4 4.5h10.5v15H4z"/><path d="M7 9h4.5M7 12.5h4.5M7 16h2.5"/><path d="m14.5 15.5 2 2 4-4.5"/>',
      noWeek: true,
      text: 'Checklisten: Anmeldung, Unterweisung, Schlüssel, Abmeldung',
    },
  ],
  modals: 'bew-list bew-start bew-tpl',
  actions: `bew-kind bew-closed bew-list-open bew-goto bew-start-redraw bew-copy bew-week bew-overtime bew-start-open bew-start-save bew-task-done
    bew-task-undo bew-task-note bew-task-add bew-list-date bew-list-close bew-list-reopen bew-list-delete bew-payroll-mail bew-size bew-ein-set bew-lang
    bew-handy-code bew-handy-off bew-tpl-open bew-tpl-add bew-tpl-del bew-tpl-reset bew-tpl-save bew-handy-send bew-ein-appt`,
  todo: ['eintritt'],
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
    fak-pay-del fak-remind-open kix-mahn kix-mahn-take kix-mahn-drop fak-remind fak-mail-open fak-mail-send fak-run fak-idx-add fak-idx-del fak-rec-open fak-rec-line-add fak-rec-save
    fak-rec-del fak-cust-open fak-cust-save fak-cust-del fak-cust-from-objects fak-art-open fak-art-save fak-art-del fak-art-starter
    fak-settings-save fak-proof-open fak-proof-month fak-proof-create fak-text-kind fak-text-open fak-terms-open fak-text-check fak-terms-preview
    fak-tb-insert fak-ph-insert fak-text-save fak-text-del fak-terms-save fak-terms-del fak-terms-starter fak-text-starter fak-cust-group fak-art-search
    fak-art-group fak-art-all fak-cust-tab fak-cust-preview fak-einv-open fak-einv-format fak-einv-check fak-einv-download fak-terms-pick fak-tb-line
    fak-pay-skonto fak-cust-contact-add fak-cust-contact-del fak-import-open fim-files fim-reset fim-step fim-to-map fim-kind fim-col fim-open
    fim-check fim-take fim-apply fim-tool
    fak-conv-create fak-collect-open fak-collect-customer fak-collect-one fak-collect-create fak-line-type fak-line-move
    fwv-filter fwv-goto fwv-take fwv-invoice`,
  hints: true,
  // kundenbereich-angebote: Platz für customer-portal.js (immer geladen: holt die Online-Annahmen ab)
  todo: ['fakturierung', 'kundenbereich-angebote'],
})

// invoicing-online.js (mit invoicing.js geladen): Angebot online annehmen über den Kundenbereich
lazy(BUERO, {
  module: 'fakturierung',
  modals: 'ang-share',
  actions: 'ang-open ang-publish ang-copy ang-page ang-mail ang-revoke ang-done',
})

// invoicing-laeufe.js und invoicing-sepa.js (mit invoicing.js geladen): Festschreiben und senden, Mahnlauf,
// Angebote nachfassen, SEPA-Lastschrift
lazy(BUERO, {
  module: 'fakturierung',
  modals: 'fak-batch fak-dunning fak-block fak-followup fak-followup-mail fak-sepa fak-return',
  actions: `fak-goto-offers fak-batch-open fak-batch-step fak-batch-filter fak-batch-pick fak-batch-spick fak-batch-all fak-batch-scope
    fak-batch-opts fak-batch-cancel fak-batch-final fak-batch-send fak-batch-print fak-dunning-open fak-erinnern-open fak-dunning-pick fak-dunning-all
    fak-dunning-opts fak-dunning-run fak-block-open fak-block-scope fak-block-back fak-block-save fak-block-clear fak-followup-open
    fak-followup-save fak-followup-mail-open fak-followup-send fak-mandate-pdf fak-mandate-check fak-mandate-ref fak-sepa-open
    fak-sepa-date fak-sepa-pick fak-sepa-all fak-sepa-block fak-sepa-notice fak-sepa-noted fak-sepa-file fak-return-open fak-return-save`,
  todo: ['fakturierung-angebote'],
})

// invoicing-abrechnung.js (mit invoicing.js geladen): Winterdienst abrechnen, Leistungsnachweis nach Ist-Zeiten, Beilagen
lazy(BUERO, {
  module: 'fakturierung',
  modals: 'fab-winter',
  actions: 'fab-beilage fab-winter-open fab-winter-month fab-winter-pick fab-winter-price fab-winter-mode fab-winter-create fab-proof-basis fab-proof-opts',
})

// invoicing-briefe.js und invoicing-briefpapier.js: Briefe, Serienbriefe und Briefpapier der Fakturierung (kommen mit invoicing.js)
lazy(BUERO, {
  module: 'fakturierung',
  modals: 'fak-letterhead fak-letter fak-serial',
  actions: `fak-lh-open fak-lh-pdfhelp fak-lh-preview fak-lh-color fak-lh-pdf fak-lh-file fak-lh-remove fak-lh-mode fak-lh-suggest fak-lh-reset fak-lh-save
    fak-letter-search fak-letter-open fak-serial-open fak-letter-pdf fak-serial-step fak-serial-filter fak-serial-list fak-serial-prev fak-serial-pdf
    fak-letter-customer fak-letter-contact fak-letter-save fak-letter-del fak-letter-copy fak-letter-print fak-letter-send fak-cust-flag fak-serial-pick
    fak-serial-all fak-serial-kind fak-serial-send fak-serial-stop fak-serial-print`,
})

// purchase.js: Einkauf (Eingangsrechnungen, Lieferanten, offene Zahlungen, Bank-Ausgänge, Überweisungsdatei)
lazy(BUERO, {
  views: [
    {
      id: 'einkauf',
      order: 65,
      label: 'Einkauf',
      group: 'auswertung',
      section: 'finanzen',
      module: 'einkauf',
      icon: '<path d="M3.5 4.5h2l2.2 10.5h10.6l2-7.5H7"/><circle cx="9.5" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>',
      noWeek: true,
      text: 'Eingangsrechnungen, Lieferanten, offene Zahlungen',
    },
  ],
  modals: 'ek-inv ek-pay ek-sup ek-sepa ek-bank-assign ek-export',
  actions: `ek-tab ek-year ek-state ek-search ek-sup-search ek-inv-open ek-sup-open ek-export-open ek-inv-beleg ek-bank-q ek-sepa-date ek-export
    ek-inv-new ek-inv-edit ek-inv-redraw ek-inv-due ek-inv-net ek-inv-gross ek-inv-cat ek-inv-supplier ek-inv-file ek-inv-einv kix-beleg-file kix-beleg ek-inv-save
    ek-inv-approve ek-inv-unapprove ek-inv-cancel ek-pay-open ek-pay-skonto ek-pay-save ek-pay-del ek-sel ek-sel-all ek-sepa-open ek-sepa-create
    ek-sepa-book ek-bank-apply ek-bank-assign-open ek-bank-assign-save ek-bank-ignore ek-bank-undo ek-sup-save ek-sup-delete ek-sup-from-material
    ek-sup-link ek-cat-add ek-cat-del ek-settings-save ek-goto`,
  todo: ['einkauf'],
})

// ui/kix.js (mit Einkauf, Regieberichten, Reklamationen und Fakturierung geladen): KI beim Erfassen, Hinweis vor dem
// ersten Senden
lazy(BUERO, {
  module: 'einkauf',
  actions: 'kix-ok kix-cancel',
})

// cashbook.js: Kassenbuch (Bareinnahmen und -ausgaben, Storno, Kassensturz, Monatsabschluss, Export)
lazy(BUERO, {
  views: [
    {
      id: 'kassenbuch',
      order: 66,
      label: 'Kassenbuch',
      group: 'auswertung',
      section: 'finanzen',
      module: 'einkauf',
      icon: '<rect x="3" y="6.5" width="18" height="12" rx="2"/><circle cx="12" cy="12.5" r="2.6"/><path d="M6.5 9.5v6M17.5 9.5v6"/>',
      noWeek: true,
      text: 'Bareinnahmen und -ausgaben, Kassenstand, Kassensturz',
    },
  ],
  modals: 'kasse-entry kasse-storno kasse-count kasse-opening kasse-close kasse-export kasse-settings',
  actions: `kasse-month kasse-beleg kasse-pdf kasse-export-open kasse-export kasse-denom kasse-new kasse-redraw kasse-vat kasse-cat kasse-ref kasse-file kasse-save kasse-beleg-file
    kasse-storno-open kasse-storno kasse-count-open kasse-count-date kasse-count kasse-opening-open kasse-opening kasse-close-open kasse-close kasse-settings-open
    kasse-settings-save kasse-goto`,
  todo: ['kassenbuch'],
})

// weiterverrechnung.js (mit Einkauf, Kassenbuch und Fakturierung geladen): Kosten an Kunden weiterverrechnen
lazy(BUERO, {
  module: 'einkauf',
  modals: 'fwv-edit',
  actions: 'fwv-open fwv-calc fwv-save fwv-skip fwv-reopen fwv-remove',
})

// uva.js: Umsatzsteuer-Übersicht für die UVA (Fakturierung und Einkauf & Kasse)
lazy(BUERO, {
  views: [
    {
      id: 'umsatzsteuer',
      order: 67,
      label: 'Umsatzsteuer',
      group: 'auswertung',
      section: 'finanzen',
      module: '*',
      available: uvaAvailable,
      icon: '<path d="M5 3.5h14v17H5z"/><path d="M8.5 8h7M8.5 11.5h7M8.5 15h3"/><path d="m14 17.5 4-4"/><circle cx="14.3" cy="13.8" r=".6"/><circle cx="17.7" cy="17.2" r=".6"/>',
      noWeek: true,
      text: 'Umsatzsteuer und Vorsteuer je Monat oder Quartal für die UVA',
    },
  ],
  actions: 'uva-mode uva-month uva-quarter uva-basis uva-pdf uva-csv',
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
