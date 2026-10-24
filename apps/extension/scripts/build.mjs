import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "dist");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  configFile: false,
  root,
  plugins: [react()],
  publicDir: false,
  build: {
    outDir,
    emptyOutDir: false,
    rollupOptions: {
      input: {
        popup: resolve(root, "popup.html"),
        offscreen: resolve(root, "offscreen.html"),
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});

await bundle("background", resolve(root, "src/background/index.ts"), "es");
await bundle("content", resolve(root, "src/content/index.ts"), "iife");
cpSync(resolve(root, "manifest.json"), resolve(outDir, "manifest.json"));

const content = readFileSync(resolve(outDir, "content.js"), "utf8");
const banned = ["localStorage", "sessionStorage", "document.cookie", "indexedDB", "chrome.cookies"];
for (const word of banned) {
  if (content.includes(word)) {
    throw new Error(`content.js contains forbidden API ${word}`);
  }
}

async function bundle(name, input, format) {
  await build({
    configFile: false,
    root,
    publicDir: false,
    build: {
      outDir,
      emptyOutDir: false,
      rollupOptions: {
        input,
        output: {
          format,
          name: "SnapCrawlContent",
          entryFileNames: `${name}.js`,
          inlineDynamicImports: true,
        },
      },
    },
  });
}
