import { useEffect, useState } from "react";
import { originOf, originPattern } from "@snapcrawl/shared";
import { sendRuntimeMessage, type ExtensionStatus, type GrantFlags } from "../messages";

type ListedTab = {
  id: number;
  title: string;
  origin: string;
  active: boolean;
};

const INITIAL_FLAGS: GrantFlags = {
  allowNavigation: false,
  allowCrawl: false,
  allowDom: false,
};

export function App() {
  const [status, setStatus] = useState<ExtensionStatus | null>(null);
  const [tabs, setTabs] = useState<ListedTab[]>([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [flags, setFlags] = useState<GrantFlags>(INITIAL_FLAGS);

  async function refresh() {
    const next = await sendRuntimeMessage<ExtensionStatus>({ target: "background", type: "get-status" });
    setStatus(next);
    const current = next.grants[0];
    if (current) {
      setFlags({
        allowNavigation: current.allowNavigation,
        allowCrawl: current.allowCrawl,
        allowDom: current.allowDom,
      });
    }
    const open = await chrome.tabs.query({});
    const listed: ListedTab[] = [];
    for (const tab of open) {
      if (tab.id === undefined || !tab.url) continue;
      const origin = originOf(tab.url);
      if (!origin) continue;
      listed.push({ id: tab.id, title: tab.title || origin, origin, active: Boolean(tab.active) });
    }
    setTabs(listed);
  }

  useEffect(() => {
    void refresh().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Could not read extension status.");
    });
  }, []);

  useEffect(() => {
    if (!status?.paired || status.connected) return;
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [status?.paired, status?.connected]);

  async function connect() {
    setError("");
    const response = await sendRuntimeMessage<{ ok: boolean; error?: string }>({
      target: "background",
      type: "pair",
      code,
    });
    if (!response.ok) setError(response.error ?? "Pairing failed.");
    await refresh();
  }

  async function authorize(tab: ListedTab) {
    setError("");
    const granted = await chrome.permissions.request({ origins: [originPattern(tab.origin)] });
    if (!granted) {
      setError("Chrome did not grant access to that origin.");
      return;
    }
    await sendRuntimeMessage({
      target: "background",
      type: "grant",
      tabId: tab.id,
      origin: tab.origin,
      ...flags,
    });
    await refresh();
  }

  async function changeFlag(key: keyof GrantFlags, value: boolean) {
    const next = { ...flags, [key]: value };
    setFlags(next);
    if (!status?.grants.length) return;
    await sendRuntimeMessage({ target: "background", type: "update-flags", ...next });
  }

  async function revoke() {
    await sendRuntimeMessage({ target: "background", type: "revoke" });
    setCode("");
    await refresh();
  }

  async function stopCrawl() {
    await sendRuntimeMessage({ target: "background", type: "stop-crawl" });
  }

  const connection = !status?.paired ? "Not paired" : status.connected ? "Connected" : status.detail || "Paired, waiting for the server";

  return (
    <main>
      <h1>SnapCrawl</h1>
      <p className="status">{connection}</p>
      {!status?.paired ? (
        <label>
          Pairing code
          <textarea value={code} onChange={(event) => setCode(event.target.value)} spellCheck={false} />
        </label>
      ) : null}
      <div className="row">
        {!status?.paired ? <button onClick={() => void connect()}>Connect</button> : null}
        {status?.paired ? (
          <button className="secondary" onClick={() => void revoke()}>
            Revoke
          </button>
        ) : null}
        {flags.allowCrawl ? (
          <button className="secondary" onClick={() => void stopCrawl()}>
            Stop crawl
          </button>
        ) : null}
      </div>
      <div className="checks">
        <label className="check">
          <input
            type="checkbox"
            checked={flags.allowNavigation}
            onChange={(event) => void changeFlag("allowNavigation", event.target.checked)}
          />
          Allow same-origin link navigation
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={flags.allowCrawl}
            onChange={(event) => void changeFlag("allowCrawl", event.target.checked)}
          />
          Allow multi-page crawl
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={flags.allowDom}
            onChange={(event) => void changeFlag("allowDom", event.target.checked)}
          />
          Include sanitized DOM
        </label>
      </div>
      <p className="hint">
        Authorizing a tab sends a sanitized snapshot to your AI assistant. It does not let the assistant change the
        page. Opening a site in Chrome is not permission to disclose every field on it.
      </p>
      <ul className="tabs">
        {tabs.map((tab) => {
          const granted = status?.grants.some((grant) => grant.tabId === tab.id) ?? false;
          return (
            <li key={tab.id}>
              <span>
                {tab.title}
                <br />
                {tab.origin}
              </span>
              {granted ? (
                <button className="secondary" onClick={() => void sendRuntimeMessage({ target: "background", type: "revoke-tab", tabId: tab.id }).then(() => refresh())}>
                  Revoke tab
                </button>
              ) : (
                <button onClick={() => void authorize(tab)}>Authorize</button>
              )}
            </li>
          );
        })}
      </ul>
      {error ? <p className="error">{error}</p> : null}
    </main>
  );
}
