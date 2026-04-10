// app/components/LanguageSwitcher.jsx
// Small flag-button picker for the admin UI top bar.
// Renders: 🇷🇴 🇬🇧 🇩🇪 🇭🇺 🇨🇿 — active lang gets a highlighted border.

import { useTranslation } from "../context/i18n.jsx";

const LANGS = [
  { code: "ro", flag: "🇷🇴", label: "Română" },
  { code: "en", flag: "🇬🇧", label: "English" },
  { code: "de", flag: "🇩🇪", label: "Deutsch" },
  { code: "hu", flag: "🇭🇺", label: "Magyar" },
  { code: "cs", flag: "🇨🇿", label: "Čeština" },
];

export function LanguageSwitcher() {
  const { lang, setLang } = useTranslation();

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: "#f6f6f7",
        borderRadius: 20,
        padding: "4px 8px",
        border: "1px solid #e1e3e5",
      }}
      aria-label="Language switcher"
    >
      {LANGS.map(({ code, flag, label }) => {
        const active = lang === code;
        return (
          <button
            key={code}
            title={label}
            onClick={() => setLang(code)}
            style={{
              background: active ? "#fff" : "transparent",
              border: active ? "1.5px solid #5c6ac4" : "1.5px solid transparent",
              borderRadius: 14,
              padding: "2px 7px",
              fontSize: 16,
              cursor: "pointer",
              lineHeight: 1,
              transition: "border-color 0.15s, background 0.15s",
              outline: "none",
            }}
            aria-pressed={active}
          >
            {flag}
          </button>
        );
      })}
    </div>
  );
}
