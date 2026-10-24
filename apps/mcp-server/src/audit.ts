import { appendFileSync } from "node:fs";

export function audit(tool: string, outcome: string, extra?: { origin?: string; bytes?: number; ms?: number }): void {
  const entry = {
    ts: new Date().toISOString(),
    tool,
    outcome,
    origin: extra?.origin,
    bytes: extra?.bytes,
    ms: extra?.ms,
  };
  const line = JSON.stringify(entry);
  console.error(line);
  if (process.env.AUDIT_LOG) appendFileSync(process.env.AUDIT_LOG, `${line}\n`);
}
