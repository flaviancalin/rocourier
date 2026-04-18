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
      last_used:         "Ultima alegere",
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
      last_used:         "Last used",
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
      last_used:         "Zuletzt verwendet",
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
      last_used:         "Utoljára használt",
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
      last_used:         "Naposledy použité",
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
    const COUNTRY  = (new URLSearchParams(location.search).get("rc_country") || widget.dataset.country || "ro").toLowerCase();

    // Language — Liquid passes store locale via data-lang; app settings can override via API
    const localeLang = (widget.dataset.lang || "ro").slice(0, 2).toLowerCase();
    let lang = STRINGS[localeLang] ? localeLang : "ro";

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

    // Fetch language override from app settings (non-blocking — re-translates if override differs)
    if (APP_URL && SHOP) {
      fetch(`${APP_URL}/api/widget-config?shop=${encodeURIComponent(SHOP)}`)
        .then((r) => r.json())
        .then(({ widgetLanguage }) => {
          if (widgetLanguage && widgetLanguage !== "auto" && STRINGS[widgetLanguage] && widgetLanguage !== lang) {
            lang = widgetLanguage;
            translateUI();
          }
        })
        .catch(() => {});
    }

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

    // Pin image URLs (full teardrop PNG per carrier)
    const PINS = {};
    Object.keys(COURIERS).forEach((c) => {
      PINS[c] = widget.dataset[c + "Pin"] || "";
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
    const homeRow        = $("rc-home-row");
    const pickupRow      = $("rc-pickup-row");
    const methodRows     = document.querySelectorAll(".rc-method-row[data-rc-value]");
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
    const filterToggle   = $("rc-filter-toggle");
    const filtersPanel   = $("rc-type-filters");
    const bottomSheet    = $("rc-bottom-sheet");
    const sheetHandle    = $("rc-sheet-handle");

    // ── State ──────────────────────────────────────────────────────────────────
    let allPoints        = [];
    let filtered         = [];
    let selectedPoint    = null;   // chosen pickup point object
    let currentFilter    = "all";
    let mapInst          = null;
    let clusterGroup     = null;
    let mapReady         = false;
    let pointsLoaded     = false;
    let _userLat         = null;   // customer's latitude (geolocation or IP)
    let _userLng         = null;   // customer's longitude
    let _locationFetched = false;  // don't re-fetch on every modal open

    // Default courier: first enabled courier (used for home delivery)
    const enabledCouriers  = Object.keys(COURIERS).filter((c) => ENABLED[c]);
    const defaultCourier   = enabledCouriers[0] || null;

    // JS-only state — no DOM inputs, nothing Shopify can intercept
    let _method  = "";
    let _courier = "";
    let _pid     = "";
    let _pname   = "";
    let _paddr   = "";

    // ── Row selection helpers ──────────────────────────────────────────────────
    function selectRow(value) {
      methodRows.forEach((r) => {
        const active = r.dataset.rcValue === value;
        r.classList.toggle("rc-selected", active);
        r.setAttribute("aria-checked", active ? "true" : "false");
      });
    }

    // ── Method: Home ───────────────────────────────────────────────────────────
    function onHomeSelected() {
      selectRow("home");
      if (pointSelected) pointSelected.style.display = "none";
      if (pickupFeeEl)   pickupFeeEl.textContent = "";
      hideError();
      if (defaultCourier) {
        if (homeFeeEl) homeFeeEl.textContent = feeLabel(FEES[defaultCourier]?.home || 0);
        _method  = "home_delivery";
        _courier = defaultCourier;
        _pid = _pname = _paddr = "";
        saveSession();
      }
    }

    // ── Method: Pickup ─────────────────────────────────────────────────────────
    function onPickupSelected() {
      selectRow("pickup");
      if (homeFeeEl) homeFeeEl.textContent = "";
      if (!selectedPoint) {
        _method = _courier = _pid = _pname = _paddr = "";
        openModal();
      } else {
        updatePickupFee(selectedPoint.courier);
        _method  = "pickup_point";
        _courier = selectedPoint.courier;
        saveSession();
      }
      hideError();
    }

    // Click listeners on the div rows — completely invisible to Shopify
    if (homeRow)   homeRow.addEventListener("click",   onHomeSelected);
    if (pickupRow) pickupRow.addEventListener("click", onPickupSelected);
    // Keyboard accessibility
    methodRows.forEach((row) => {
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (row.dataset.rcValue === "home")   onHomeSelected();
          if (row.dataset.rcValue === "pickup") onPickupSelected();
        }
      });
    });

    function setHiddenHome(courier) {
      _method  = "home_delivery";
      _courier = courier;
      _pid = _pname = _paddr = "";
      saveSession();
    }

    function updatePickupFee(courier) {
      if (pickupFeeEl) pickupFeeEl.textContent = feeLabel(FEES[courier]?.pickup || 0);
    }

    // ── Modal ──────────────────────────────────────────────────────────────────
    let _modalOpen = false;
    let _scrollY   = 0;

    function lockScroll() {
      _scrollY = window.scrollY || window.pageYOffset;
      // iOS Safari-safe scroll lock: position:fixed preserves layout width
      document.body.style.position   = "fixed";
      document.body.style.top        = `-${_scrollY}px`;
      document.body.style.left       = "0";
      document.body.style.right      = "0";
      document.body.style.overflowY  = "scroll"; // keep scrollbar width to prevent layout shift
    }

    function unlockScroll() {
      document.body.style.position  = "";
      document.body.style.top       = "";
      document.body.style.left      = "";
      document.body.style.right     = "";
      document.body.style.overflowY = "";
      window.scrollTo(0, _scrollY);
    }

    // ── Distance helpers ───────────────────────────────────────────────────────
    function haversine(lat1, lng1, lat2, lng2) {
      const R = 6371; // km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLng = (lng2 - lng1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2
              + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
              * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    function formatDist(km) {
      return km < 1
        ? Math.round(km * 1000) + " m"
        : km < 10
          ? km.toFixed(1) + " km"
          : Math.round(km) + " km";
    }
    function distTo(p) {
      if (_userLat === null || !p.lat || !p.lng) return null;
      return haversine(_userLat, _userLng, p.lat, p.lng);
    }

    // ── User location — geolocation → IP fallback ──────────────────────────────
    function fetchUserLocation() {
      if (_locationFetched) return;
      _locationFetched = true;

      function onCoords(lat, lng) {
        _userLat = lat;
        _userLng = lng;
        // Pan map if already open
        if (mapInst) mapInst.setView([lat, lng], 12);
        // Re-render list with distances + sorted
        if (pointsLoaded) applyFilters();
      }

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => onCoords(pos.coords.latitude, pos.coords.longitude),
          () => tryIPLocation(), // denied or unavailable → fall back
          { timeout: 6000, maximumAge: 300000 }
        );
      } else {
        tryIPLocation();
      }
    }
    function tryIPLocation() {
      fetch("https://ipapi.co/json/")
        .then((r) => r.json())
        .then(({ latitude, longitude }) => {
          if (latitude && longitude) {
            _userLat = latitude;
            _userLng = longitude;
            if (mapInst) mapInst.setView([latitude, longitude], 12);
            if (pointsLoaded) applyFilters();
          }
        })
        .catch(() => {});
    }

    function openModal() {
      if (!modal) return;
      _modalOpen = true;
      modal.style.display = "flex";
      lockScroll();
      if (!pointsLoaded) fetchPoints();
      else applyFilters();
      tryInitMap();
      fetchUserLocation();
    }

    function tryInitMap(attempts) {
      attempts = attempts || 0;
      if (typeof L !== "undefined") {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          // If the map container was replaced by a section re-render, reset state
          const mapEl = $("rc-map");
          if (mapInst && mapEl && !mapEl.contains(mapInst.getContainer())) {
            mapInst = null;
            clusterGroup = null;
            mapReady = false;
            window.__rcMarkers = [];
          }
          initMap();
          if (mapInst) {
            mapInst.invalidateSize();
            setTimeout(() => { if (mapInst) mapInst.invalidateSize(); }, 300);
          }
        }));
      } else if (attempts < 30) {
        setTimeout(() => tryInitMap(attempts + 1), 100);
      }
    }

    function closeModal() {
      if (!modal) return;
      _modalOpen = false;
      modal.style.display = "none";
      unlockScroll();
      // If user closed without selecting a point, deselect the pickup row
      if (!selectedPoint) {
        selectRow(null);
        clearHiddenPoint();
      }
    }

    changeBtn  && changeBtn.addEventListener("click", openModal);
    modalClose && modalClose.addEventListener("click", closeModal);
    backdrop   && backdrop.addEventListener("click", closeModal);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal?.style.display === "flex") closeModal();
    });

    // ── Filter toggle ──────────────────────────────────────────────────────────
    if (filterToggle && filtersPanel) {
      filterToggle.addEventListener("click", () => {
        const open = filtersPanel.classList.toggle("rc-filters-open");
        filterToggle.classList.toggle("rc-filter-toggle-active", open);
      });
    }

    // ── Bottom sheet drag (mobile) ─────────────────────────────────────────────
    if (sheetHandle && bottomSheet) {
      let dragStart = 0, dragStartH = 0, dragging = false;

      function onDragStart(clientY) {
        dragging   = true;
        dragStart  = clientY;
        dragStartH = bottomSheet.offsetHeight;
        bottomSheet.style.transition = "none";
      }
      function onDragMove(clientY) {
        if (!dragging) return;
        const delta  = dragStart - clientY;
        const newH   = Math.min(Math.max(dragStartH + delta, 120), window.innerHeight * 0.88);
        bottomSheet.style.height = newH + "px";
        // Nudge map to recalculate
        if (mapInst) mapInst.invalidateSize({ animate: false });
      }
      function onDragEnd() {
        if (!dragging) return;
        dragging = false;
        bottomSheet.style.transition = "";
        if (mapInst) mapInst.invalidateSize();
      }

      sheetHandle.addEventListener("touchstart", (e) => { onDragStart(e.touches[0].clientY); }, { passive: true });
      sheetHandle.addEventListener("touchmove",  (e) => { onDragMove(e.touches[0].clientY); },  { passive: true });
      sheetHandle.addEventListener("touchend",   onDragEnd, { passive: true });
      sheetHandle.addEventListener("mousedown",  (e) => onDragStart(e.clientY));
      window.addEventListener("mousemove", (e) => { if (dragging) onDragMove(e.clientY); });
      window.addEventListener("mouseup",   onDragEnd);
    }

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
        const url = `${APP_URL}/api/pickup-points?shop=${encodeURIComponent(SHOP)}&courier=${couriersParam}&country=${COUNTRY}`;
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
          const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=${COUNTRY}&limit=1`;
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
      // Sort by distance when we have the user's location
      if (_userLat !== null) {
        filtered.sort((a, b) => (distTo(a) ?? Infinity) - (distTo(b) ?? Infinity));
      }

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

      // Float last-used point to the top (if it's in the current filtered set)
      const fav = loadFavourite();
      let favPoint = null;
      let orderedPoints = points;
      if (fav) {
        favPoint = points.find((p) => p.id === fav.id);
        if (favPoint) {
          orderedPoints = [favPoint, ...points.filter((p) => p.id !== fav.id)];
        }
      }

      orderedPoints.forEach((p) => {
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
        const isFav = favPoint && p.id === favPoint.id;
        const km    = distTo(p);
        const distBadge = km !== null
          ? `<span class="rc-dist-badge">${formatDist(km)}</span>`
          : "";
        li.innerHTML = `
          <div class="rc-item-top">
            ${logoUrl
              ? `<img src="${logoUrl}" alt="${esc(cfg.label)}" class="rc-item-logo">`
              : `<span class="rc-item-badge ${cfg.badgeClass}" style="background:${cfg.color}22;color:${cfg.color};border:1px solid ${cfg.color}44">${esc(cfg.pickupLabel)}</span>`
            }
            ${isFav ? `<span class="rc-last-used-badge">⭐ ${t("last_used")}</span>` : ""}
            ${distBadge}
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

      mapInst = L.map("rc-map", {
        zoomControl: true,
        preferCanvas: true,       // canvas renderer — much faster on mobile
        zoomSnap: 0.5,
        wheelPxPerZoomLevel: 80,  // smoother mouse-wheel zoom
      }).setView([45.94, 24.97], 7);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
        keepBuffer: 4,            // pre-load more tiles while panning
        updateWhenIdle: false,    // load tiles continuously while moving
        updateWhenZooming: true,
      }).addTo(mapInst);

      mapReady = true;
      window.__rcMarkers = [];

      // Marker clustering
      clusterGroup = L.markerClusterGroup({
        maxClusterRadius: 60,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        iconCreateFunction(cluster) {
          const count = cluster.getChildCount();
          const size  = count < 10 ? 34 : count < 100 ? 40 : 46;
          return L.divIcon({
            html: `<div class="rc-cluster-icon" style="width:${size}px;height:${size}px;line-height:${size}px">${count}</div>`,
            className: "",
            iconSize: [size, size],
          });
        },
      });
      clusterGroup.addTo(mapInst);

      // ── "My location" floating button (appended to map panel) ─────────────
      const mapPanel = $("rc-map-panel");
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
      if (!mapInst || !clusterGroup) return;
      clusterGroup.clearLayers();
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

        const pinUrl = isSel ? "" : (PINS[p.courier] || "");

        let icon;
        if (pinUrl) {
          // Use the full custom PNG pin — sized proportionally (the PNGs are square 2001×2001)
          icon = L.icon({
            iconUrl:     pinUrl,
            iconSize:    [46, 46],
            iconAnchor:  [23, 46],
            popupAnchor: [0, -48],
          });
        } else {
          // Fallback: coloured teardrop (used for selected state or missing pin)
          const innerHtml = logoUrl
            ? `<div style="width:28px;height:22px;background:#fff;border-radius:4px;display:flex;align-items:center;justify-content:center;padding:2px">
                 <img src="${logoUrl}" style="max-width:24px;max-height:16px;object-fit:contain;pointer-events:none;display:block" alt="">
               </div>`
            : `<span style="color:${letterColor};font-weight:900;font-size:13px;text-shadow:0 1px 2px rgba(0,0,0,.3)">${cfg.letter}</span>`;
          icon = L.divIcon({
            className: "",
            html: `<div style="position:relative;width:36px;height:46px">
              <div style="width:36px;height:36px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${pinColor};box-shadow:0 2px 8px rgba(0,0,0,.35);border:2.5px solid rgba(255,255,255,.9)"></div>
              <div style="position:absolute;top:0;left:0;width:36px;height:36px;display:flex;align-items:center;justify-content:center">${innerHtml}</div>
            </div>`,
            iconSize: [36, 46], iconAnchor: [18, 46], popupAnchor: [0, -48],
          });
        }

        const logoHtml = logoUrl
          ? `<img src="${logoUrl}" alt="${esc(cfg.label)}" style="height:20px;margin-bottom:6px;display:block">`
          : `<div style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;margin-bottom:6px;background:${cfg.color}22;color:${cfg.color};border:1px solid ${cfg.color}44">${esc(cfg.pickupLabel)}</div>`;

        const marker = L.marker([p.lat, p.lng], { icon })
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
        clusterGroup.addLayer(marker);
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

      _method  = "pickup_point";
      _courier = p.courier;
      _pid     = p.externalId || p.id;
      _pname   = p.name;
      _paddr   = p.address;

      selectRow("pickup");

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
      saveSession();
      saveFavourite(p);
      renderList(filtered);
      renderMarkers(filtered);
      closeModal();
    }

    function clearHiddenPoint() {
      _method = _courier = _pid = _pname = _paddr = "";
    }

    // ── Session storage (fast, no network, no Shopify re-render) ─────────────
    const SS_KEY = "rc_" + SHOP.replace(/\./g, "_");
    function saveSession() {
      try {
        sessionStorage.setItem(SS_KEY, JSON.stringify({
          method: _method, courier: _courier, pid: _pid, pname: _pname, paddr: _paddr,
        }));
      } catch (_) {}
    }
    function loadSession() {
      try { return JSON.parse(sessionStorage.getItem(SS_KEY) || "null"); } catch (_) { return null; }
    }

    // ── Favourite / last-used pickup point (localStorage — persists across visits) ──
    const LS_KEY = "rc_fav_" + SHOP.replace(/\./g, "_");
    function saveFavourite(p) {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({
          id: p.id, externalId: p.externalId || p.id,
          name: p.name, address: p.address, courier: p.courier,
          lat: p.lat, lng: p.lng,
        }));
      } catch (_) {}
    }
    function loadFavourite() {
      try { return JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch (_) { return null; }
    }

    // ── Sync cart attributes — only called at checkout, never during browsing ──
    function syncCart() {
      fetch("/cart/update.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attributes: {
            _rc_method:        _method,
            _rc_courier:       _courier,
            _rc_point_id:      _pid,
            _rc_point_name:    _pname,
            _rc_point_address: _paddr,
          },
        }),
      }).catch(() => {});
    }

    // ── Checkout guard ─────────────────────────────────────────────────────────
    function blockCheckout(e) {
      if (!_method) {
        e.preventDefault(); e.stopPropagation();
        showError(t("err_no_method"));
        widget.scrollIntoView({ behavior: "smooth", block: "center" });
        return false;
      }

      if (_method === "pickup_point" && !selectedPoint) {
        e.preventDefault(); e.stopPropagation();
        showError(t("err_no_point"));
        widget.scrollIntoView({ behavior: "smooth", block: "center" });
        openModal();
        return false;
      }

      // Only sync to cart at checkout — prevents Shopify section re-renders during browsing
      syncCart();
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

    // ── Restore state — sessionStorage first (fast, no cart update event) ──────
    function applyRestoredState(method, courier, pid, pname, paddr) {
      if (!method || !courier) return;

      if (method === "home_delivery") {
        const c = courier || defaultCourier;
        if (c) {
          selectRow("home");
          if (homeFeeEl) homeFeeEl.textContent = feeLabel(FEES[c]?.home || 0);
          _method = "home_delivery"; _courier = c;
          _pid = _pname = _paddr = "";
        }
      } else if (method === "pickup_point" && pid) {
        selectRow("pickup");
        selectedPoint = { id: pid, externalId: pid, courier, name: pname, address: paddr };
        _method = "pickup_point"; _courier = courier;
        _pid = pid; _pname = pname; _paddr = paddr;
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
    }

    async function restore() {
      // 1. Try sessionStorage first — instant, no network, no cart update event
      const ss = loadSession();
      if (ss && ss.method && ss.courier) {
        applyRestoredState(ss.method, ss.courier, ss.pid, ss.pname, ss.paddr);
        return;
      }
      // 2. Fall back to cart.js (read-only, no update event triggered)
      try {
        const res  = await fetch("/cart.js");
        const cart = await res.json();
        const a    = cart.attributes || {};
        applyRestoredState(
          a["_rc_method"]       || "",
          a["_rc_courier"]      || "",
          a["_rc_point_id"]     || "",
          a["_rc_point_name"]   || "",
          a["_rc_point_address"]|| ""
        );
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
