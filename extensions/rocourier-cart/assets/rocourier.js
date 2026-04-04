// RoCourier Cart Widget — Unified: Home Delivery + Pickup Point
(function () {
  "use strict";

  // ── Courier config ────────────────────────────────────────────────────────────
  const COURIERS = {
    fan:     { label: "FAN Courier", pickupLabel: "FANbox",           color: "#e65100", letter: "F", badgeClass: "rc-badge-fan"     },
    sameday: { label: "Sameday",     pickupLabel: "Sameday easybox",  color: "#0277bd", letter: "S", badgeClass: "rc-badge-sameday" },
    cargus:  { label: "Cargus",      pickupLabel: "Cargus Ship & Go", color: "#c62828", letter: "C", badgeClass: "rc-badge-cargus"  },
    gls:     { label: "GLS",         pickupLabel: "GLS ParcelShop",   color: "#f9a825", letter: "G", badgeClass: "rc-badge-gls"     },
    packeta: { label: "Packeta",     pickupLabel: "Packeta / Z-BOX",  color: "#ba000d", letter: "P", badgeClass: "rc-badge-packeta" },
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

    // Which couriers are enabled
    const ENABLED = {};
    Object.keys(COURIERS).forEach((c) => {
      ENABLED[c] = widget.dataset[c + "Enabled"] !== "false";
    });

    // Fee table: { fan: { home: 0, pickup: 0 }, ... }
    const FEES = {};
    Object.keys(COURIERS).forEach((c) => {
      FEES[c] = {
        home:   parseFloat(widget.dataset[c + "HomeFee"])   || 0,
        pickup: parseFloat(widget.dataset[c + "PickupFee"]) || 0,
      };
    });

    function feeLabel(amount) {
      if (!amount) return "Gratuit";
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
        : "Niciun curier activat";
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
    const courierPicker  = $("rc-courier-picker");
    const chipBtns       = courierPicker
                           ? courierPicker.querySelectorAll(".rc-chip") : [];
    const homeFeeEl      = $("rc-home-fee");
    const pickupFeeEl    = $("rc-pickup-fee");
    const pointSelected  = $("rc-point-selected");
    const pointBadge     = $("rc-point-badge");
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
    let allPoints          = [];
    let filtered           = [];
    let selectedPoint      = null;   // chosen pickup point object
    let selectedHomeCourier = null;  // chosen courier for home delivery
    let currentFilter      = "all";
    let mapInst            = null;
    let mapReady           = false;
    let pointsLoaded       = false;

    // ── Radio change: Home ──────────────────────────────────────────────────────
    function onHomeSelected() {
      // Show courier picker
      if (courierPicker) courierPicker.style.display = "flex";
      // Hide pickup point summary
      if (pointSelected) pointSelected.style.display = "none";
      // Clear pickup-fee display
      if (pickupFeeEl) pickupFeeEl.textContent = "";
      hideError();

      // Auto-select first enabled courier if nothing chosen yet
      if (!selectedHomeCourier) {
        const firstChip = [...chipBtns][0];
        if (firstChip) selectHomeCourier(firstChip.dataset.courier);
      } else {
        // Re-sync hidden fields
        setHiddenHome(selectedHomeCourier);
      }
    }

    // ── Radio change: Pickup ────────────────────────────────────────────────────
    function onPickupSelected() {
      // Hide courier picker
      if (courierPicker) courierPicker.style.display = "none";
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

    // ── Courier chip selection ─────────────────────────────────────────────────
    function selectHomeCourier(courier) {
      selectedHomeCourier = courier;

      // Update chip active state
      chipBtns.forEach((btn) => {
        const isActive = btn.dataset.courier === courier;
        btn.classList.toggle("rc-chip-active", isActive);
        if (isActive) {
          const color = COURIERS[courier]?.color || "#222";
          btn.style.borderColor  = color;
          btn.style.color        = color;
          btn.style.background   = color + "12";
        } else {
          btn.style.borderColor  = "";
          btn.style.color        = "";
          btn.style.background   = "";
        }
      });

      // Update fee
      if (homeFeeEl) homeFeeEl.textContent = feeLabel(FEES[courier]?.home || 0);

      setHiddenHome(courier);
    }

    chipBtns.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        selectHomeCourier(btn.dataset.courier);
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
        if (courierPicker) courierPicker.style.display = "none";
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
      if (!APP_URL || !SHOP) {
        if (listLoading) listLoading.style.display = "none";
        if (listEmpty) { listEmpty.style.display = "block"; listEmpty.textContent = "Configurare incompletă."; }
        return;
      }

      if (listLoading) listLoading.style.display = "flex";
      if (listEmpty)   listEmpty.style.display   = "none";
      if (pointsList)  pointsList.innerHTML       = "";
      if (listCount)   listCount.style.display    = "none";

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
        if (listEmpty) { listEmpty.textContent = "Nu s-au putut încărca lockerele. Încearcă din nou."; listEmpty.style.display = "block"; }
        console.error("RoCourier:", err);
      } finally {
        if (listLoading) listLoading.style.display = "none";
      }
    }

    // ── Filters ────────────────────────────────────────────────────────────────
    function applyFilters() {
      const q = (searchInput?.value || "").toLowerCase().trim();
      filtered = allPoints.filter((p) => {
        if (currentFilter !== "all" && p.courier !== currentFilter) return false;
        if (!q) return true;
        return (
          (p.name    || "").toLowerCase().includes(q) ||
          (p.address || "").toLowerCase().includes(q) ||
          (p.city    || "").toLowerCase().includes(q) ||
          (p.county  || "").toLowerCase().includes(q)
        );
      });
      renderList(filtered);
      if (mapInst) renderMarkers(filtered);
      if (listEmpty) listEmpty.style.display = filtered.length === 0 ? "block" : "none";
      if (listCount) { listCount.textContent = `${filtered.length} puncte`; listCount.style.display = "block"; }
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

        li.innerHTML = `
          <div class="rc-item-top">
            <span class="rc-item-badge ${cfg.badgeClass}" style="background:${cfg.color}22;color:${cfg.color};border:1px solid ${cfg.color}44">
              ${esc(cfg.pickupLabel)}
            </span>
          </div>
          <strong class="rc-item-name">${esc(p.name)}</strong>
          <span class="rc-item-addr">${esc(p.address)}</span>
          <button type="button" class="rc-item-btn ${isSel ? "rc-item-btn-sel" : ""}">
            ${isSel ? "✓ Selectat" : "Alege"}
          </button>
        `;

        li.querySelector(".rc-item-btn").addEventListener("click", (e) => {
          e.stopPropagation();
          selectPoint(p);
        });

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

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => mapInst.setView([pos.coords.latitude, pos.coords.longitude], 13),
          () => {}
        );
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
        const cfg   = COURIERS[p.courier] || { color: "#888", letter: "?", pickupLabel: p.courier };
        const isSel = selectedPoint?.id === p.id;
        const color = isSel ? "#108043" : cfg.color;

        const icon = L.divIcon({
          className: "",
          html: `<div style="width:30px;height:30px;border-radius:50% 50% 50% 0;background:${color};transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.3);border:2px solid #fff">
            <span style="transform:rotate(45deg);color:#fff;font-weight:700;font-size:12px">${cfg.letter}</span>
          </div>`,
          iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -34],
        });

        const marker = L.marker([p.lat, p.lng], { icon })
          .addTo(mapInst)
          .bindPopup(
            `<div style="min-width:170px;font-family:inherit">
              <div style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;margin-bottom:6px;background:${cfg.color}22;color:${cfg.color};border:1px solid ${cfg.color}44">
                ${esc(cfg.pickupLabel)}
              </div>
              <div style="font-weight:600;margin-bottom:3px">${esc(p.name)}</div>
              <div style="font-size:12px;color:#666;margin-bottom:9px">${esc(p.address)}</div>
              <button onclick="window.__rcPick('${p.id}')" style="width:100%;padding:7px 0;background:${cfg.color};color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:13px">
                ${isSel ? "✓ Selectat" : "Selectează"}
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

      // Show selected summary bar
      if (pointBadge) {
        pointBadge.textContent      = cfg.pickupLabel;
        pointBadge.className        = `rc-point-badge ${cfg.badgeClass}`;
        pointBadge.style.background = `${cfg.color}22`;
        pointBadge.style.color      = cfg.color;
        pointBadge.style.border     = `1px solid ${cfg.color}44`;
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
        showError("Alege o metodă de livrare înainte de a continua!");
        widget.scrollIntoView({ behavior: "smooth", block: "center" });
        return false;
      }

      if (checkedRadio.value === "home" && !selectedHomeCourier) {
        e.preventDefault(); e.stopPropagation();
        showError("Alege un curier pentru livrare la domiciliu!");
        widget.scrollIntoView({ behavior: "smooth", block: "center" });
        return false;
      }

      if (checkedRadio.value === "pickup" && !selectedPoint) {
        e.preventDefault(); e.stopPropagation();
        showError("Alege un punct de ridicare de pe hartă!");
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
          if (courierPicker) courierPicker.style.display = "flex";
          selectHomeCourier(courier);
        } else if (method === "pickup_point" && pid) {
          if (pickupRadio) pickupRadio.checked = true;

          selectedPoint = { id: pid, externalId: pid, courier, name: pname, address: paddr };

          if (hMethod)  hMethod.value  = "pickup_point";
          if (hCourier) hCourier.value = courier;
          if (hPointId) hPointId.value = pid;
          if (hPointNm) hPointNm.value = pname;
          if (hPointAd) hPointAd.value = paddr;

          updatePickupFee(courier);

          const cfg = COURIERS[courier] || { pickupLabel: courier, badgeClass: "", color: "#888" };
          if (pointBadge) {
            pointBadge.textContent      = cfg.pickupLabel;
            pointBadge.className        = `rc-point-badge ${cfg.badgeClass}`;
            pointBadge.style.background = `${cfg.color}22`;
            pointBadge.style.color      = cfg.color;
            pointBadge.style.border     = `1px solid ${cfg.color}44`;
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
