import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import './App.css';
import { applyTheme, getTheme } from "./utils/theme";
import { applyAccent, getAccent } from "./utils/accent";
import "./i18n";

// Apply saved theme + accent before first paint to avoid flash
applyTheme(getTheme());
applyAccent(getAccent());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
