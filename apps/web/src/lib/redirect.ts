/** Only relative paths inside the app are allowed as redirect targets (no open redirects). */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/")) return "/";
  // "//evil.example" and "/\evil.example" are protocol-relative URLs in browsers.
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}
