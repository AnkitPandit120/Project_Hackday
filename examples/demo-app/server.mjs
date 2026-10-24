import { createServer } from "vite";
import express from "express";
import session from "express-session";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 8787);
const app = express();

app.use(express.json());
app.use(
  session({
    secret: "snapcrawl-demo",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax" },
  }),
);

const demoUser = { username: "demo", password: "demo" };
let logoutHits = 0;
let deleteHits = 0;

app.post("/api/login", (request, response) => {
  const body = request.body ?? {};
  if (body.username !== demoUser.username || body.password !== demoUser.password) {
    response.status(401).json({ ok: false });
    return;
  }
  request.session.user = { username: demoUser.username };
  response.json({ ok: true });
});

app.post("/api/logout", (request, response) => {
  request.session.destroy(() => response.json({ ok: true }));
});

app.get("/logout", (request, response) => {
  logoutHits += 1;
  request.session.destroy(() => response.redirect("/login"));
});

app.get("/api/me", (request, response) => {
  if (!request.session.user) {
    response.status(401).json({ ok: false });
    return;
  }
  response.json({ ok: true, user: request.session.user });
});

app.post("/api/admin/delete-account", (request, response) => {
  if (!request.session.user) {
    response.status(401).json({ ok: false });
    return;
  }
  deleteHits += 1;
  response.json({ ok: true });
});

app.get("/api/test/counters", (_request, response) => {
  response.json({ logoutHits, deleteHits });
});

const vite = await createServer({
  root,
  configFile: resolve(root, "vite.config.ts"),
  server: { middlewareMode: true },
  appType: "spa",
});
app.use(vite.middlewares);

const server = app.listen(port, "127.0.0.1", () => {
  console.error(`Demo app at http://127.0.0.1:${port}`);
});

async function shutdown() {
  await vite.close();
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
}

process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});
process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});
