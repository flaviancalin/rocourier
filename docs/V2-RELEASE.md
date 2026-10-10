# Picklo v2 — ce s-a adăugat și cum se lansează

Branch: `feature/v2-competitive` (nedeployat; `main` rămâne versiunea din review).

## Funcții noi

| Zonă | Ce face | Unde |
|---|---|---|
| **DPD** | AWB acasă și la DPDbox / oficiu, etichete A6/A4, tracking, anulare, comandă ridicare, tarife, retururi, decontare ramburs prin API | `app/services/dpd.server.js`, Setări → DPD |
| **FGO** | API REST v2 (chei `fgo_api_v1…`, Bearer) cu fallback v1: emitere idempotentă, storno, anulare, încasare, AWB pe factură, link PDF, mediu de test. Testat live pe testuat.fgo.ro | `app/services/fgo.server.js`, Setări → Facturare |
| **B2B** | Firmă + CUI din comandă → factură pe firmă, cu datele oficiale de la ANAF (denumire, Reg. Com., adresă, plătitor TVA) | `app/services/anaf.server.js` |
| **Tracking unificat** | Toți cei 6 curieri se actualizează automat la oră (înainte doar FAN și Sameday) | `app/services/tracking.server.js` |
| **Verificări comenzi** | Telefon, cod poștal, adresă fără număr, locker lipsă, refuzuri anterioare; AWB automat se oprește pe probleme blocante | `app/services/order-checks.server.js` |
| **Reguli curier** | Județ / localitate / greutate / valoare / ramburs / locker → curier | Setări → Livrare & verificări |
| **Livrare gratuită** | Bară de progres în coș + tarif 0 în checkout (CCS și tarife manuale cu condiții de valoare) | widget + `checkout-rates`, `checkout-setup` |
| **Data estimată** | Ora limită, zile de pregătire, weekenduri, sărbători legale RO (inclusiv Paști ortodox) — în coș, checkout și pe pagina de produs | `app/utils/delivery-estimate.js`, bloc temă „Picklo — data livrării” |
| **Retururi** | Formular public `/apps/rocourier/returns`, aprobare, AWB retur (FAN, GLS, Cargus, DPD), etichetă, primit / rambursat | `app.returns.jsx`, `returns.server.js` |
| **Pagină tracking** | `/apps/rocourier/track` în tema magazinului | `storefront-pages.server.js` |
| **Ramburs** | Import borderou CSV (orice curier) + DPD automat; sume la curieri, întârzieri, factura marcată încasată | `app.cod.jsx`, `cod.server.js` |
| **Protecție refuz** | După N refuzuri, plata ramburs dispare din checkout pentru acel client (Shopify Function, listă cu hash-uri) | `extensions/picklo-cod-guard`, `cod-guard.server.js` |
| **Comparator tarife** | Prețul de contract la FAN / Sameday / DPD pentru o comandă | fișa comenzii |
| **De expediat azi** | AWB în bulk cu reguli, etichete, packing slips, marcare expediat, chemare curier DPD | `app.ship-today.jsx` |
| **Rapoarte** | Rată livrare / refuz, zile până la livrare, cost transport, lockere populare, jurnal activitate | `app.reports.jsx` |
| **Shopify Flow** | Triggere: AWB creat, status schimbat, colet refuzat, retur cerut. Acțiune: Generează AWB | `extensions/picklo-flow-*`, `routes/flow.generate-awb.js` |
| **Migrare** | Ghid în pagina de configurare pentru clienții xConnector / Ro‑Connect | `app.setup.jsx` |

## Dashboard echipă (HQ)

Adresa: `https://<app-url>/hq` (separat de Shopify, cu conturi pentru echipă).

- **Tichete**: merchantul scrie din Picklo → Ajutor; echipa răspunde în HQ (răspuns vizibil sau notă internă), cu status, prioritate și asignare. Merchantul vede răspunsul în aplicație, cu „Ajutor (1)” în meniu.
- **Magazine**: listă cu stare, plan, curieri, checkout, comenzi și tichete. Pe fiecare magazin: statusuri AWB, configurare, verificarea widgetului din temă cu link de instalare pentru client, acțiuni de suport (refă checkout-ul, tarife, sincronizare comenzi, tracking, lockere, listă fără ramburs, lifetime/trial), editare setări (fără credențiale), comenzi recente și istoric.
- **Acces**: doar cu acordul merchantului („Acces pentru echipa Picklo” din Ajutor, pornit implicit, menționat în politica de confidențialitate). Orice acțiune apare în istoricul magazinului cu numele colegului.
- **Echipă**: roluri Administrator / Suport, parole scrypt de minim 12 caractere, blocare 15 minute după 5 încercări greșite, sesiune de 12 ore.
- **Limite Shopify**: aplicația nu poate scrie în temă (`write_themes` cere excepție) — widgetul se instalează prin linkul de editor sau cu acces colaborator (Partner Dashboard → Stores → Request access).

Variabile noi pe Railway:
- `HQ_SESSION_SECRET` — un șir aleator lung.
- `HQ_ADMIN_EMAIL` + `HQ_ADMIN_PASSWORD` — primul cont de administrator, creat la prima autentificare (apoi poți șterge parola din variabile; colegii se adaugă din HQ → Echipă).

## Bug-uri reparate pe drum

- Comenzile plătite cu cardul primeau ramburs = totalul comenzii (risc de dublă încasare la AWB automat). Acum rambursul = suma rămasă de plată.
- Printul în bulk eșua mereu pentru FAN („no PDF data”).
- Tracking-ul automat ignora Cargus, GLS și Packeta; Sameday folosea coduri de status contradictorii în două locuri.
- Evenimentele de tracking se dublau la fiecare sincronizare (id diferit la căutare și la creare).
- Pagina de setări trimitea în browser parolele curierilor și token-urile de facturare.
- TVA implicit 19% în interfață (corect: 21% din august 2025).

## Teste

```bash
npm test
```

35 de teste: payload-uri DPD/FGO verificate pe documentația oficială (fetch mock), hash FGO pe exemplul din documentație, verificări comenzi, reguli, tracking, ramburs, protecție refuz, rapoarte. Funcția de plată: `cd extensions/picklo-cod-guard && npx vitest run`.

Testat live: FAN (cont de test public) — tarif și AWB de retur creat + șters; ANAF — date firmă reale.

## Ce mai trebuie pentru lansare

1. **Cont de test DPD** — email la api.registration@dpd.ro cu nume, firmă și telefon direct. (FGO e gata: testat live pe testuat.fgo.ro, cheia de test e în `.env.fgo-test`, ignorat de git.)
   - Fiecare merchant FGO trebuie să adauge domeniul `.myshopify.com` al magazinului în FGO → Setări → eCommerce → Setări API → Domenii autorizate (header-ul `Fgo-Url-Platforma`).
2. **Deploy după aprobarea din review** (nu înainte — reviewer-ul testează `main`):
   - `npx prisma migrate deploy` rulează automat la pornire pe Railway (migrarea `20261010000000_v2_dpd_fgo_returns`).
   - `shopify app deploy` — publică extensiile noi (Flow, `picklo-cod-guard`, blocul „data livrării”) și scope-urile noi `read/write_payment_customizations`. Merchanții existenți vor aproba din nou permisiunile.
   - Opțional pe Railway: `DPD_SYNC_USERNAME` / `DPD_SYNC_PASSWORD` pentru sincronizarea punctelor DPD.
3. **Neimplementat** (are nevoie de furnizori/conturi externe): confirmare comandă ramburs prin SMS/WhatsApp; retur automat pentru Sameday și Packeta (API-uri de retur dedicate, fără cont de test); auto-print PrintNode.
