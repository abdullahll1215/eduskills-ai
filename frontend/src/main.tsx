import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, MemoryRouter } from "react-router-dom";
import { DEMO } from "./api/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { AuthProvider } from "./context/AuthContext";
import { LanguageProvider } from "./i18n";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {DEMO ? (
      <MemoryRouter>
        <AuthProvider>
          <ErrorBoundary>
            <LanguageProvider>
              <App />
            </LanguageProvider>
          </ErrorBoundary>
        </AuthProvider>
      </MemoryRouter>
    ) : (
      <BrowserRouter>
        <AuthProvider>
          <LanguageProvider>
            <App />
          </LanguageProvider>
        </AuthProvider>
      </BrowserRouter>
    )}
  </React.StrictMode>,
);
