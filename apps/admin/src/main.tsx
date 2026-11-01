import { ApiStatus } from "@truman3/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing #root element");
}

createRoot(root).render(
  <StrictMode>
    <h1>Truman 3 Admin</h1>
    <ApiStatus />
  </StrictMode>,
);
