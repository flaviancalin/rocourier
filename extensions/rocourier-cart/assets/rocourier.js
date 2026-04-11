// RoCourier Cart Widget — Unified: Home Delivery + Pickup Point
(function () {
  "use strict";

  // ── Courier config ────────────────────────────────────────────────────────────
  // Colors and labels — logos loaded dynamically from widget data attributes
  const COURIERS = {
    fan:     { label: "FAN Courier", pickupLabel: "FANbox",           color: "#FF6600", markerColor: "#FF6600", letter: "F", badgeClass: "rc-badge-fan"     },
    sameday: { label: "Sameday",     pickupLabel: "Sameday easybox",  color: "#003DA5", markerColor: "#003DA5", letter: "S", badgeClass: "rc-badge-sameday" },
    cargus:  { label: "Cargus",      pickupLabel: "Cargus Ship & Go", color: "#E20020", markerColor: "#E20020", letter: "C", badgeClass: "rc-badge-cargus"  },
    gls:     { label: "GLS",         pickupLabel: "GLS ParcelShop",   color: "#003591", markerColor: "#FFD700", letter: "G", badgeClass: "rc-badge-gls"     },
    packeta: { label: "Packeta",     pickupLabel: "Packeta / Z-BOX",  color: "#BA2025", markerColor: "#BA2025", letter: "P", badgeClass: "rc-badge-packeta" },
  };

  // ── Customer-facing translations ──────────────────────────────────────────────
  const STRINGS = {
    ro: {
      free:              "Gratuit",
      section_title:     "Metoda de livrare:",
      home_delivery:     "Livrare la domiciliu",
      home_sub:          "Livrare standard la adresă",
      pickup_title:      "Ridicare din punct fix",
      pickup_sub_none:   "Niciun curier activat",
      change:            "Schimbă",
      all:               "Toate",
      loading:           "Se încarcă punctele de ridicare...",
      no_points:         "Niciun punct găsit în această zonă.",
      config_error:      "Configurare incompletă.",
      load_error:        "Nu s-au putut încărca lockerele. Încearcă din nou.",
      selected:          "✓ Selectat",
      choose:            "Alege",
      select_map:        "Selectează",
      err_no_method:     "Alege o metodă de livrare înainte de a continua!",
      err_no_point:      "Alege un punct de ridicare de pe hartă!",
      points_count:      "{n} puncte",
    },
    en: {
      free:              "Free",
      section_title:     "Delivery method:",
      home_delivery:     "Home delivery",
      home_sub:          "Standard home delivery",
      pickup_title:      "Pickup point",
      pickup_sub_none:   "No couriers activated",
      change:            "Change",
      all:               "All",
      loading:           "Loading pickup points...",
      no_points:         "No points found in this area.",
      config_error:      "Incomplete configuration.",
      load_error:        "Could not load pickup points. Please try again.",
      selected:          "✓ Selected",
      choose:            "Choose",
      select_map:        "Select",
      err_no_method:     "Please choose a delivery method before continuing!",
      err_no_point:      "Please select a pickup point from the map!",
      points_count:      "{n} points",
    },
    de: {
      free:              "Kostenlos",
      section_title:     "Liefermethode:",
      home_delivery:     "Hauslieferung",
      home_sub:          "Standardlieferung nach Hause",
      pickup_title:      "Abholpunkt",
      pickup_sub_none:   "Keine Kuriere aktiviert",
      change:            "Ändern",
      all:               "Alle",
      loading:           "Abholpunkte werden geladen...",
      no_points:         "Keine Punkte in diesem Bereich gefunden.",
      config_error:      "Unvollständige Konfiguration.",
      load_error:        "Abholpunkte konnten nicht geladen werden. Bitte erneut versuchen.",
      selected:          "✓ Ausgewählt",
      choose:            "Wählen",
      select_map:        "Auswählen",
      err_no_method:     "Bitte wählen Sie eine Liefermethode aus!",
      err_no_point:      "Bitte wählen Sie einen Abholpunkt auf der Karte!",
      points_count:      "{n} Punkte",
    },
    hu: {
      free:              "Ingyenes",
      section_title:     "Szállítási mód:",
      home_delivery:     "Házhozszállítás",
      home_sub:          "Normál házhozszállítás",
      pickup_title:      "Csomagpont",
      pickup_sub_none:   "Nincs aktív futár",
      change:            "Csere",
      all:               "Mind",
      loading:           "Csomagpontok betöltése...",
      no_points:         "Ezen a területen nem található pont.",
      config_error:      "Hiányos konfiguráció.",
      load_error:        "Nem sikerült betölteni a csomagpontokat. Kérjük, próbálja újra.",
      selected:          "✓ Kiválasztva",
      choose:            "Válasszon",
      select_map:        "Kiválaszt",
      err_no_method:     "Kérjük, válasszon szállítási módot a folytatás előtt!",
      err_no_point:      "Kérjük, válasszon csomagpontot a térképen!",
      points_count:      "{n} pont",
    },
    cs: {
      free:              "Zdarma",
      section_title:     "Způsob doručení:",
      home_delivery:     "Doručení domů",
      home_sub:          "Standardní doručení domů",
      pickup_title:      "Výdejní místo",
      pickup_sub_none:   "Žádní aktivní kurýři",
      change:            "Změnit",
      all:               "Vše",
      loading:           "Načítání výdejních míst...",
      no_points:         "V této oblasti nebyla nalezena žádná místa.",
      config_error:      "Neúplná konfigurace.",
      load_error:        "Výdejní místa se nepodařilo načíst. Zkuste to prosím znovu.",
      selected:          "✓ Vybráno",
      choose:            "Vybrat",
      select_map:        "Vybrat",
      err_no_method:     "Před pokračováním vyberte způsob doručení!",
      err_no_point:      "Vyberte výdejní místo na mapě!",
      points_count:      "{n} míst",
    },
  };

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function $(id) { return document.getElementById(id); }

  // ── Init ──────────────────────────────────────────────────────────────────────
  function init() {
    const widget = $("rocourier-widget");
    if (!widget) return;

    const SHOP     = widget.dataset.shop    || "";
    const APP_URL  = (widget.dataset.appUrl || "").replace(/\/$/, "");
    const CURRENCY = widget.dataset.currency || "RON";

    // Language — use first 2 chars of shop locale; fallback to "ro"
    const rawLang = (widget.dataset.lang || "ro").slice(0, 2).toLowerCase();
    const lang    = STRINGS[rawLang] ? rawLang : "ro";
    function t(key, vars) {
      let str = (STRINGS[lang] || STRINGS.ro)[key] || key;
      if (vars) str = str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
      return str;
    }

    // Translate static HTML elements generated by Liquid
    function translateUI() {
      const el = (id) => document.getElementById(id);
      if (el("rc-section-title")) el("rc-section-title").textContent = t("section_title");
      if (el("rc-home-label"))    el("rc-home-label").textContent    = t("home_delivery");
      if (el("rc-home-sub"))      el("rc-home-sub").textContent      = t("home_sub");
      if (el("rc-pickup-label"))  el("rc-pickup-label").textContent  = t("pickup_title");
      if (el("rc-change-point"))  el("rc-change-point").textContent  = t("change");
      if (el("rc-filter-all"))    el("rc-filter-all").textContent    = t("all");
      if (el("rc-loading-text"))  el("rc-loading-text").textContent  = t("loading");
      if (el("rc-list-empty"))    el("rc-list-empty").textContent    = t("no_points");
    }
    translateUI();

    // Which couriers are enabled
    const ENABLED = {};
    Object.keys(COURIERS).forEach((c) => {
      ENABLED[c] = widget.dataset[c + "Enabled"] !== "false";
    });

    // Hide filter buttons for disabled couriers
    document.querySelectorAll(".rc-filter-btn[data-courier]").forEach((btn) => {
      const c = btn.dataset.courier;
      if (c && c !== "all" && !ENABLED[c]) btn.style.display = "none";
    });

    // Fee table: { fan: { home: 0, pickup: 0 }, ... }
    const FEES = {};
    Object.keys(COURIERS).forEach((c) => {
      FEES[c] = {
        home:   parseFloat(widget.dataset[c + "HomeFee"])   || 0,
        pickup: parseFloat(widget.dataset[c + "PickupFee"]) || 0,
      };
    });

    // Logo URLs (injected by Liquid via data attributes)
    const LOGOS = {};
    Object.keys(COURIERS).forEach((c) => {
      LOGOS[c] = widget.dataset[c + "Logo"] || "";
    });

    function feeLabel(amount) {
      if (!amount) return t("free");
      return amount.toLocaleString("ro-RO", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " " + CURRENCY;
    }

    // ── Build pickup sub-text dynamically from enabled couriers ───────────────
    const pickupSubEl = $("rc-pickup-sub");
    if (pickupSubEl) {
      const pickupNames = Object.entries(COURIERS)
        .filter(([c]) => ENABLED[c])
        .map(([, cfg]) => cfg.pickupLabel);
      pickupSubEl.textContent = pickupNames.length
        ? pickupNames.join(", ")
        : t("pickup_sub_none");
    }

    // ── DOM refs ───────────────────────────────────────────────────────────────
    const homeRadio      = $("rc-home");
    const pickupRadio    = $("rc-pickup");
    const radios         = document.querySelectorAll('input[name="rc_delivery"]');
    const hMethod        = $("rc-h-method");
    const hCourier       = $("rc-h-courier");
    const hPointId       = $("rc-h-point-id");
    const hPointNm       = $("rc-h-point-nm");
    const hPointAd       = $("rc-h-point-ad");
    const homeFeeEl      = $("rc-home-fee");
    const pickupFeeEl    = $("rc-pickup-fee");
    const pointSelected  = $("rc-point-selected");
    const pointLogo      = $("rc-point-logo");
    const pointName      = $("rc-point-name");
    const pointAddr      = $("rc-point-addr");
    const changeBtn      = $("rc-change-point");
    const errorBox       = $("rc-error");
    const modal          = $("rc-modal");
    const backdrop       = $("rc-modal-backdrop");
    const modalClose     = $("rc-modal-close");
    const searchInput    = $("rc-search");
    const pointsList     = $("rc-points-list");
    const listLoading    = $("rc-list-loading");
    const listEmpty      = $("rc-list-empty");
    const listCount      = $("rc-list-count");
    const filterBtns     = document.querySelectorAll(".rc-filter-btn");

    // ── State ──────────────────────────────────────────────────────────────────
    let allPoints     = [];
    let filtered      = [];
    let selectedPoint = null;   // chosen pickup point object
    let currentFilter = "all";
    let mapInst       = null;
    let mapReady      = false;
    let pointsLoaded  = false;

    // Default courier: first enabled courier (used for home delivery)
    const enabledCouriers  = Object.keys(COURIERS).filter((c) => ENABLED[c]);
    const defaultCourier   = enabledCouriers[0] || null;

    // ── Radio change: Home ──────────────────────────────────────────────────────
    function onHomeSelected() {
      // Hide pickup point summary
      if (pointSelected) pointSelected.style.display = "none";
      // Clear pickup-fee display
      if (pickupFeeEl) pickupFeeEl.textContent = "";
      hideError();
      // Auto-set to the default (first enabled) courier
      if (defaultCourier) {
        if (homeFeeEl) homeFeeEl.textContent = feeLabel(FEES[defaultCourier]?.home || 0);
        setHiddenHome(defaultCourier);
      }
    }

    // ── Radio change: Pickup ────────────────────────────────────────────────────
    function onPickupSelected() {
      // Clear home-fee display
      if (homeFeeEl) homeFeeEl.textContent = "";
      // If no point selected yet, open the map
      if (!selectedPoint) {
        clearHiddenPoint();
        openModal();
      } else {
        // Restore the pickup-fee for previously selected courier
        updatePickupFee(selectedPoint.courier);
        if (hMethod)  hMethod.value  = "pickup_point";
        if (hCourier) hCourier.value = selectedPoint.courier;
        syncCart();
      }
      hideError();
    }

    radios.forEach((r) => {
      r.addEventListener("change", () => {
        if (!r.checked) return;
        if (r.value === "home")   onHomeSelected();
        if (r.value === "pickup") onPickupSelected();
      });
    });

    function setHiddenHome(courier) {
      if (hMethod)  hMethod.value  = "home_delivery";
      if (hCourier) hCourier.value = courier;
      if (hPointId) hPointId.value = "";
      if (hPointNm) hPointNm.value = "";
      if (hPointAd) hPointAd.value = "";
      syncCart();
    }

    function updatePickupFee(courier) {
      if (pickupFeeEl) pickupFeeEl.textContent = feeLabel(FEES[courier]?.pickup || 0);
    }

    // ── Modal ──────────────────────────────────────────────────────────────────
    function openModal() {
      if (!modal) return;
      modal.style.display = "flex";
      document.body.style.overflow = "hidden";
      if (!pointsLoaded) fetchPoints();
      else applyFilters();
      tryInitMap();
    }

    function tryInitMap(attempts) {
      attempts = attempts || 0;
      if (typeof L !== "undefined") {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          initMap();
          if (mapInst) mapInst.invalidateSize();
          setTimeout(() => { if (mapInst) mapInst.invalidateSize(); }, 300);
        }));
      } else if (attempts < 30) {
        setTimeout(() => tryInitMap(attempts + 1), 100);
      }
    }

    function closeModal() {
      if (!modal) return;
      modal.style.display = "none";
      document.body.style.overflow = "";
      // If user closed without selecting a point, un-check the pickup radio
      if (!selectedPoint) {
        if (pickupRadio) pickupRadio.checked = false;
        clearHiddenPoint();
      }
    }

    changeBtn  && changeBtn.addEventListener("click", openModal);
    modalClose && modalClose.addEventListener("click", closeModal);
    backdrop   && backdrop.addEventListener("click", closeModal);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal?.style.display === "flex") closeModal();
    });

    // ── Fetch pickup points ────────────────────────────────────────────────────
    async function fetchPoints() {
      if (listLoading) listLoading.style.display = "flex";
      if (listEmpty)   listEmpty.style.display   = "none";
      if (pointsList)  pointsList.innerHTML       = "";
      if (listCount)   listCount.style.display    = "none";

      if (!APP_URL || !SHOP) {
        if (listLoading) listLoading.style.display = "none";
        if (listEmpty) { listEmpty.textContent = t("config_error"); listEmpty.style.display = "block"; }
        return;
      }

      try {
        const enabledWithPickup = Object.keys(COURIERS).filter((c) => ENABLED[c]);
        const couriersParam = enabledWithPickup.join(",") || "all";
        const url = `${APP_URL}/api/pickup-points?shop=${encodeURIComponent(SHOP)}&courier=${couriersParam}`;
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        allPoints    = data.points || [];
        pointsLoaded = true;
        applyFilters();
        if (mapInst) { mapInst.invalidateSize(); renderMarkers(filtered); }
      } catch (err) {
        if (listEmpty) { listEmpty.textContent = t("load_error"); listEmpty.style.display = "block"; }
        console.error("RoCourier:", err);
      } finally {
        if (listLoading) listLoading.style.display = "none";
      }
    }

    // ── Nominatim geocode & pan ───────────────────────────────────────────────
    let _geocodeTimer = null;
    function geocodeAndCenter(q) {
      clearTimeout(_geocodeTimer);
      if (!mapInst || q.length < 4) return;
      _geocodeTimer = setTimeout(async () => {
        try {
          const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=ro&limit=1`;
          const res  = await fetch(url, { headers: { "Accept": "application/json" } });
          const data = await res.json();
          if (data.length > 0 && mapInst) {
            const { lat, lon, boundingbox } = data[0];
            if (boundingbox) {
              mapInst.fitBounds(
                [[+boundingbox[0], +boundingbox[2]], [+boundingbox[1], +boundingbox[3]]],
                { maxZoom: 14 }
              );
            } else {
              mapInst.setView([+lat, +lon], 14);
            }
          }
        } catch (_) {}
      }, 600);
    }

    // ── Filters ────────────────────────────────────────────────────────────────
    function applyFilters() {
      const raw   = (searchInput?.value || "").toLowerCase().trim();
      // Split into words (≥2 chars), every word must match at least one field
      const words = raw ? raw.split(/\s+/).filter((w) => w.length >= 2) : [];
      filtered = allPoints.filter((p) => {
        if (currentFilter !== "all" && p.courier !== currentFilter) return false;
        if (!words.length) return true;
        const haystack = [p.name, p.address, p.city, p.county]
          .map((s) => (s || "").toLowerCase()).join(" ");
        return words.every((w) => haystack.includes(w));
      });
      renderList(filtered);
      if (mapInst) renderMarkers(filtered);
      if (listEmpty) listEmpty.style.display = filtered.length === 0 ? "block" : "none";
      if (listCount) { listCount.textContent = t("points_count", { n: filtered.length }); listCount.style.display = "block"; }

      // Pan map to searched location via geocoding
      if (raw.length >= 4) geocodeAndCenter(raw);
    }

    searchInput && searchInput.addEventListener("input", applyFilters);
    filterBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        filterBtns.forEach((b) => b.classList.remove("rc-filter-active"));
        btn.classList.add("rc-filter-active");
        currentFilter = btn.dataset.courier;
        applyFilters();
      });
    });

    // ── Render list ────────────────────────────────────────────────────────────
    function renderList(points) {
      if (!pointsList) return;
      pointsList.innerHTML = "";
      points.forEach((p) => {
        const cfg   = COURIERS[p.courier] || { pickupLabel: p.courier, color: "#888", badgeClass: "" };
        const isSel = selectedPoint?.id === p.id;
        const li    = document.createElement("li");
        li.className  = "rc-item" + (isSel ? " rc-item-selected" : "");
        li.dataset.id = p.id;

        const logoUrl = LOGOS[p.courier] || "";
        const hasCoords = !!(p.lat && p.lng);
        const targetBtn = hasCoords
          ? `<button type="button" class="rc-item-go-btn" title="Show on map">
               <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/><path d="M12 2v2.5M12 19.5v2.5M2 12h2.5M19.5 12h2.5"/></svg>
             </button>`
          : "";
        li.innerHTML = `
          <div class="rc-item-top">
            ${logoUrl
              ? `<img src="${logoUrl}" alt="${esc(cfg.label)}" class="rc-item-logo">`
              : `<span class="rc-item-badge ${cfg.badgeClass}" style="background:${cfg.color}22;color:${cfg.color};border:1px solid ${cfg.color}44">${esc(cfg.pickupLabel)}</span>`
            }
            ${targetBtn}
          </div>
          <strong class="rc-item-name">${esc(p.name)}</strong>
          <span class="rc-item-addr">${esc(p.address)}</span>
          <button type="button" class="rc-item-btn ${isSel ? "rc-item-btn-sel" : ""}" style="${isSel ? "" : `background:${cfg.color}`}">
            ${isSel ? t("selected") : t("choose")}
          </button>
        `;

        li.querySelector(".rc-item-btn").addEventListener("click", (e) => {
          e.stopPropagation();
          selectPoint(p);
        });

        const goBtn = li.querySelector(".rc-item-go-btn");
        if (goBtn) {
          goBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (mapInst && p.lat && p.lng) {
              mapInst.setView([p.lat, p.lng], 16);
              const marker = window.__rcMarkers?.find((m) => m._rcId === p.id);
              if (marker) marker.openPopup();
            }
          });
        }

        // Clicking the row body (not buttons) also flies to the point
        li.addEventListener("click", () => {
          if (mapInst && p.lat && p.lng) {
            mapInst.setView([p.lat, p.lng], 16);
            const marker = window.__rcMarkers?.find((m) => m._rcId === p.id);
            if (marker) marker.openPopup();
          }
        });

        pointsList.appendChild(li);
      });
    }

    // ── Leaflet map ────────────────────────────────────────────────────────────
    function initMap() {
      if (mapReady || typeof L === "undefined") return;
      const el = $("rc-map");
      if (!el) return;

      mapInst = L.map("rc-map", { zoomControl: true }).setView([45.94, 24.97], 7);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(mapInst);

      mapReady = true;
      window.__rcMarkers = [];

      // ── "My location" floating button ─────────────────────────────────────
      const mapPanel = el.parentElement;
      if (mapPanel) {
        const locBtn = document.createElement("button");
        locBtn.type      = "button";
        locBtn.className = "rc-map-locate-btn";
        locBtn.title     = "My location";
        locBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>`;
        locBtn.addEventListener("click", () => {
          if (!navigator.geolocation) return;
          navigator.geolocation.getCurrentPosition(
            (pos) => mapInst.setView([pos.coords.latitude, pos.coords.longitude], 14),
            () => {}
          );
        });
        mapPanel.appendChild(locBtn);
      }

      if (pointsLoaded) renderMarkers(filtered);
    }

    function renderMarkers(points) {
      if (!mapInst) return;
      (window.__rcMarkers || []).forEach((m) => mapInst.removeLayer(m));
      window.__rcMarkers = [];

      const coords = [];
      points.forEach((p) => {
        if (!p.lat || !p.lng) return;
        const cfg      = COURIERS[p.courier] || { color: "#888", markerColor: "#888", letter: "?", pickupLabel: p.courier };
        const isSel    = selectedPoint?.id === p.id;
        const pinColor = isSel ? "#108043" : cfg.markerColor;
        // For GLS (yellow pin) use dark letter; selected always white
        const letterColor = isSel ? "#fff" : (p.courier === "gls" ? "#003591" : "#fff");
        const logoUrl  = LOGOS[p.courier] || "";

        const innerHtml = logoUrl
          ? `<div style="width:28px;height:22px;background:#fff;border-radius:4px;display:flex;align-items:center;justify-content:center;padding:2px">
               <img src="${logoUrl}" style="max-width:24px;max-height:16px;object-fit:contain;pointer-events:none;display:block" alt="">
             </div>`
          : `<span style="color:${letterColor};font-weight:900;font-size:13px;text-shadow:0 1px 2px rgba(0,0,0,.3)">${cfg.letter}</span>`;

        const icon = L.divIcon({
          className: "",
          html: `<div style="position:relative;width:36px;height:46px">
            <div style="width:36px;height:36px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${pinColor};box-shadow:0 2px 8px rgba(0,0,0,.35);border:2.5px solid rgba(255,255,255,.9)"></div>
            <div style="position:absolute;top:0;left:0;width:36px;height:36px;display:flex;align-items:center;justify-content:center">${innerHtml}</div>
          </div>`,
          iconSize: [36, 46], iconAnchor: [18, 46], popupAnchor: [0, -48],
        });

        const logoHtml = logoUrl
          ? `<img src="${logoUrl}" alt="${esc(cfg.label)}" style="height:20px;margin-bottom:6px;display:block">`
          : `<div style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;margin-bottom:6px;background:${cfg.color}22;color:${cfg.color};border:1px solid ${cfg.color}44">${esc(cfg.pickupLabel)}</div>`;

        const marker = L.marker([p.lat, p.lng], { icon })
          .addTo(mapInst)
          .bindPopup(
            `<div style="min-width:170px;font-family:inherit">
              ${logoHtml}
              <div style="font-weight:600;margin-bottom:3px">${esc(p.name)}</div>
              <div style="font-size:12px;color:#666;margin-bottom:9px">${esc(p.address)}</div>
              <button onclick="window.__rcPick('${p.id}')" style="width:100%;padding:7px 0;background:${cfg.markerColor};color:${p.courier === "gls" ? "#003591" : "#fff"};border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:13px">
                ${isSel ? t("selected") : t("select_map")}
              </button>
            </div>`
          );

        marker._rcId = p.id;
        window.__rcMarkers.push(marker);
        coords.push([p.lat, p.lng]);
      });

      if (coords.length > 0) {
        try { mapInst.fitBounds(coords, { padding: [40, 40], maxZoom: 13 }); } catch (_) {}
      }
    }

    window.__rcPick = (id) => {
      const p = allPoints.find((x) => x.id === id);
      if (p) selectPoint(p);
    };

    // ── Select a pickup point ──────────────────────────────────────────────────
    function selectPoint(p) {
      selectedPoint = p;
      const cfg = COURIERS[p.courier] || { pickupLabel: p.courier, badgeClass: "", color: "#888" };

      if (hMethod)  hMethod.value  = "pickup_point";
      if (hCourier) hCourier.value = p.courier;
      if (hPointId) hPointId.value = p.externalId || p.id;
      if (hPointNm) hPointNm.value = p.name;
      if (hPointAd) hPointAd.value = p.address;

      // Check the pickup radio
      if (pickupRadio) pickupRadio.checked = true;

      // Update pickup fee to this courier's fee
      updatePickupFee(p.courier);

      // Show selected summary bar with logo
      if (pointLogo) {
        const logoUrl = LOGOS[p.courier] || "";
        if (logoUrl) {
          pointLogo.src   = logoUrl;
          pointLogo.alt   = cfg.label;
          pointLogo.style.display = "block";
        } else {
          pointLogo.style.display = "none";
        }
      }
      if (pointName) pointName.textContent = p.name;
      if (pointAddr) pointAddr.textContent = p.address;
      if (pointSelected) pointSelected.style.display = "flex";

      hideError();
      syncCart();
      renderList(filtered);
      renderMarkers(filtered);
      closeModal();
    }

    function clearHiddenPoint() {
      if (hMethod)  hMethod.value  = "";
      if (hCourier) hCourier.value = "";
      if (hPointId) hPointId.value = "";
      if (hPointNm) hPointNm.value = "";
      if (hPointAd) hPointAd.value = "";
    }

    // ── Sync cart attributes ───────────────────────────────────────────────────
    function syncCart() {
      fetch("/cart/update.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attributes: {
            _rc_method:        hMethod?.value  || "",
            _rc_courier:       hCourier?.value || "",
            _rc_point_id:      hPointId?.value || "",
            _rc_point_name:    hPointNm?.value || "",
            _rc_point_address: hPointAd?.value || "",
          },
        }),
      }).catch(() => {});
    }

    // ── Checkout guard ─────────────────────────────────────────────────────────
    function blockCheckout(e) {
      const checkedRadio = [...radios].find((r) => r.checked);

      if (!checkedRadio) {
        e.preventDefault(); e.stopPropagation();
        showError(t("err_no_method"));
        widget.scrollIntoView({ behavior: "smooth", block: "center" });
        return false;
      }

      if (checkedRadio.value === "pickup" && !selectedPoint) {
        e.preventDefault(); e.stopPropagation();
        showError(t("err_no_point"));
        widget.scrollIntoView({ behavior: "smooth", block: "center" });
        openModal();
        return false;
      }

      return true;
    }

    function attachCheckoutGuard() {
      const intercept = (el) => {
        if (el._rcGuarded) return;
        el._rcGuarded = true;
        el.addEventListener("click", blockCheckout, true);
      };
      document.querySelectorAll(
        'button[name="checkout"], input[name="checkout"], a[href="/checkout"], [href*="/checkout"]'
      ).forEach(intercept);
      document.querySelectorAll('form[action="/cart"], form[action*="/cart"]').forEach((form) => {
        if (form._rcGuarded) return;
        form._rcGuarded = true;
        form.addEventListener("submit", (e) => {
          if (e.submitter?.name === "checkout" || e.submitter?.value === "checkout") blockCheckout(e);
        }, true);
      });
    }

    attachCheckoutGuard();
    new MutationObserver(attachCheckoutGuard).observe(document.body, { childList: true, subtree: true });

    // ── Error helpers ──────────────────────────────────────────────────────────
    function showError(msg) { if (errorBox) { errorBox.textContent = msg; errorBox.style.display = "block"; } }
    function hideError()    { if (errorBox) errorBox.style.display = "none"; }

    // ── Restore from cart attributes ───────────────────────────────────────────
    async function restore() {
      try {
        const res  = await fetch("/cart.js");
        const cart = await res.json();
        const a    = cart.attributes || {};

        const method  = a["_rc_method"]       || "";
        const courier = a["_rc_courier"]       || "";
        const pid     = a["_rc_point_id"]      || "";
        const pname   = a["_rc_point_name"]    || "";
        const paddr   = a["_rc_point_address"] || "";

        if (!method || !courier) return;

        if (method === "home_delivery") {
          if (homeRadio) homeRadio.checked = true;
          const c = courier || defaultCourier;
          if (c) {
            if (homeFeeEl) homeFeeEl.textContent = feeLabel(FEES[c]?.home || 0);
            setHiddenHome(c);
          }
        } else if (method === "pickup_point" && pid) {
          if (pickupRadio) pickupRadio.checked = true;

          selectedPoint = { id: pid, externalId: pid, courier, name: pname, address: paddr };

          if (hMethod)  hMethod.value  = "pickup_point";
          if (hCourier) hCourier.value = courier;
          if (hPointId) hPointId.value = pid;
          if (hPointNm) hPointNm.value = pname;
          if (hPointAd) hPointAd.value = paddr;

          updatePickupFee(courier);

          const cfg     = COURIERS[courier] || { label: courier, color: "#888" };
          const logoUrl = LOGOS[courier] || "";
          if (pointLogo) {
            if (logoUrl) { pointLogo.src = logoUrl; pointLogo.alt = cfg.label; pointLogo.style.display = "block"; }
            else { pointLogo.style.display = "none"; }
          }
          if (pointName) pointName.textContent = pname;
          if (pointAddr) pointAddr.textContent = paddr;
          if (pointSelected) pointSelected.style.display = "flex";
        }
      } catch (_) {}
    }

    restore();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
