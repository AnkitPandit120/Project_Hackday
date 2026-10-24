import { PROTOCOL_VERSION } from "./protocol.js";

export type PairingPayload = {
  v: 1;
  port: number;
  token: string;
};

export function encodePairingCode(port: number, token: string): string {
  const payload: PairingPayload = { v: PROTOCOL_VERSION, port, token };
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

export function decodePairingCode(code: string): PairingPayload | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(base64UrlToBytes(code.trim())));
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (record.v !== 1 || typeof record.port !== "number" || typeof record.token !== "string") return null;
    if (!Number.isInteger(record.port) || record.port < 1 || record.port > 65535) return null;
    if (record.token.length < 16) return null;
    return { v: 1, port: record.port, token: record.token };
  } catch {
    return null;
  }
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesToBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = i + 1 < bytes.length ? (bytes[i + 1] ?? 0) : 0;
    const c = i + 2 < bytes.length ? (bytes[i + 2] ?? 0) : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += ALPHABET[(triple >> 18) & 63];
    out += ALPHABET[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? ALPHABET[(triple >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? ALPHABET[triple & 63] : "=";
  }
  return out.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const bytes: number[] = [];
  for (let i = 0; i < padded.length; i += 4) {
    const c0 = padded[i] ?? "A";
    const c1 = padded[i + 1] ?? "A";
    const c2 = padded[i + 2] ?? "=";
    const c3 = padded[i + 3] ?? "=";
    const n0 = ALPHABET.indexOf(c0);
    const n1 = ALPHABET.indexOf(c1);
    const n2 = c2 === "=" ? -1 : ALPHABET.indexOf(c2);
    const n3 = c3 === "=" ? -1 : ALPHABET.indexOf(c3);
    if (n0 < 0 || n1 < 0 || (n2 < 0 && c2 !== "=") || (n3 < 0 && c3 !== "=")) {
      throw new Error("Invalid pairing code.");
    }
    const triple = (n0 << 18) | (n1 << 12) | ((n2 < 0 ? 0 : n2) << 6) | (n3 < 0 ? 0 : n3);
    bytes.push((triple >> 16) & 255);
    if (n2 >= 0) bytes.push((triple >> 8) & 255);
    if (n3 >= 0) bytes.push(triple & 255);
  }
  return Uint8Array.from(bytes);
}
