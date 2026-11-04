// Hilfe-Themen und Begriffe (topics.js, gut ein Achtel des ganzen Codes) erst nach dem Start laden.
// Cleo liest TOPICS und GLOSSARY von hier: Bis loadTopics() fertig ist, sind die Listen leer, danach
// zeigen dieselben Namen auf die Inhalte aus topics.js (ES-Module: Exporte sind „live“).
// Die Anleitung (views/guide.js) wird selbst später geladen und importiert topics.js direkt.

export let TOPICS = []
export let GLOSSARY = []

let loading = null
/** Themen laden (einmal); liefert ein Promise, das nach dem Laden erfüllt ist. */
export function loadTopics() {
  loading ||= import('./topics.js').then(
    (m) => {
      TOPICS = m.TOPICS
      GLOSSARY = m.GLOSSARY
    },
    (err) => {
      loading = null
      throw err
    },
  )
  return loading
}
