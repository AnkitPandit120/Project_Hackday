export type Heading = {
  level: number;
  text: string;
};

export type Landmark = {
  role: string;
  label?: string;
};

export type LinkInfo = {
  text: string;
  href: string;
  path: string;
  sameOrigin: boolean;
};

export type ButtonInfo = {
  text: string;
  type?: string;
};

export type FormField = {
  name: string;
  type: string;
  label?: string;
  required?: boolean;
  autocomplete?: string;
  placeholder?: string;
  checked?: boolean;
};

export type FormInfo = {
  method?: string;
  actionOrigin?: string;
  fields: FormField[];
};

export type Region = {
  role?: string;
  heading?: string;
  repeated?: boolean;
  count?: number;
  sample?: string;
  children?: Region[];
};

export type DomNode = {
  tag: string;
  role?: string;
  name?: string;
  id?: string;
  className?: string;
  href?: string;
  type?: string;
  fieldName?: string;
  children: DomNode[];
};

export type PageSnapshot = {
  url: string;
  title: string;
  capturedAt: string;
  origin: string;
  headings: Heading[];
  landmarks: Landmark[];
  visibleText?: string;
  interactive?: {
    links: LinkInfo[];
    buttons: ButtonInfo[];
    forms: FormInfo[];
  };
  regions?: Region[];
  linksInternal: { text: string; path: string }[];
  warnings: string[];
  truncated: boolean;
  cursor?: string;
  settled?: boolean;
  dom?: DomNode;
  matchCount?: number;
};

export type TabSummary = {
  tabId: number;
  title: string;
  origin: string;
  urlWithoutQuery: string;
  active: boolean;
  granted: boolean;
  allowNavigation: boolean;
  allowCrawl: boolean;
  allowDom: boolean;
};

export type ListTabsResult = {
  tabs: TabSummary[];
};

export type NavigateResult = {
  finalUrl: string;
  status: "complete" | "timeout";
};

export type CrawlPageResult = PageSnapshot;

export type NavigationNode = {
  url: string;
  title: string;
  depth: number;
};

export type NavigationEdge = {
  from: string;
  to: string;
  label: string;
};

export type CrawlWebsiteResult = {
  crawlId: string;
  page: PageSnapshot | null;
  queueRemaining: number;
  done: boolean;
};

export type NavigationGraph = {
  nodes: NavigationNode[];
  edges: NavigationEdge[];
};

export type SnapshotCursor = {
  textOffset: number;
  linkOffset: number;
  buttonOffset: number;
};

export function encodeCursor(cursor: SnapshotCursor): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(cursor)));
}

export function decodeCursor(value: string): SnapshotCursor | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.textOffset !== "number" ||
      typeof record.linkOffset !== "number" ||
      typeof record.buttonOffset !== "number"
    ) {
      return null;
    }
    return {
      textOffset: record.textOffset,
      linkOffset: record.linkOffset,
      buttonOffset: record.buttonOffset,
    };
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
    const n0 = ALPHABET.indexOf(padded[i] ?? "A");
    const n1 = ALPHABET.indexOf(padded[i + 1] ?? "A");
    const n2 = padded[i + 2] === "=" ? -1 : ALPHABET.indexOf(padded[i + 2] ?? "A");
    const n3 = padded[i + 3] === "=" ? -1 : ALPHABET.indexOf(padded[i + 3] ?? "A");
    const triple = (n0 << 18) | (n1 << 12) | ((n2 < 0 ? 0 : n2) << 6) | (n3 < 0 ? 0 : n3);
    bytes.push((triple >> 16) & 255);
    if (n2 >= 0) bytes.push((triple >> 8) & 255);
    if (n3 >= 0) bytes.push(triple & 255);
  }
  return Uint8Array.from(bytes);
}
