/**
 * Only relative paths inside the app are allowed as redirect targets (no open redirects).
 * Browsers drop tabs and line breaks while parsing URLs, so "/\t/evil.example" would become
 * "//evil.example" – any control character, backslash or protocol-relative start is rejected.
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/")) return "/";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return "/";
  if (value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://app.invalid");
    if (url.origin !== "https://app.invalid") return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}
