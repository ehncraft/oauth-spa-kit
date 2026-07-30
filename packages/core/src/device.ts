/**
 * Best-effort, dependency-free "Chrome on macOS"-style label from a raw
 * User-Agent string -- for "you're signed in on X" UI, not a fingerprinting
 * tool. Order matters: several browsers' UAs share substrings (Edge and
 * Opera both contain "Chrome/", real Safari and Chrome/Edge/Opera all
 * contain "Safari/"), so the more specific token has to be checked first.
 */
export function parseUserAgent(userAgent: string | null | undefined): string | undefined {
  if (!userAgent) return undefined;

  let browser = "Unknown browser";
  if (/Edg\//.test(userAgent)) browser = "Edge";
  else if (/OPR\/|Opera/.test(userAgent)) browser = "Opera";
  else if (/Firefox\//.test(userAgent) || /FxiOS\//.test(userAgent)) browser = "Firefox";
  else if (/CriOS\//.test(userAgent) || /Chrome\//.test(userAgent)) browser = "Chrome";
  else if (/Version\/.*Safari\//.test(userAgent) || /Safari\//.test(userAgent)) browser = "Safari";

  let os = "Unknown OS";
  if (/iPhone/.test(userAgent)) os = "iPhone";
  else if (/iPad/.test(userAgent)) os = "iPad";
  else if (/Android/.test(userAgent)) os = "Android";
  else if (/CrOS/.test(userAgent)) os = "ChromeOS";
  else if (/Mac OS X|Macintosh/.test(userAgent)) os = "macOS";
  else if (/Windows/.test(userAgent)) os = "Windows";
  else if (/Linux/.test(userAgent)) os = "Linux";

  return `${browser} on ${os}`;
}
