import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import './App.css';
import { applyTheme, getTheme } from "./utils/theme";
import "./i18n";

// Apply saved theme before first paint to avoid flash
applyTheme(getTheme());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
