import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { App } from "./App.js";
import "./styles.css";

const root = document.getElementById("vestry-root");
if (root) {
  const basePath = root.dataset.base ?? "/admin";
  const name = root.dataset.name ?? "Vestry";
  createRoot(root).render(
    <StrictMode>
      <App basePath={basePath} name={name} />
    </StrictMode>,
  );
}
