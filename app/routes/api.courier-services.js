// app/routes/api.courier-services.js
// Returns available service types per enabled courier, fetched live from each API.
// Used by the AWB wizard to populate the service dropdown dynamically.

import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { fanGetServices } from "../services/fan-courier.server.js";
import { samedayGetServices } from "../services/sameday.server.js";
import { cargusGetServices } from "../services/cargus.server.js";

// GLS: service type is "Business Parcel" (no type param in MyGLS API).
// Additional options (SAT, FDS, etc.) are service codes sent via ServiceList, handled separately as checkboxes.
const GLS_SERVICES = [
  { label: "Business Parcel (Standard)", value: "standard" },
];

// Packeta: service is determined purely by delivery method (address vs pickup point)
const PACKETA_SERVICES = [
  { label: "Standard",   value: "standard" },
];

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const { shop } = session;

  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings) return json({});

  const result = {};

  // FAN Courier
  if (settings.fanEnabled && settings.fanClientId && settings.fanUsername && settings.fanPassword) {
    try {
      const services = await fanGetServices({
        clientId: settings.fanClientId,
        username: settings.fanUsername,
        password: settings.fanPassword,
      });
      result.fan = services.map((s) => ({
        label: s.name || s.Name || s.serviceName || String(s),
        value: s.name || s.Name || s.serviceName || String(s),
      }));
    } catch (_) {
      // Fallback if API unreachable
      result.fan = [
        { label: "Standard",                value: "Standard"       },
        { label: "Cont Colector (FANbox)",  value: "Cont Colector"  },
        { label: "RedCode",                 value: "RedCode"        },
        { label: "Produse Albe",            value: "Produse Albe"   },
        { label: "Transport Marfă",         value: "Transport Marfa"},
      ];
    }
  }

  // Sameday
  if (settings.samedayEnabled && settings.samedayUsername && settings.samedayPassword) {
    try {
      const services = await samedayGetServices({
        username: settings.samedayUsername,
        password: settings.samedayPassword,
        sandbox: !!settings.samedaySandbox,
      });
      result.sameday = services.map((s) => ({
        label: s.name || s.Name || s.code,
        value: s.code || s.Code,
      }));
    } catch (_) {
      result.sameday = [
        { label: "Standard",            value: "T"  },
        { label: "Locker (NextDay)",    value: "LN" },
        { label: "Express",             value: "E"  },
      ];
    }
  }

  // Cargus
  if (settings.cargusEnabled && settings.cargusSubscriptionKey && settings.cargusUsername && settings.cargusPassword) {
    try {
      const services = await cargusGetServices({
        subscriptionKey: settings.cargusSubscriptionKey,
        username: settings.cargusUsername,
        password: settings.cargusPassword,
      });
      result.cargus = services.map((s) => ({
        label: s.Name || s.name || String(s.Id || s.id),
        value: String(s.Id || s.id),
      }));
    } catch (_) {
      // Fallback list based on Cargus API docs (ServiceId values from documentation)
      result.cargus = [
        { label: "Standard",                          value: "10" },
        { label: "Economic Standard (< 31 kg)",       value: "34" },
        { label: "Standard Plus (31–50 kg)",          value: "35" },
        { label: "Pudo point / Easy Collect",         value: "38" },
        { label: "Standard Multipiece",              value: "39" },
      ];
    }
  }

  if (settings.glsEnabled)     result.gls     = GLS_SERVICES;
  if (settings.packetaEnabled) result.packeta  = PACKETA_SERVICES;

  return json(result);
}
