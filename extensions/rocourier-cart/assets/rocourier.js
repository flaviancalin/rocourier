// extensions/rocourier-cart/assets/rocourier.js
// RoCourier Cart Widget — Leaflet map + pickup point selector

(function () {
  "use strict";

  // ── Wait for DOM ───────────────────────────────────────────────────────────
  function init() {
    const widget = document.getElementById("rocourier-widget");
    if (!widget) return;

    const SHOP     = widget.dataset.shop;
    const APP_URL  = widget.dataset.appUrl || "";
    const FAN_ON   = widget.dataset.fanEnabled !== "false";
    const SAM_ON   = widget.dataset.samedayEnabled !== "false";
    const SHOW_MAP = widget.dataset.showMap !== "false";

    // ── Element refs ──────────────────────────────────────────────────────────
    const homeRadio        = document.getElementById("rocourier-home");
    const pickupRadio      = document.getElementById("rocourier-pickup");
    const pickupSection    = document.getElementById("rocourier-pickup-section");
    const selectedDisplay  = document.getElementById("rocourier-selected-display");
    const selectedBadge    = document.getElementById("rocourier-selected-badge");
    const selectedName     = document.getElementById("rocourier-selected-name");
    const selectedAddress  = document.getElementById("rocourier-selected-address");
    const changeBtn        = document.getElementById("rocourier-change-btn");
    const openMapBtn       = document.getElementById("rocourier-open-map-btn");
    const errorBox         = document.getElementById("rocourier-error");

    const modal            = document.getElementById("rocourier-modal");
    const modalBackdrop    = modal?.querySelector(".rocourier-modal-backdrop");
    const modalClose       = document.getElementById("rocourier-modal-close");
    const searchInput      = document.getElementById("rocourier-search");
    const courierFilter    = document.getElementById("rocourier-courier-filter");
    const pointsList       = document.getElementById("rocourier-points-list");
    const listLoading      = document.getElementById("rocourier-list-loading");
    const listEmpty        = document.getElementById("rocourier-list-empty");
    const mapLoading       = document.getElementById("rocourier-map-loading");

    // Hidden cart inputs
    const rcMethod    = document.getElementById("rc-method");
    const rcCourier   = document.getElementById("rc-courier");
    const rcPointId   = document.getElementById("rc-point-id");
    const rcPointName = document.getElementById("rc-point-name");
    const rcPointAddr = document.getElementById("rc-point-addr");

    // ── State ─────────────────────────────────────────────────────────────────
    let allPoints       = [];
    let filteredPoints  = [];
    let selectedPoint   = null;
    let map             = null;
    let markers         = [];
    let mapInitialized  = false;
    let pointsLoaded    = false;

    // ── Method toggle ─────────────────────────────────────────────────────────
    function onMethodChange() {
      if (pickupRadio && pickupRadio.checked) {
        pickupSection && (pickupSection.style.display = "block");
        setCartAttribute("_rocourier_method", "pickup_point");
        if (rcMethod) rcMethod.value = "pickup_point";
      } else {
        pickupSection && (pickupSection.style.display = "none");
        clearSelectedPoint();
        setCartAttribute("_rocourier_method", "home_delivery");
        if (rcMethod) rcMethod.value = "home_delivery";
      }
    }

    homeRadio  && homeRadio.addEventListener("change",  onMethodChange);
    pickupRadio && pickupRadio.addEventListener("change", onMethodChange);

    // ── Open / close modal ────────────────────────────────────────────────────
    function openModal() {
      if (!modal) return;
      modal.style.display = "flex";
      document.body.style.overflow = "hidden";

      if (!pointsLoaded) fetchPickupPoints();

      if (SHOW_MAP) {
        requestAnimationFrame(() => {
          initMap();
          if (map) map.invalidateSize();
        });
      }
    }

    function closeModal() {
      if (!modal) return;
      modal.style.display = "none";
      document.body.style.overflow = "";
    }

    openMapBtn    && openMapBtn.addEventListener("click",   openModal);
    changeBtn     && changeBtn.addEventListener("click",    openModal);
    modalClose    && modalClose.addEventListener("click",   closeModal);
    modalBackdrop && modalBackdrop.addEventListener("click", closeModal);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal?.style.display === "flex") closeModal();
    });

    // ── Fetch pickup points from our app API ──────────────────────────────────
    async function fetchPickupPoints() {
      if (!APP_URL || !SHOP) {
        showError("Configurare incompletă — contactează magazinul.");
        return;
      }

      if (listLoading) listLoading.style.display = "flex";
      if (listEmpty)   listEmpty.style.display   = "none";
      if (pointsList)  pointsList.innerHTML       = "";

      try {
        const couriers = [FAN_ON && "fan", SAM_ON && "sameday"]
          .filter(Boolean).join(",") || "all";

        const url = `${APP_URL}/api/pickup-points?shop=${encodeURIComponent(SHOP)}&courier=${couriers}`;
        const res = await fetch(url, { headers: { Accept: "application/json" } });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        allPoints      = data.points || [];
        filteredPoints = allPoints;
        pointsLoaded   = true;

        renderList(filteredPoints);
        if (map) renderMarkers(filteredPoints);

        if (mapLoading) mapLoading.style.display = "none";
      } catch (e) {
        showError("Nu s-au putut încărca punctele de ridicare. Încearcă din nou.");
        console.error("RoCourier fetch error:", e);
      } finally {
        if (listLoading) listLoading.style.display = "none";
      }
    }

    // ── Filter logic ──────────────────────────────────────────────────────────
    function applyFilters() {
      const search  = (searchInput?.value || "").toLowerCase().trim();
      const courier = courierFilter?.value || "all";

      filteredPoints = allPoints.filter((p) => {
        const matchCourier = courier === "all" || p.courier === courier;
        const matchSearch  = !search
          || p.name.toLowerCase().includes(search)
          || p.address.toLowerCase().includes(search)
          || (p.city  && p.city.toLowerCase().includes(search))
          || (p.county && p.county.toLowerCase().includes(search));
        return matchCourier && matchSearch;
      });

      renderList(filteredPoints);
      if (map) renderMarkers(filteredPoints);

      if (listEmpty) {
        listEmpty.style.display = filteredPoints.length === 0 ? "block" : "none";
      }
    }

    searchInput    && searchInput.addEventListener("input",  applyFilters);
    courierFilter  && courierFilter.addEventListener("change", applyFilters);

    // ── Render list ───────────────────────────────────────────────────────────
    function renderList(points) {
      if (!pointsList) return;
      pointsList.innerHTML = "";

      points.forEach((point) => {
        const li = document.createElement("li");
        li.className = "rocourier-point-item";
        li.dataset.id = point.id;

        const isSelected = selectedPoint?.id === point.id;
        if (isSelected) li.classList.add("is-selected");

        li.innerHTML = `
          <div class="rc-point-badge rc-badge-${point.courier}">
            ${point.courier === "fan" ? "FANbox" : "Sameday easybox"}
          </div>
          <div class="rc-point-info">
            <strong class="rc-point-name">${escHtml(point.name)}</strong>
            <span class="rc-point-addr">${escHtml(point.address)}</span>
          </div>
          <button type="button" class="rc-select-btn ${isSelected ? "rc-selected-btn" : ""}">
            ${isSelected ? "✓ Selectat" : "Alege"}
          </button>
        `;

        li.querySelector(".rc-select-btn").addEventListener("click", () => selectPoint(point));

        // Click on item centers map
        li.addEventListener("click", (e) => {
          if (e.target.classList.contains("rc-select-btn")) return;
          if (map && point.lat && point.lng) {
            map.setView([point.lat, point.lng], 16);
            const marker = markers.find((m) => m._rocourierId === point.id);
            if (marker) marker.openPopup();
          }
        });

        pointsList.appendChild(li);
      });
    }

    // ── Leaflet map ───────────────────────────────────────────────────────────
    function initMap() {
      if (mapInitialized || !SHOW_MAP || typeof L === "undefined") return;

      const mapEl = document.getElementById("rocourier-map");
      if (!mapEl) return;

      // Romania center
      map = L.map("rocourier-map", { zoomControl: true }).setView([45.94, 24.97], 7);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      mapInitialized = true;

      // Try geolocation to center on user
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 13),
          () => {} // fail silently
        );
      }

      if (pointsLoaded) renderMarkers(filteredPoints);
    }

    function renderMarkers(points) {
      if (!map) return;

      // Remove existing
      markers.forEach((m) => map.removeLayer(m));
      markers = [];

      const bounds = [];

      points.forEach((point) => {
        if (!point.lat || !point.lng) return;

        const isFan = point.courier === "fan";
        const color = isFan ? "#e65100" : "#1565c0";
        const label = isFan ? "F" : "S";

        const icon = L.divIcon({
          className: "",
          html: `<div style="
            width:32px; height:32px; border-radius:50% 50% 50% 0;
            background:${color}; transform:rotate(-45deg);
            display:flex; align-items:center; justify-content:center;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
            border: 2px solid white;
          ">
            <span style="transform:rotate(45deg); color:#fff; font-weight:700; font-size:13px;">${label}</span>
          </div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 32],
          popupAnchor: [0, -36],
        });

        const isSelected = selectedPoint?.id === point.id;

        const marker = L.marker([point.lat, point.lng], { icon })
          .addTo(map)
          .bindPopup(`
            <div style="min-width:180px; font-family:inherit;">
              <div style="
                display:inline-block; padding:2px 8px; border-radius:12px; font-size:11px;
                font-weight:700; margin-bottom:6px;
                background:${color}22; color:${color}; border:1px solid ${color}44;
              ">
                ${isFan ? "FANbox" : "Sameday easybox"}
              </div>
              <div style="font-weight:600; margin-bottom:4px;">${escHtml(point.name)}</div>
              <div style="font-size:12px; color:#666; margin-bottom:10px;">${escHtml(point.address)}</div>
              <button
                onclick="window.__rcSelectPoint('${point.id}')"
                style="
                  width:100%; padding:7px 0; background:${color}; color:#fff;
                  border:none; border-radius:6px; cursor:pointer; font-weight:600; font-size:13px;
                "
              >
                ${isSelected ? "✓ Selectat" : "Selectează"}
              </button>
            </div>
          `);

        marker._rocourierId = point.id;
        markers.push(marker);
        bounds.push([point.lat, point.lng]);
      });

      if (bounds.length > 0) {
        try { map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 }); } catch (e) {}
      }
    }

    // Global function for popup button
    window.__rcSelectPoint = function (id) {
      const point = allPoints.find((p) => p.id === id);
      if (point) selectPoint(point);
    };

    // ── Select a pickup point ─────────────────────────────────────────────────
    function selectPoint(point) {
      selectedPoint = point;

      // Update hidden inputs
      if (rcMethod)    rcMethod.value    = "pickup_point";
      if (rcCourier)   rcCourier.value   = point.courier;
      if (rcPointId)   rcPointId.value   = point.externalId || point.id;
      if (rcPointName) rcPointName.value = point.name;
      if (rcPointAddr) rcPointAddr.value = point.address;

      // Update displayed info
      if (selectedBadge) {
        selectedBadge.textContent = point.courier === "fan" ? "FANbox" : "Sameday easybox";
        selectedBadge.className   = `rocourier-badge rc-badge-${point.courier}`;
      }
      if (selectedName)    selectedName.textContent   = point.name;
      if (selectedAddress) selectedAddress.textContent = point.address;

      // Show selected display
      if (selectedDisplay) selectedDisplay.style.display = "block";
      if (openMapBtn)      openMapBtn.style.display      = "none";

      // Sync to Shopify cart immediately via AJAX
      syncCartAttributes();

      // Highlight in list
      document.querySelectorAll(".rocourier-point-item").forEach((li) => {
        const isThis = li.dataset.id === point.id;
        li.classList.toggle("is-selected", isThis);
        const btn = li.querySelector(".rc-select-btn");
        if (btn) {
          btn.textContent = isThis ? "✓ Selectat" : "Alege";
          btn.classList.toggle("rc-selected-btn", isThis);
        }
      });

      // Update popup buttons
      markers.forEach((m) => {
        if (m._rocourierId === point.id && m.isPopupOpen()) {
          m.setPopupContent(m.getPopup().getContent().replace("Selectează", "✓ Selectat"));
        }
      });

      closeModal();
    }

    function clearSelectedPoint() {
      selectedPoint = null;
      if (rcCourier)   rcCourier.value   = "";
      if (rcPointId)   rcPointId.value   = "";
      if (rcPointName) rcPointName.value = "";
      if (rcPointAddr) rcPointAddr.value = "";
      if (selectedDisplay) selectedDisplay.style.display = "none";
      if (openMapBtn)      openMapBtn.style.display      = "block";
    }

    // ── Sync to Shopify cart attributes (AJAX) ────────────────────────────────
    // This persists the choice even before checkout button is clicked
    async function syncCartAttributes() {
      try {
        await fetch("/cart/update.js", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            attributes: {
              _rocourier_method:          rcMethod?.value    || "home_delivery",
              _rocourier_courier:         rcCourier?.value   || "",
              _rocourier_point_id:        rcPointId?.value   || "",
              _rocourier_point_name:      rcPointName?.value || "",
              _rocourier_point_address:   rcPointAddr?.value || "",
            },
          }),
        });
      } catch (e) {
        // Non-fatal — form submission will carry the hidden inputs anyway
        console.warn("RoCourier: cart attributes sync failed", e);
      }
    }

    // ── Error display ─────────────────────────────────────────────────────────
    function showError(msg) {
      if (!errorBox) return;
      errorBox.textContent = msg;
      errorBox.style.display = "block";
      setTimeout(() => { errorBox.style.display = "none"; }, 6000);
    }

    // ── HTML escape ────────────────────────────────────────────────────────────
    function escHtml(str) {
      return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    // ── Set individual cart attribute ─────────────────────────────────────────
    function setCartAttribute(key, value) {
      fetch("/cart/update.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attributes: { [key]: value } }),
      }).catch(() => {});
    }

    // ── Restore previous selection from cart (page reload) ────────────────────
    async function restoreFromCart() {
      try {
        const res  = await fetch("/cart.js");
        const cart = await res.json();
        const attrs = cart.attributes || {};

        const method    = attrs["_rocourier_method"];
        const courier   = attrs["_rocourier_courier"];
        const pointId   = attrs["_rocourier_point_id"];
        const pointName = attrs["_rocourier_point_name"];
        const pointAddr = attrs["_rocourier_point_address"];

        if (method === "pickup_point" && pointId) {
          // Switch to pickup radio
          if (pickupRadio) { pickupRadio.checked = true; onMethodChange(); }

          // Restore display
          if (selectedBadge) {
            selectedBadge.textContent = courier === "fan" ? "FANbox" : "Sameday easybox";
            selectedBadge.className   = `rocourier-badge rc-badge-${courier}`;
          }
          if (selectedName)    selectedName.textContent    = pointName || "";
          if (selectedAddress) selectedAddress.textContent = pointAddr || "";
          if (selectedDisplay) selectedDisplay.style.display = "block";
          if (openMapBtn)      openMapBtn.style.display      = "none";

          // Restore hidden inputs
          if (rcMethod)    rcMethod.value    = "pickup_point";
          if (rcCourier)   rcCourier.value   = courier   || "";
          if (rcPointId)   rcPointId.value   = pointId   || "";
          if (rcPointName) rcPointName.value = pointName || "";
          if (rcPointAddr) rcPointAddr.value = pointAddr || "";

          selectedPoint = { id: pointId, courier, name: pointName, address: pointAddr };
        }
      } catch (e) {
        // Silently fail
      }
    }

    // ── Init ──────────────────────────────────────────────────────────────────
    restoreFromCart();
  }

  // Run after DOM + Leaflet loaded
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
