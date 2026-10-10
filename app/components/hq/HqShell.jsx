// app/components/hq/HqShell.jsx — Polaris shell for the team dashboard (not embedded in Shopify)
import { AppProvider, Frame, TopBar, Navigation } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import { useLocation, useSubmit } from "@remix-run/react";
import { useState } from "react";

export function HqProvider({ children }) {
  return <AppProvider i18n={enTranslations}>{children}</AppProvider>;
}

export function HqShell({ member, counts, children }) {
  const location = useLocation();
  const submit = useSubmit();
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const at = (p) => (p === "/hq" ? location.pathname === "/hq" : location.pathname.startsWith(p));

  const topBar = (
    <TopBar
      showNavigationToggle
      onNavigationToggle={() => setNavOpen((v) => !v)}
      userMenu={
        <TopBar.UserMenu
          name={member.name}
          detail={member.role === "admin" ? "Administrator" : "Suport"}
          initials={member.name.slice(0, 1).toUpperCase()}
          open={menuOpen}
          onToggle={() => setMenuOpen((v) => !v)}
          actions={[{ items: [{ content: "Ieșire", onAction: () => submit(null, { method: "post", action: "/hq/logout" }) }] }]}
        />
      }
    />
  );
  const nav = (
    <Navigation location={location.pathname}>
      <Navigation.Section
        title="Picklo HQ"
        items={[
          { url: "/hq", label: "Acasă", selected: at("/hq") },
          { url: "/hq/tickets", label: "Tichete", selected: at("/hq/tickets"), badge: counts?.unread ? String(counts.unread) : undefined },
          { url: "/hq/shops", label: "Magazine", selected: at("/hq/shops") },
          ...(member.role === "admin" ? [{ url: "/hq/team", label: "Echipă", selected: at("/hq/team") }] : []),
        ]}
      />
    </Navigation>
  );
  return (
    <Frame topBar={topBar} navigation={nav} showMobileNavigation={navOpen} onNavigationDismiss={() => setNavOpen(false)}>
      {children}
    </Frame>
  );
}
