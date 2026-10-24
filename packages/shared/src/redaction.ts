export const SENSITIVE_QUERY_KEYS = [
  "token",
  "access_token",
  "id_token",
  "refresh_token",
  "code",
  "password",
  "email",
  "secret",
  "api_key",
  "apikey",
] as const;

const SENSITIVE_QUERY = new Set<string>(SENSITIVE_QUERY_KEYS);

const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const BEARER = /Bearer\s+[A-Za-z0-9\-._~+/]{16,}={0,2}/gi;
const CARD = /\b(?:\d[ -]*?){13,19}\b/g;
const LONG_TOKEN = /[A-Za-z0-9+/=_-]{40,}/g;

const INSTRUCTION_PATTERNS = [
  /ignore (all |any )?(previous|prior) instructions/i,
  /disregard (all |any )?(previous|prior) (instructions|prompts)/i,
  /system prompt/i,
  /you are now /i,
  /exfiltrate/i,
];

export function looksLikeInstruction(text: string): boolean {
  return INSTRUCTION_PATTERNS.some((pattern) => pattern.test(text));
}

export function isSensitiveQueryKey(key: string): boolean {
  return SENSITIVE_QUERY.has(key.toLowerCase());
}

function shannonEntropy(value: string): number {
  const freq = new Map<string, number>();
  for (const char of value) freq.set(char, (freq.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function isHighEntropyToken(value: string): boolean {
  if (value.length < 40) return false;
  if (!/[0-9]/.test(value) || !/[A-Za-z]/.test(value)) return false;
  return shannonEntropy(value) >= 4;
}

export function redactText(input: string): { text: string; redacted: boolean } {
  let redacted = false;
  const replace = (pattern: RegExp, predicate?: (match: string) => boolean) => {
    input = input.replace(pattern, (match) => {
      if (predicate && !predicate(match)) return match;
      redacted = true;
      return "[redacted]";
    });
  };
  replace(JWT);
  replace(BEARER);
  replace(CARD);
  replace(LONG_TOKEN, isHighEntropyToken);
  return { text: input, redacted };
}
