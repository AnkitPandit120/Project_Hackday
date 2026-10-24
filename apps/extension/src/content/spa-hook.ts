export function installHistoryHook(): void {
  if (document.documentElement.dataset.snapcrawlHook === "1") return;
  document.documentElement.dataset.snapcrawlHook = "1";
  const fire = () => {
    window.dispatchEvent(new CustomEvent("snapcrawl:navigation", { detail: window.location.href }));
  };
  const push = history.pushState;
  history.pushState = function (this: History, ...args: Parameters<History["pushState"]>) {
    const result = push.apply(this, args);
    fire();
    return result;
  };
  const replace = history.replaceState;
  history.replaceState = function (this: History, ...args: Parameters<History["replaceState"]>) {
    const result = replace.apply(this, args);
    fire();
    return result;
  };
  window.addEventListener("popstate", fire);
  window.addEventListener("hashchange", fire);
}
