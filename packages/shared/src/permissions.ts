import { isSensitiveQueryKey } from "./redaction.js";

const DENIED_SEGMENTS = new Set([
  "logout",
  "log-out",
  "signout",
  "sign-out",
  "delete",
  "destroy",
  "remove",
  "checkout",
  "payment",
]);

export type UrlDecision =
  | { ok: true; url: string }
  | { ok: false; code: "UNSAFE_NAVIGATION" | "ORIGIN_MISMATCH"; message: string };

export function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function originPattern(origin: string): string {
  return `${origin}/*`;
}

export function sanitizePageUrl(value: string): string {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) {
    if (isSensitiveQueryKey(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

export function urlWithoutQuery(value: string): string {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function canonicalUrl(value: string): string {
  const url = new URL(sanitizePageUrl(value));
  url.hash = "";
  const entries = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [key, entry] of entries) url.searchParams.append(key, entry);
  return url.toString();
}

export function pathOf(value: string): string {
  const url = new URL(value);
  return `${url.pathname}${url.search}`;
}

function hasDeniedSegment(url: URL): boolean {
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  return segments.some((segment) => DENIED_SEGMENTS.has(segment.toLowerCase()));
}

export function checkNavigationUrl(target: string, grantOrigin: string): UrlDecision {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return { ok: false, code: "UNSAFE_NAVIGATION", message: "URL is not absolute." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, code: "UNSAFE_NAVIGATION", message: "Only http and https URLs can be opened." };
  }
  if (url.origin !== grantOrigin) {
    return { ok: false, code: "ORIGIN_MISMATCH", message: "URL is outside the authorized origin." };
  }
  if (hasDeniedSegment(url)) {
    return {
      ok: false,
      code: "UNSAFE_NAVIGATION",
      message: "URL path looks like a sign-out, delete, or payment action.",
    };
  }
  return { ok: true, url: url.toString() };
}

export function validateSelector(selector: string): string | null {
  if (selector.length === 0 || selector.length > 300) return "Selector length is invalid.";
  if (/[\n\r]/.test(selector)) return "Selector cannot contain newlines.";
  return null;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
