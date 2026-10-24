# Security

Authorizing a tab sends a sanitized snapshot to whichever AI client is connected to the local MCP server. Opening a site in Chrome is not permission to disclose every field on it. The popup says this next to Authorize.

Grants live in `chrome.storage.session` and are checked together with `chrome.permissions.contains` on every call. Revoke drops the grant, the host permission, and the socket. A tab that navigates to another origin loses its grant.

The content script does not read cookies, `localStorage`, `sessionStorage`, or IndexedDB. The manifest does not request the cookies permission. Hidden inputs are omitted. Text field values are not read. JWTs, bearer tokens, card-shaped numbers, and high-entropy tokens in visible text are replaced with `[redacted]`. Sensitive query keys are removed from URLs before they leave the extension.

Page text is untrusted. Tool descriptions tell the model not to follow instructions found in it, and read-only tools are the real boundary. Navigation and multi-page crawl are separate popup flags, default off. They only assign a same-origin `http(s)` URL. Paths whose segments are logout, sign-out, delete, destroy, remove, checkout, or payment are refused. GET requests can still change server state; the denylist is best-effort.

The audit line records the tool name, outcome, origin, byte count, and duration. It does not record titles, paths, snapshots, or the pairing token.

The DOM does not identify React components or source files. Repeated regions are a grouping of similar elements, nothing more.
