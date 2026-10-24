import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { LIMITS } from "@snapcrawl/shared";
import { ExtractError, extractDocument } from "./extract.js";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../tests/fixtures/pages");

function load(name: string, url: string): Document {
  const html = readFileSync(resolve(fixtures, name), "utf8");
  return new JSDOM(html, { url }).window.document;
}

describe("extractDocument", () => {
  it("captures headings, landmarks, and same-origin links from the dashboard", () => {
    const doc = load("dashboard.html", "https://app.example/admin?token=secret&tab=1");
    const snapshot = extractDocument(doc, { pageUrl: "https://app.example/admin?token=secret&tab=1" });
    expect(snapshot.title).toBe("Acme Admin");
    expect(snapshot.url).toBe("https://app.example/admin?tab=1");
    expect(snapshot.headings.map((heading) => heading.text)).toEqual(["Dashboard", "This week"]);
    expect(snapshot.landmarks.some((landmark) => landmark.role === "navigation")).toBe(true);
    expect(snapshot.linksInternal.map((link) => link.path)).toEqual([
      "/admin",
      "/admin/users",
      "/admin/settings",
      "/admin/activity",
      "/logout",
    ]);
    expect(snapshot.interactive?.links.some((link) => link.href.startsWith("https://billing.example/"))).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain("secret");
    const flat = JSON.stringify(snapshot.regions);
    expect(flat).toContain("\"repeated\":true");
  });

  it("keeps form metadata and drops secret field contents", () => {
    const doc = load("settings-form.html", "https://app.example/admin/settings");
    const snapshot = extractDocument(doc, { pageUrl: "https://app.example/admin/settings" });
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("super-secret-password");
    expect(serialized).not.toContain("csrf-secret-value");
    const form = snapshot.interactive?.forms[0];
    expect(form?.method).toBe("post");
    expect(form?.fields.map((field) => field.type)).toEqual(["email", "password"]);
    expect(form?.fields.find((field) => field.type === "email")?.placeholder).toBe("ada@acme.test");
    expect(snapshot.interactive?.buttons.map((button) => button.text)).toEqual(["Save settings", "Delete account"]);
  });

  it("redacts tokens, flags instruction text, and skips hidden nodes", () => {
    const doc = load("injection.html", "https://app.example/notes");
    const snapshot = extractDocument(doc, { pageUrl: "https://app.example/notes" });
    expect(snapshot.visibleText).not.toContain("eyJhbGci");
    expect(snapshot.visibleText).toContain("[redacted]");
    expect(snapshot.visibleText).not.toContain("hidden-marker-should-not-appear");
    expect(snapshot.warnings.some((warning) => warning.includes("instruction-like"))).toBe(true);
  });

  it("returns a structure slice without body text", () => {
    const doc = load("dashboard.html", "https://app.example/admin");
    const snapshot = extractDocument(doc, { pageUrl: "https://app.example/admin", detail: "structure" });
    expect(snapshot.visibleText).toBeUndefined();
    expect(snapshot.interactive).toBeUndefined();
    expect(snapshot.headings[0]?.text).toBe("Dashboard");
  });

  it("truncates a large page and continues from the cursor", () => {
    const items = Array.from({ length: 100 }, (_, index) => `<a href="/item/${index}">Item ${index}</a>`).join("");
    const paragraph = "word ".repeat(4_000);
    const html = `<!doctype html><html><head><title>Large</title></head><body><main><h1>Large</h1><p>${paragraph}</p>${items}</main></body></html>`;
    const doc = new JSDOM(html, { url: "https://app.example/large" }).window.document;
    const first = extractDocument(doc, { pageUrl: "https://app.example/large" });
    expect(first.truncated).toBe(true);
    expect(first.cursor).toBeTruthy();
    expect((first.visibleText ?? "").length).toBeLessThanOrEqual(LIMITS.visibleTextChars);
    expect(first.interactive?.links.length).toBeLessThanOrEqual(LIMITS.links);
    const second = extractDocument(doc, { pageUrl: "https://app.example/large", cursor: first.cursor });
    expect(second.interactive?.links[0]?.path).toBe("/item/80");
  });

  it("rejects an unknown selector and returns a dom subtree without secrets", () => {
    const doc = load("settings-form.html", "https://app.example/admin/settings");
    expect(() => extractDocument(doc, { pageUrl: "https://app.example/admin/settings", selector: "#missing" })).toThrow(
      ExtractError,
    );
    const snapshot = extractDocument(doc, {
      pageUrl: "https://app.example/admin/settings",
      detail: "dom",
      selector: "main",
      maxNodes: 20,
    });
    const serialized = JSON.stringify(snapshot.dom);
    expect(serialized).not.toContain("super-secret-password");
    expect(serialized).not.toContain("csrf-secret-value");
    expect(snapshot.matchCount).toBe(1);
    expect(snapshot.dom?.tag).toBe("main");
  });
});
