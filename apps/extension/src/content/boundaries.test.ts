import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const banned = ["localStorage", "sessionStorage", "document.cookie", "indexedDB", "chrome.cookies"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("content script boundaries", () => {
  it("does not read storage or cookies", () => {
    const paths = files("src/content").filter((path) => !path.endsWith(".test.ts"));
    if (existsSync("dist/content.js")) paths.push("dist/content.js");
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      const text = readFileSync(path, "utf8");
      for (const word of banned) {
        expect(text, `${path} contains ${word}`).not.toContain(word);
      }
    }
  });
});
