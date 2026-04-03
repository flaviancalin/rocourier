// RoCourier Cart Widget
// Handles 4 delivery options: FAN home, FANbox, Sameday home, Sameday easybox
// Opens a map modal for locker selection; blocks checkout until a method is chosen.

(function () {
  "use strict";

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function $(id) { return document.getElementById(id); }

  // ── Init (wait for DOM) ───────────────────────────────────────────────────────
  function init() {
    const widget = $("rocourier-widget");
    if (!widget) return;

    const SHOP    = widget.dataset.shop || "";
    const APP_URL = (widget.dataset.appUrl || "").replace(/\/$/, "");
    const FAN_ON  = widget.dataset.fanEnabled  !== "false";
    const SAM_ON  = widget.dataset.samedayEnabled !== "false";
    const CURRENCY = widget.dataset.currency || "RON";

    const FEES = {
      fanHome:      parseFloat(widget.dataset.fanHomeFee)      || 0,
      fanPickup:    parseFloat(widget.dataset.fanPickupFee)    || 0,
      samedayHome:  parseFloat(widget.dataset.samedayHomeFee)  || 0,
      samedayPickup:parseFloat(widget.dataset.samedayPickupFee)|| 0,
    };

    function feeLabel(amount) {
      if (!amount || amount === 0) return "Gratuit";
      return amount.toLocaleString("ro-RO", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " " + CURRENCY;
    }

    // Inject fee labels into the method rows
    function applyFeeLabels() {
      const map = {
        "rc-fan-home":     FEES.fanHome,
        "rc-fan-box":      FEES.fanPickup,
        "rc-sameday-home": FEES.samedayHome,
        "rc-sameday-box":  FEES.samedayPickup,
      };
      Object.entries(map).forEach(([id, fee]) => {
        const row = document.querySelector(`label[for="${id}"]`);
        if (!row) return;
        let badge = row.querySelector(".rc-method-fee");
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "rc-method-fee";
          row.appendChild(badge);
        }
        badge.textContent = feeLabel(fee);
      });
    }
    applyFeeLabels();

    // ── Radio buttons ─────────────────────────────────────────────────────────
    const radios = document.querySelectorAll('input[name="rc_delivery"]');

    // ── Hidden cart inputs ────────────────────────────────────────────────────
    const hMethod  = $("rc-h-method");
    const hCourier = $("rc-h-courier");
    const hPointId = $("rc-h-point-id");
    const hPointNm = $("rc-h-point-nm");
    const hPointAd = $("rc-h-point-ad");

    // ── Point display ─────────────────────────────────────────────────────────
    const pointSelected = $("rc-point-selected");
    const pointBadge    = $("rc-point-badge");
    const pointName     = $("rc-point-name");
    const pointAddr     = $("rc-point-addr");
    const changeBtn     = $("rc-change-point");
    const errorBox      = $("rc-error");

    // ── Modal ─────────────────────────────────────────────────────────────────
    const modal       = $("rc-modal");
    const backdrop    = $("rc-modal-backdrop");
    const modalClose  = $("rc-modal-close");
    const searchInput = $("rc-search");
    const pointsList  = $("rc-points-list");
    const listLoading = $("rc-list-loading");
    const listEmpty   = $("rc-list-empty");
    const listCount   = $("rc-list-count");
    const filterBtns  = document.querySelectorAll(".rc-filter-btn");

    // ── State ─────────────────────────────────────────────────────────────────
    let allPoints      = [];
    let filtered       = [];
    let selected       = null;   // { id, externalId, courier, name, address, lat, lng }
    let currentCourier = "all";  // filter: "all" | "fan" | "sameday"
    let mapInst        = null;
    let mapReady       = false;
    let pointsLoaded   = false;
    let openForCourier = null;   // "fan" | "sameday" — which locker type to show

    // ─────────────────────────────────────────────────────────────────────────
    // Radio change handler
    // ─────────────────────────────────────────────────────────────────────────
    function onRadioChange(val) {
      // Clear any previous selection if switching between box types
      const isBox = val === "fan_box" || val === "sameday_box";
      const boxCourier = val === "fan_box" ? "fan" : "sameday";

      if (!isBox) {
        // Home delivery — clear any locker selection
        clearPoint();
        setHidden(val === "fan_home" ? "fan" : "sameday", "home_delivery");
        if (pointSelected) pointSelected.style.display = "none";
        hideError();
      } else {
        // Locker selected — open the map
        openForCourier = boxCourier;

        // Pre-set courier filter
        currentCourier = boxCourier;
        filterBtns.forEach((b) => {
          b.classList.toggle("rc-filter-active",
            b.dataset.courier === boxCourier || (b.dataset.courier === "all" && false));
        });
        // Find the correct filter button
        const targetBtn = [...filterBtns].find(b => b.dataset.courier === boxCourier)
          || [...filterBtns].find(b => b.dataset.courier === "all");
        if (targetBtn) {
          filterBtns.forEach(b => b.classList.remove("rc-filter-active"));
          targetBtn.classList.add("rc-filter-active");
        }

        openModal();
      }
    }

    radios.forEach((r) => {
      r.addEventListener("change", () => {
        if (r.checked) onRadioChange(r.value);
      });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Modal open / close
    // ─────────────────────────────────────────────────────────────────────────
    function openModal() {
      if (!modal) return;
      modal.style.display = "flex";
      document.body.style.overflow = "hidden";

      if (!pointsLoaded) fetchPoints();
      else applyFilters();

      // Try immediately, then retry until Leaflet is available
      tryInitMap();
    }

    function tryInitMap(attempts) {
      attempts = attempts || 0;
      if (typeof L !== "undefined") {
        // Use double rAF so the browser fully lays out the modal before Leaflet measures it
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

      // If user closed without selecting a point, revert radio to none
      if (!selected) {
        radios.forEach((r) => { r.checked = false; });
        clearPoint();
      }
    }

    changeBtn   && changeBtn.addEventListener("click", openModal);
    modalClose  && modalClose.addEventListener("click", closeModal);
    backdrop    && backdrop.addEventListener("click", closeModal);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal?.style.display === "flex") closeModal();
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Fetch pickup points from app API
    // ─────────────────────────────────────────────────────────────────────────
    async function fetchPoints() {
      if (!APP_URL || !SHOP) {
        if (listLoading) listLoading.style.display = "none";
        if (listEmpty)   { listEmpty.style.display = "block"; listEmpty.textContent = "Configurare incompletă."; }
        return;
      }

      if (listLoading) listLoading.style.display = "flex";
      if (listEmpty)   listEmpty.style.display   = "none";
      if (pointsList)  pointsList.innerHTML       = "";
      if (listCount)   listCount.style.display    = "none";

      try {
        const couriers = [FAN_ON && "fan", SAM_ON && "sameday"].filter(Boolean).join(",") || "all";
        const url = `${APP_URL}/api/pickup-points?shop=${encodeURIComponent(SHOP)}&courier=${couriers}`;
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        allPoints    = data.points || [];
        pointsLoaded = true;
        applyFilters();
        if (mapInst) {
          mapInst.invalidateSize();
          renderMarkers(filtered);
        }
      } catch (err) {
        if (listEmpty) { listEmpty.textContent = "Nu s-au putut încărca lockerele. Încearcă din nou."; listEmpty.style.display = "block"; }
        console.error("RoCourier:", err);
      } finally {
        if (listLoading) listLoading.style.display = "none";
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Filters & search
    // ─────────────────────────────────────────────────────────────────────────
    function applyFilters() {
      const q = (searchInput?.value || "").toLowerCase().trim();
      filtered = allPoints.filter((p) => {
        if (currentCourier !== "all" && p.courier !== currentCourier) return false;
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
      if (listCount) {
        listCount.textContent = `${filtered.length} puncte`;
        listCount.style.display = "block";
      }
    }

    searchInput && searchInput.addEventListener("input", applyFilters);

    filterBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        filterBtns.forEach((b) => b.classList.remove("rc-filter-active"));
        btn.classList.add("rc-filter-active");
        currentCourier = btn.dataset.courier;
        applyFilters();
      });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Render list
    // ─────────────────────────────────────────────────────────────────────────
    function renderList(points) {
      if (!pointsList) return;
      pointsList.innerHTML = "";

      points.forEach((p) => {
        const isFan = p.courier === "fan";
        const isSel = selected?.id === p.id;
        const li = document.createElement("li");
        li.className = "rc-item" + (isSel ? " rc-item-selected" : "");
        li.dataset.id = p.id;

        li.innerHTML = `
          <div class="rc-item-top">
            <span class="rc-item-badge ${isFan ? "rc-badge-fan" : "rc-badge-sameday"}">
              ${isFan ? "FANbox" : "easybox"}
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

    // ─────────────────────────────────────────────────────────────────────────
    // Leaflet map
    // ─────────────────────────────────────────────────────────────────────────
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
        const isFan  = p.courier === "fan";
        const color  = isFan ? "#e65100" : "#0277bd";
        const letter = isFan ? "F" : "S";
        const isSel  = selected?.id === p.id;

        const icon = L.divIcon({
          className: "",
          html: `<div style="width:30px;height:30px;border-radius:50% 50% 50% 0;background:${isSel ? "#108043" : color};transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.3);border:2px solid #fff">
            <span style="transform:rotate(45deg);color:#fff;font-weight:700;font-size:12px">${letter}</span>
          </div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 30],
          popupAnchor: [0, -34],
        });

        const marker = L.marker([p.lat, p.lng], { icon })
          .addTo(mapInst)
          .bindPopup(
            `<div style="min-width:170px;font-family:inherit">
              <div style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;margin-bottom:6px;background:${color}22;color:${color};border:1px solid ${color}44">
                ${isFan ? "FANbox" : "Sameday easybox"}
              </div>
              <div style="font-weight:600;margin-bottom:3px">${esc(p.name)}</div>
              <div style="font-size:12px;color:#666;margin-bottom:9px">${esc(p.address)}</div>
              <button onclick="window.__rcPick('${p.id}')" style="width:100%;padding:7px 0;background:${color};color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:13px">
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

    // ─────────────────────────────────────────────────────────────────────────
    // Select a pickup point
    // ─────────────────────────────────────────────────────────────────────────
    function selectPoint(p) {
      selected = p;
      const isFan = p.courier === "fan";

      // Update hidden inputs
      if (hMethod)  hMethod.value  = "pickup_point";
      if (hCourier) hCourier.value = p.courier;
      if (hPointId) hPointId.value = p.externalId || p.id;
      if (hPointNm) hPointNm.value = p.name;
      if (hPointAd) hPointAd.value = p.address;

      // Make sure the right radio is checked
      const radioId = isFan ? "rc-fan-box" : "rc-sameday-box";
      const radio = $(radioId);
      if (radio) radio.checked = true;

      // Show selected display
      if (pointBadge) {
        pointBadge.textContent = isFan ? "FANbox" : "easybox";
        pointBadge.className   = `rc-point-badge ${isFan ? "rc-badge-fan" : "rc-badge-sameday"}`;
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

    function clearPoint() {
      selected = null;
      if (hMethod)  hMethod.value  = "";
      if (hCourier) hCourier.value = "";
      if (hPointId) hPointId.value = "";
      if (hPointNm) hPointNm.value = "";
      if (hPointAd) hPointAd.value = "";
    }

    function setHidden(courier, method) {
      if (hMethod)  hMethod.value  = method;
      if (hCourier) hCourier.value = courier;
      if (hPointId) hPointId.value = "";
      if (hPointNm) hPointNm.value = "";
      if (hPointAd) hPointAd.value = "";
      syncCart();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Sync to Shopify cart attributes via AJAX
    // ─────────────────────────────────────────────────────────────────────────
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

    // ─────────────────────────────────────────────────────────────────────────
    // Checkout intercept — block if no method chosen, or locker chosen but no point
    // ─────────────────────────────────────────────────────────────────────────
    function blockCheckout(e) {
      const chosenRadio = [...radios].find((r) => r.checked);

      if (!chosenRadio) {
        e.preventDefault();
        e.stopPropagation();
        showError("Alege o metodă de livrare înainte de a continua!");
        widget.scrollIntoView({ behavior: "smooth", block: "center" });
        return false;
      }

      const isBox = chosenRadio.value === "fan_box" || chosenRadio.value === "sameday_box";
      if (isBox && !selected) {
        e.preventDefault();
        e.stopPropagation();
        showError("Alege un punct de ridicare de pe hartă!");
        widget.scrollIntoView({ behavior: "smooth", block: "center" });
        openModal();
        return false;
      }

      return true;
    }

    // Intercept all checkout buttons and links
    function attachCheckoutGuard() {
      const intercept = (el) => {
        if (el._rcGuarded) return;
        el._rcGuarded = true;
        el.addEventListener("click", blockCheckout, true);
      };

      // Buttons with name="checkout" or containing "checkout" in href/action
      document.querySelectorAll(
        'button[name="checkout"], input[name="checkout"], a[href="/checkout"], [href*="/checkout"]'
      ).forEach(intercept);

      // Cart forms
      document.querySelectorAll('form[action="/cart"], form[action*="/cart"]').forEach((form) => {
        if (form._rcGuarded) return;
        form._rcGuarded = true;
        form.addEventListener("submit", (e) => {
          if (e.submitter?.name === "checkout" || e.submitter?.value === "checkout") {
            blockCheckout(e);
          }
        }, true);
      });
    }

    attachCheckoutGuard();
    // Re-attach after any DOM mutations (some themes inject buttons dynamically)
    new MutationObserver(attachCheckoutGuard).observe(document.body, { childList: true, subtree: true });

    // ─────────────────────────────────────────────────────────────────────────
    // Error display
    // ─────────────────────────────────────────────────────────────────────────
    function showError(msg) {
      if (!errorBox) return;
      errorBox.textContent = msg;
      errorBox.style.display = "block";
    }
    function hideError() {
      if (errorBox) errorBox.style.display = "none";
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Restore previous selection from Shopify cart (page reload)
    // ─────────────────────────────────────────────────────────────────────────
    async function restore() {
      try {
        const res  = await fetch("/cart.js");
        const cart = await res.json();
        const a    = cart.attributes || {};

        const method  = a["_rc_method"]        || a["_rocourier_method"]  || "";
        const courier = a["_rc_courier"]        || a["_rocourier_courier"] || "";
        const pid     = a["_rc_point_id"]       || a["_rocourier_point_id"] || "";
        const pname   = a["_rc_point_name"]     || a["_rocourier_point_name"] || "";
        const paddr   = a["_rc_point_address"]  || a["_rocourier_point_address"] || "";

        if (method === "home_delivery" && courier) {
          const radioId = courier === "fan" ? "rc-fan-home" : "rc-sameday-home";
          const r = $(radioId);
          if (r) r.checked = true;
          setHidden(courier, "home_delivery");
        } else if (method === "pickup_point" && pid) {
          const radioId = courier === "fan" ? "rc-fan-box" : "rc-sameday-box";
          const r = $(radioId);
          if (r) r.checked = true;

          selected = { id: pid, externalId: pid, courier, name: pname, address: paddr };
          if (hMethod)  hMethod.value  = "pickup_point";
          if (hCourier) hCourier.value = courier;
          if (hPointId) hPointId.value = pid;
          if (hPointNm) hPointNm.value = pname;
          if (hPointAd) hPointAd.value = paddr;

          if (pointBadge) {
            pointBadge.textContent = courier === "fan" ? "FANbox" : "easybox";
            pointBadge.className   = `rc-point-badge ${courier === "fan" ? "rc-badge-fan" : "rc-badge-sameday"}`;
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
