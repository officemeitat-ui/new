// Dateinamen ohne Sonderzeichen: Browser verwerfen sonst teils den Namen
// (Download heißt dann „download“). Umlaute als ae/oe/ue, Akzente ohne Zeichen.

const MAP = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss', đ: 'd', Đ: 'D', ł: 'l', Ł: 'L', ø: 'o', Ø: 'O', æ: 'ae', Æ: 'Ae' }

export function fileSafe(text) {
  return String(text)
    .replace(/[äöüÄÖÜßđĐłŁøØæÆ]/g, (ch) => MAP[ch])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^\w.-]/g, '')
    .replace(/_{2,}/g, '_') // „Wetter & Winterdienst“ → Wetter_Winterdienst, nicht Wetter__Winterdienst
}
