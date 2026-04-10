// app/context/i18n.jsx
// Provides t(key, vars) translation function to the entire admin UI.
// Language is persisted in localStorage under "picklo_lang".
// Supported: ro | en | de | hu | cs  (defaults to "ro")

import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { T } from "../locales/translations.js";

const STORAGE_KEY = "picklo_lang";
const SUPPORTED    = ["ro", "en", "de", "hu", "cs"];
const DEFAULT_LANG = "ro";

const I18nContext = createContext(null);

// ---------------------------------------------------------------------------
// Interpolate {placeholder} tokens in a string.
// e.g. interpolate("Page {p} of {t}", { p: 2, t: 5 }) → "Page 2 of 5"
// ---------------------------------------------------------------------------
function interpolate(str, vars) {
  if (!vars || typeof str !== "string") return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(DEFAULT_LANG);

  // Hydrate from localStorage on mount (client-only)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && SUPPORTED.includes(saved)) setLangState(saved);
    } catch (_) {}
  }, []);

  const setLang = useCallback((code) => {
    if (!SUPPORTED.includes(code)) return;
    setLangState(code);
    try { localStorage.setItem(STORAGE_KEY, code); } catch (_) {}
  }, []);

  // t("key") or t("key", { n: 5 })
  const t = useCallback((key, vars) => {
    const dict = T[lang] || T[DEFAULT_LANG];
    const str  = dict[key] ?? T[DEFAULT_LANG][key] ?? key;
    return interpolate(str, vars);
  }, [lang]);

  return (
    <I18nContext.Provider value={{ lang, setLang, t, supported: SUPPORTED }}>
      {children}
    </I18nContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useTranslation() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useTranslation must be used inside <I18nProvider>");
  return ctx;
}
