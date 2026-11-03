// Seite neu zeichnen, ohne alles zu ersetzen: Das neue HTML wird mit dem bestehenden DOM
// verglichen, und nur geänderte Knoten, Attribute und Texte werden angepasst. Unverändertes
// bleibt stehen (kein neues Layout dafür), Scrollpositionen innerer Bereiche und das Feld,
// in dem gerade getippt wird, bleiben erhalten.
//
// Regeln: Knoten passen zusammen, wenn Typ, Tag und id gleich sind (sonst ersetzen).
// data-morph="keep" am neuen Element: nur Attribute abgleichen, Inhalt nicht anfassen
// (z. B. Platzhalter, in die nach dem Zeichnen etwas eingehängt wird).

const sameKind = (a, b) => a.nodeType === b.nodeType && a.nodeName === b.nodeName && (a.nodeType !== 1 || a.id === b.id)

function syncAttributes(a, b) {
  const want = b.attributes
  for (let i = 0; i < want.length; i++) {
    const { name, value } = want[i]
    if (a.getAttribute(name) !== value) a.setAttribute(name, value)
  }
  const have = a.attributes
  for (let i = have.length - 1; i >= 0; i--) {
    const name = have[i].name
    if (!b.hasAttribute(name)) a.removeAttribute(name)
  }
}

function syncFormState(a, b) {
  if (a === document.activeElement) return // dort tippt jemand: Wert nicht überschreiben
  if (a.tagName === 'INPUT') {
    if (a.type === 'checkbox' || a.type === 'radio') a.checked = b.hasAttribute('checked')
    else if (a.type !== 'file') {
      const v = b.getAttribute('value') ?? ''
      if (a.value !== v) a.value = v
    }
  } else if (a.tagName === 'TEXTAREA') {
    if (a.value !== b.textContent) a.value = b.textContent
  }
}

function morphNode(a, b) {
  if (a.nodeType === 3 || a.nodeType === 8) {
    if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue
    return
  }
  syncAttributes(a, b)
  if (b.getAttribute?.('data-morph') === 'keep') return
  if (a.tagName === 'TEXTAREA') return syncFormState(a, b)
  morphChildren(a, b)
  syncFormState(a, b)
  if (a.tagName === 'SELECT' && a !== document.activeElement) {
    const sel = b.querySelector('option[selected]')
    const v = sel ? sel.getAttribute('value') ?? sel.textContent : b.querySelector('option')?.getAttribute('value') ?? ''
    if (a.value !== v) a.value = v
  }
}

function morphChildren(a, b) {
  let ac = a.firstChild
  let bc = b.firstChild
  while (bc) {
    const nextB = bc.nextSibling
    if (!ac) {
      a.appendChild(bc)
    } else if (sameKind(ac, bc)) {
      morphNode(ac, bc)
      ac = ac.nextSibling
    } else {
      const nextA = ac.nextSibling
      a.replaceChild(bc, ac)
      ac = nextA
    }
    bc = nextB
  }
  while (ac) {
    const n = ac.nextSibling
    a.removeChild(ac)
    ac = n
  }
}

const last = new WeakMap() // Element → zuletzt eingesetztes HTML

/**
 * Inhalt von el auf html bringen. replace: ganz ersetzen (z. B. andere Ansicht, dann gibt es
 * kaum Gemeinsames). Gleiches HTML wie beim letzten Mal: nichts tun.
 */
export function patch(el, html, { replace = false } = {}) {
  if (last.get(el) === html && !replace) return false
  last.set(el, html)
  if (replace || !el.firstChild) {
    el.innerHTML = html
    return true
  }
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  morphChildren(el, tpl.content)
  return true
}
