import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthApp } from "./AuthApp";
import { ErrorBoundary, OfflineBanner } from "./uiStates";
import "./styles.css";
import "./app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <OfflineBanner />
      <AuthApp />
    </ErrorBoundary>
  </StrictMode>,
);
