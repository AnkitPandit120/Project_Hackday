import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./popup.css";

const root = document.getElementById("root");
if (!root) throw new Error("SnapCrawl popup root is missing.");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
