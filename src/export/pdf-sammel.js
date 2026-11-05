// Sammel-PDF zum Drucken (Sammelversand per Post, Mahnlauf): mehrere fertige pdfmake-Dokumente in einem PDF,
// jedes auf einer neuen Seite. Kopf-, Fuß- und Hintergrund-Funktionen bekommen die Seite innerhalb ihres eigenen
// Belegs („Seite 1 von 2“), nicht die des ganzen Stapels; dafür die Seitenzahl jedes einzeln erstellten PDFs.

/** Seitenzahl eines (von pdfmake/pdfkit erzeugten) PDFs aus seinem Inhalt (Text in latin1 oder Bytes). */
export function pdfPageCount(data) {
  const s = typeof data === 'string' ? data : new TextDecoder('latin1').decode(data)
  return (s.match(/\/Type\s*\/Page(?![s\w])/g) || []).length
}

/**
 * Dokumente zusammenführen. defs: pdfmake-Dokumente (gleiche Seitengröße und Ränder), counts: Seiten je Dokument
 * (pdfPageCount des einzeln erstellten PDFs). Bilder und Stile werden zusammengelegt.
 */
export function combineDocuments(defs, counts, { title = 'Sammeldruck' } = {}) {
  if (!defs.length) throw new Error('Nichts zu drucken.')
  const starts = []
  let page = 1
  defs.forEach((_, i) => {
    starts.push(page)
    page += Math.max(1, Number(counts[i]) || 1)
  })
  /** Beleg und Seite darin zur Seite im Stapel. */
  const locate = (current) => {
    let i = starts.length - 1
    while (i > 0 && starts[i] > current) i--
    return { i, page: current - starts[i] + 1, pages: Math.max(1, Number(counts[i]) || 1) }
  }
  // pdfmake: header/footer(Seite, Seiten, Seitengröße), background(Seite, Seitengröße)
  const perPage = (key) =>
    defs.some((d) => d[key] != null)
      ? (current, ...rest) => {
          const at = locate(current)
          const part = defs[at.i][key]
          if (typeof part !== 'function') return part ?? null
          return key === 'background' ? part(at.page, rest[0]) : part(at.page, at.pages, rest[1])
        }
      : undefined
  const first = defs[0]
  const out = {
    ...first,
    info: { ...(first.info || {}), title },
    content: defs.map((d, i) => ({ stack: [].concat(d.content || []), ...(i ? { pageBreak: 'before' } : {}) })),
    images: Object.assign({}, ...defs.map((d) => d.images || {})),
    styles: Object.assign({}, ...defs.map((d) => d.styles || {}).reverse()),
  }
  for (const key of ['header', 'footer', 'background']) {
    const fn = perPage(key)
    if (fn) out[key] = fn
    else delete out[key]
  }
  delete out.watermark
  return out
}
