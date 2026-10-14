/* Picklo lockers inside cash-on-delivery forms (Releasit).
 * Releasit keeps its form in window._rsiV2 (getState/setState) and turns every key of
 * state.formValues into an order attribute. When the shopper picks a locker rate in the form,
 * Picklo shows a locker picker and writes _rc_method/_rc_courier/_rc_point_* into formValues,
 * so the order arrives with the chosen locker — the same attributes the cart widget sets. */
(function () {
  "use strict";
  if (window.__pickloCod) return;
  window.__pickloCod = true;

  const cfgEl = document.getElementById("picklo-cod-config");
  if (!cfgEl) return;
  const CFG = cfgEl.dataset;
  const COUNTRY = (CFG.country || "ro").toLowerCase();
  const KEYWORDS = String(CFG.keywords || "locker,easybox,fanbox").split(",").map((k) => k.trim().toLowerCase()).filter(Boolean);
  const LANG = ["ro", "en", "de", "hu", "cs"].includes(CFG.lang) ? CFG.lang : "ro";

  const TXT = {
    ro: { choose: "Alege lockerul", change: "Schimbă lockerul", needed: "Ai ales livrarea la locker: alege lockerul în care vrei coletul.", search: "Oraș, cod poștal, adresă…", none: "Niciun punct găsit.", pick: "Alege", chosen: "Locker ales", close: "Închide", loading: "Se încarcă lockerele…" },
    en: { choose: "Choose a locker", change: "Change locker", needed: "You chose locker delivery: pick the locker for your parcel.", search: "City, postcode, address…", none: "No points found.", pick: "Choose", chosen: "Chosen locker", close: "Close", loading: "Loading lockers…" },
    de: { choose: "Abholstation wählen", change: "Station ändern", needed: "Du hast Lieferung an eine Abholstation gewählt: wähle die Station.", search: "Stadt, PLZ, Adresse…", none: "Keine Stationen gefunden.", pick: "Wählen", chosen: "Gewählte Station", close: "Schließen", loading: "Stationen werden geladen…" },
    hu: { choose: "Csomagautomata választása", change: "Automata módosítása", needed: "Csomagautomatás szállítást választottál: válaszd ki az automatát.", search: "Város, irányítószám, cím…", none: "Nincs találat.", pick: "Kiválaszt", chosen: "Kiválasztott automata", close: "Bezár", loading: "Automaták betöltése…" },
    cs: { choose: "Vybrat výdejní místo", change: "Změnit místo", needed: "Zvolil(a) jsi doručení na výdejní místo: vyber ho.", search: "Město, PSČ, adresa…", none: "Žádná místa.", pick: "Vybrat", chosen: "Vybrané místo", close: "Zavřít", loading: "Načítání míst…" },
  }[LANG];

  // Rate title → courier ("Livrare easybox" → sameday); null when the title names no courier
  const COURIER_WORDS = [
    ["sameday", /easybox|sameday/i], ["fan", /fanbox|fan courier/i], ["cargus", /cargus|ship\s*&\s*go/i],
    ["gls", /gls|parcelshop/i], ["packeta", /packeta|z-?box|zásilkovna/i], ["dpd", /dpd/i],
  ];
  const courierFromTitle = (t) => (COURIER_WORDS.find(([, re]) => re.test(t)) || [null])[0];
  const isLockerRate = (t) => KEYWORDS.some((k) => String(t || "").toLowerCase().includes(k));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let enabled = null; // couriers set up in Picklo
  let chosen = null;  // { courier, id, name, address }
  let points = [];
  let user = null;    // { lat, lng }

  async function loadEnabled() {
    if (enabled) return enabled;
    try {
      const r = await fetch("/apps/rocourier/widget-config");
      const j = await r.json();
      enabled = Array.isArray(j.couriers) ? j.couriers : [];
    } catch { enabled = []; }
    return enabled;
  }

  // The shipping rate currently chosen in the Releasit form (by title)
  function selectedRateTitle(state) {
    const titles = (state?.shippingRates?.items_array || []).map((r) => r.title).filter(Boolean);
    const values = Object.values(state?.formValues || {}).map(String);
    const fromValues = titles.find((t) => values.some((v) => v === t || v.includes(t)));
    if (fromValues) return fromValues;
    // Fallback: the checked radio in the form whose label matches a rate title
    const checked = [...document.querySelectorAll("input[type=radio]:checked")].map((i) => (i.closest("label") || i.parentElement)?.innerText || "");
    return titles.find((t) => checked.some((c) => c.includes(t))) || null;
  }

  function writeToForm(point) {
    const api = window._rsiV2;
    if (!api?.setState) return;
    const extra = point
      ? { _rc_method: "pickup_point", _rc_courier: point.courier, _rc_point_id: String(point.externalId || point.id), _rc_point_name: point.name, _rc_point_address: point.address || "" }
      : { _rc_method: "home_delivery", _rc_courier: "", _rc_point_id: "", _rc_point_name: "", _rc_point_address: "" };
    api.setState((s) => ({ ...s, formValues: { ...(s.formValues || {}), ...extra } }));
  }

  // ── Floating panel next to the form ─────────────────────────────────────────
  const panel = document.createElement("div");
  panel.id = "picklo-cod-panel";
  panel.setAttribute("role", "region");
  panel.style.cssText = "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483646;max-width:440px;width:calc(100% - 32px);background:#fff;color:#111;border:1px solid #ddd;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.18);padding:12px 14px;font:14px/1.4 system-ui,-apple-system,sans-serif;display:none";
  document.body.appendChild(panel);

  function renderPanel(required) {
    if (!required) { panel.style.display = "none"; return; }
    panel.style.display = "block";
    panel.innerHTML = chosen
      ? `<div style="font-size:12px;opacity:.7">${esc(TXT.chosen)}</div><div style="font-weight:600">${esc(chosen.name)}</div><div style="font-size:12px;opacity:.75">${esc(chosen.address)}</div><button type="button" id="picklo-cod-open" style="margin-top:8px;font:inherit;padding:8px 12px;border-radius:8px;border:1px solid #111;background:#fff;color:#111;cursor:pointer">${esc(TXT.change)}</button>`
      : `<div style="margin-bottom:8px">${esc(TXT.needed)}</div><button type="button" id="picklo-cod-open" style="font:inherit;padding:10px 14px;border-radius:8px;border:0;background:#111;color:#fff;cursor:pointer;width:100%">${esc(TXT.choose)}</button>`;
    panel.querySelector("#picklo-cod-open").addEventListener("click", openPicker);
  }

  // ── Picker modal (list + map) ───────────────────────────────────────────────
  let modal, listEl, mapEl, searchEl, map, layer, currentCouriers = [];
  function ensureLeaflet() {
    if (window.L) return Promise.resolve();
    return new Promise((res) => {
      const css = document.createElement("link"); css.rel = "stylesheet"; css.href = CFG.leafletCss; document.head.appendChild(css);
      const js = document.createElement("script"); js.src = CFG.leafletJs; js.onload = () => res(); js.onerror = () => res(); document.head.appendChild(js);
    });
  }
  function buildModal() {
    modal = document.createElement("div");
    modal.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font:14px/1.4 system-ui,-apple-system,sans-serif";
    modal.innerHTML = `<div style="background:#fff;color:#111;width:min(920px,100% - 24px);height:min(640px,100% - 24px);border-radius:14px;overflow:hidden;display:flex;flex-direction:column">
      <div style="display:flex;gap:8px;padding:10px;border-bottom:1px solid #eee"><input id="picklo-cod-search" placeholder="${esc(TXT.search)}" style="flex:1;font:inherit;padding:9px 12px;border:1px solid #ccc;border-radius:8px"><button type="button" id="picklo-cod-close" style="font:inherit;padding:8px 12px;border:1px solid #ccc;border-radius:8px;background:#fff;cursor:pointer">${esc(TXT.close)}</button></div>
      <div style="flex:1;display:flex;min-height:0"><div id="picklo-cod-map" style="flex:1.2;min-width:0"></div><ul id="picklo-cod-list" style="flex:1;min-width:0;list-style:none;margin:0;padding:0;overflow:auto;border-left:1px solid #eee"></ul></div></div>`;
    document.body.appendChild(modal);
    listEl = modal.querySelector("#picklo-cod-list");
    mapEl = modal.querySelector("#picklo-cod-map");
    searchEl = modal.querySelector("#picklo-cod-search");
    modal.querySelector("#picklo-cod-close").addEventListener("click", () => { modal.style.display = "none"; });
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.style.display = "none"; });
    searchEl.addEventListener("input", renderList);
    if (window.matchMedia("(max-width: 640px)").matches) { mapEl.style.display = "none"; listEl.style.borderLeft = "0"; }
  }
  const dist = (p) => (user && p.lat && p.lng) ? Math.hypot(p.lat - user.lat, (p.lng - user.lng) * Math.cos(user.lat * Math.PI / 180)) : Infinity;
  function filtered() {
    const words = (searchEl.value || "").toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
    return points.filter((p) => p.avail !== "full").filter((p) => !words.length || words.every((w) => `${p.name} ${p.address} ${p.city || ""}`.toLowerCase().includes(w)))
      .sort((a, b) => dist(a) - dist(b));
  }
  function choose(p) {
    chosen = { courier: p.courier, id: p.externalId, externalId: p.externalId, name: p.name, address: p.address };
    writeToForm(chosen);
    modal.style.display = "none";
    renderPanel(true);
  }
  function renderList() {
    const list = filtered().slice(0, 80);
    listEl.innerHTML = list.length ? "" : `<li style="padding:16px;opacity:.7">${esc(TXT.none)}</li>`;
    list.forEach((p) => {
      const li = document.createElement("li");
      li.style.cssText = "padding:10px 12px;border-bottom:1px solid #f0f0f0;display:flex;gap:10px;align-items:center";
      const hours = [p.hours === "24/7" ? "Non-stop" : "", p.avail === "busy" ? ({ ro: "Aproape plin", en: "Almost full", de: "Fast voll", hu: "Majdnem tele", cs: "Téměř plné" }[LANG]) : ""].filter(Boolean).join(" · ");
      li.innerHTML = `<div style="flex:1;min-width:0"><div style="font-weight:600">${esc(p.name)}</div><div style="font-size:12px;opacity:.75">${esc(p.address)}</div>${hours ? `<div style="font-size:11px;opacity:.6">${hours}</div>` : ""}</div><button type="button" style="font:inherit;padding:7px 12px;border-radius:8px;border:0;background:#111;color:#fff;cursor:pointer">${esc(TXT.pick)}</button>`;
      li.querySelector("button").addEventListener("click", () => choose(p));
      listEl.appendChild(li);
    });
    if (map && window.L) {
      layer.clearLayers();
      list.forEach((p) => { if (p.lat && p.lng) window.L.marker([p.lat, p.lng]).addTo(layer).bindPopup(esc(p.name)).on("click", () => choose(p)); });
      const pts = list.filter((p) => p.lat && p.lng).map((p) => [p.lat, p.lng]);
      if (pts.length) try { map.fitBounds(pts.slice(0, 30), { padding: [30, 30], maxZoom: 14 }); } catch (_) {}
    }
  }
  async function openPicker() {
    if (!modal) buildModal();
    modal.style.display = "flex";
    listEl.innerHTML = `<li style="padding:16px;opacity:.7">${esc(TXT.loading)}</li>`;
    if (!user && navigator.geolocation) {
      await new Promise((res) => navigator.geolocation.getCurrentPosition((pos) => { user = { lat: pos.coords.latitude, lng: pos.coords.longitude }; res(); }, () => res(), { timeout: 4000 }));
    }
    try {
      const geo = user ? `&lat=${user.lat.toFixed(5)}&lng=${user.lng.toFixed(5)}` : "";
      const r = await fetch(`/apps/rocourier/pickup-points?courier=${currentCouriers.join(",")}&country=${COUNTRY}${geo}`);
      points = (await r.json()).points || [];
    } catch { points = []; }
    await ensureLeaflet();
    if (window.L && !map && mapEl.style.display !== "none") {
      map = window.L.map(mapEl).setView([45.9, 24.9], 6);
      window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 19 }).addTo(map);
      layer = window.L.layerGroup().addTo(map);
      setTimeout(() => map.invalidateSize(), 50);
    }
    renderList();
  }

  // ── Follow the Releasit form ────────────────────────────────────────────────
  let lastRate = undefined;
  async function onUpdate() {
    const state = window._rsiV2?.getState?.();
    if (!state) return;
    if (!state.isOpen) { panel.style.display = "none"; return; }
    const rate = selectedRateTitle(state);
    const locker = !!rate && isLockerRate(rate);
    if (rate !== lastRate) {
      lastRate = rate;
      const list = await loadEnabled();
      const named = courierFromTitle(rate || "");
      currentCouriers = named && list.includes(named) ? [named] : list;
      if (chosen && !currentCouriers.includes(chosen.courier)) chosen = null;
      if (!locker) writeToForm(null); else if (chosen) writeToForm(chosen);
    }
    renderPanel(locker && currentCouriers.length > 0);
  }

  window.addEventListener("rsi::v2::update", () => { onUpdate(); });
  // The update event isn't fired for every change (e.g. picking a rate): poll lightly while open
  setInterval(() => { if (window._rsiV2?.getState?.()?.isOpen || panel.style.display === "block") onUpdate(); }, 800);
})();
