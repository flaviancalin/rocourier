// app/utils/withdrawal.js — right of withdrawal (EU Directive 2023/2673, RO: OUG 18/2026):
// texts for the customer page and the confirmation email, in the languages Picklo supports.

export const WITHDRAWAL_DAYS = 14;
export const WITHDRAWAL_LANGS = ["ro", "en", "de", "hu", "cs"];

const T = {
  ro: {
    title: "Retragere din contract",
    intro: "Poți renunța la comandă în {days} zile de la primirea produselor, fără să dai un motiv.",
    find: "Găsește comanda", orderNo: "Numărul comenzii", contact: "Emailul sau telefonul din comandă", continue: "Continuă",
    pick: "Alege produsele la care renunți", all: "Toată comanda", reasonOpt: "Motivul (opțional)",
    withdraw: "Retrage-te din contract", confirmTitle: "Confirmă retragerea",
    confirmText: "Renunți la următoarele produse din comanda {order}. După confirmare primești pe email dovada cererii.",
    confirm: "Confirmă retragerea", back: "Înapoi",
    doneTitle: "Retragerea a fost înregistrată",
    done: "Cererea ta de retragere pentru comanda {order} a fost înregistrată pe {date}, cu numărul {ref}.",
    emailSent: "Ți-am trimis confirmarea pe email la {email}.",
    emailMissing: "Păstrează această pagină ca dovadă (numărul cererii și data).",
    next: "Magazinul te contactează pentru returnarea produselor. Banii se returnează în cel mult 14 zile de la această cerere.",
    errOrder: "Nu am găsit comanda. Verifică numărul comenzii.", errContact: "Emailul sau telefonul nu corespund comenzii.",
    errCancelled: "Comanda a fost deja anulată.", errExpired: "Termenul de retragere de {days} zile de la livrare a expirat.",
    errOpen: "Există deja o cerere de retur sau retragere deschisă pentru această comandă.",
    errItems: "Alege cel puțin un produs.", errOff: "Retragerea online nu este disponibilă. Contactează magazinul pentru a renunța la comandă.",
    subject: "Confirmare retragere din contract — comanda {order}",
    emailIntro: "Am primit cererea ta de retragere din contract.",
    product: "Produs", qty: "Cantitate", refNo: "Număr cerere", dateLabel: "Data și ora",
    merchantSubject: "Cerere de retragere din contract — comanda {order}",
    merchantIntro: "Clientul {name} s-a retras din contract pentru comanda {order}. Termen de rambursare: {due}.",
    noReason: "Fără motiv (dreptul de retragere)",
  },
  en: {
    title: "Withdraw from contract",
    intro: "You can withdraw from your order within {days} days of receiving the goods, without giving a reason.",
    find: "Find your order", orderNo: "Order number", contact: "Email or phone used for the order", continue: "Continue",
    pick: "Choose the items you're withdrawing from", all: "The whole order", reasonOpt: "Reason (optional)",
    withdraw: "Withdraw from contract", confirmTitle: "Confirm withdrawal",
    confirmText: "You're withdrawing from these items of order {order}. After you confirm, you'll get proof of your request by email.",
    confirm: "Confirm withdrawal", back: "Back",
    doneTitle: "Your withdrawal is recorded",
    done: "Your withdrawal for order {order} was recorded on {date}, reference {ref}.",
    emailSent: "We emailed the confirmation to {email}.",
    emailMissing: "Keep this page as proof (reference and date).",
    next: "The store will contact you about returning the items. You'll be refunded within 14 days of this request.",
    errOrder: "We couldn't find that order. Check the order number.", errContact: "The email or phone doesn't match the order.",
    errCancelled: "The order is already cancelled.", errExpired: "The {days}-day withdrawal period after delivery has ended.",
    errOpen: "There's already an open return or withdrawal for this order.",
    errItems: "Choose at least one item.", errOff: "Online withdrawal isn't available. Contact the store to withdraw from your order.",
    subject: "Withdrawal confirmation — order {order}",
    emailIntro: "We received your withdrawal from the contract.",
    product: "Item", qty: "Quantity", refNo: "Reference", dateLabel: "Date and time",
    merchantSubject: "Withdrawal from contract — order {order}",
    merchantIntro: "{name} withdrew from the contract for order {order}. Refund due by {due}.",
    noReason: "No reason (right of withdrawal)",
  },
  de: {
    title: "Vertrag widerrufen",
    intro: "Du kannst innerhalb von {days} Tagen nach Erhalt der Ware ohne Angabe von Gründen widerrufen.",
    find: "Bestellung finden", orderNo: "Bestellnummer", contact: "E-Mail oder Telefon der Bestellung", continue: "Weiter",
    pick: "Wähle die Artikel, die du widerrufst", all: "Die ganze Bestellung", reasonOpt: "Grund (optional)",
    withdraw: "Vertrag hier widerrufen", confirmTitle: "Widerruf bestätigen",
    confirmText: "Du widerrufst diese Artikel der Bestellung {order}. Nach der Bestätigung erhältst du einen Nachweis per E-Mail.",
    confirm: "Widerruf bestätigen", back: "Zurück",
    doneTitle: "Dein Widerruf ist eingegangen",
    done: "Dein Widerruf für Bestellung {order} wurde am {date} unter der Nummer {ref} erfasst.",
    emailSent: "Wir haben die Bestätigung an {email} gesendet.",
    emailMissing: "Bewahre diese Seite als Nachweis auf (Nummer und Datum).",
    next: "Der Shop meldet sich wegen der Rücksendung. Die Erstattung erfolgt spätestens 14 Tage nach diesem Widerruf.",
    errOrder: "Bestellung nicht gefunden. Prüfe die Bestellnummer.", errContact: "E-Mail oder Telefon passen nicht zur Bestellung.",
    errCancelled: "Die Bestellung ist bereits storniert.", errExpired: "Die Widerrufsfrist von {days} Tagen nach Lieferung ist abgelaufen.",
    errOpen: "Für diese Bestellung gibt es bereits eine offene Rücksendung oder einen Widerruf.",
    errItems: "Wähle mindestens einen Artikel.", errOff: "Der Online-Widerruf ist nicht verfügbar. Kontaktiere den Shop.",
    subject: "Widerrufsbestätigung — Bestellung {order}",
    emailIntro: "Wir haben deinen Widerruf erhalten.",
    product: "Artikel", qty: "Menge", refNo: "Nummer", dateLabel: "Datum und Uhrzeit",
    merchantSubject: "Widerruf — Bestellung {order}",
    merchantIntro: "{name} hat die Bestellung {order} widerrufen. Erstattung fällig bis {due}.",
    noReason: "Ohne Grund (Widerrufsrecht)",
  },
  hu: {
    title: "Elállás a szerződéstől",
    intro: "A termékek kézhezvételétől számított {days} napon belül indoklás nélkül elállhatsz.",
    find: "Rendelés keresése", orderNo: "Rendelésszám", contact: "A rendeléshez megadott e-mail vagy telefon", continue: "Tovább",
    pick: "Válaszd ki a termékeket", all: "A teljes rendelés", reasonOpt: "Indok (nem kötelező)",
    withdraw: "Elállás a szerződéstől", confirmTitle: "Elállás megerősítése",
    confirmText: "Elállsz a(z) {order} rendelés alábbi termékeitől. Megerősítés után e-mailben kapod meg az igazolást.",
    confirm: "Elállás megerősítése", back: "Vissza",
    doneTitle: "Az elállást rögzítettük",
    done: "A(z) {order} rendelésre vonatkozó elállásodat {date} rögzítettük, azonosító: {ref}.",
    emailSent: "Az igazolást elküldtük ide: {email}.",
    emailMissing: "Őrizd meg ezt az oldalt igazolásként (azonosító és dátum).",
    next: "Az áruház felveszi veled a kapcsolatot a visszaküldés miatt. A visszatérítés legkésőbb 14 napon belül megtörténik.",
    errOrder: "Nem találjuk a rendelést. Ellenőrizd a rendelésszámot.", errContact: "Az e-mail vagy telefon nem egyezik a rendeléssel.",
    errCancelled: "A rendelést már törölték.", errExpired: "A kézbesítés utáni {days} napos elállási határidő lejárt.",
    errOpen: "Ehhez a rendeléshez már van nyitott visszaküldés vagy elállás.",
    errItems: "Válassz legalább egy terméket.", errOff: "Az online elállás nem érhető el. Vedd fel a kapcsolatot az áruházzal.",
    subject: "Elállás visszaigazolása — {order} rendelés",
    emailIntro: "Megkaptuk az elállási nyilatkozatodat.",
    product: "Termék", qty: "Mennyiség", refNo: "Azonosító", dateLabel: "Dátum és idő",
    merchantSubject: "Elállás — {order} rendelés",
    merchantIntro: "{name} elállt a(z) {order} rendeléstől. Visszatérítési határidő: {due}.",
    noReason: "Indoklás nélkül (elállási jog)",
  },
  cs: {
    title: "Odstoupení od smlouvy",
    intro: "Od objednávky můžeš odstoupit do {days} dnů od převzetí zboží bez udání důvodu.",
    find: "Najít objednávku", orderNo: "Číslo objednávky", contact: "E-mail nebo telefon z objednávky", continue: "Pokračovat",
    pick: "Vyber položky, od kterých odstupuješ", all: "Celá objednávka", reasonOpt: "Důvod (nepovinné)",
    withdraw: "Odstoupit od smlouvy", confirmTitle: "Potvrdit odstoupení",
    confirmText: "Odstupuješ od těchto položek objednávky {order}. Po potvrzení dostaneš doklad e-mailem.",
    confirm: "Potvrdit odstoupení", back: "Zpět",
    doneTitle: "Odstoupení je zaznamenáno",
    done: "Tvé odstoupení od objednávky {order} bylo zaznamenáno {date} pod číslem {ref}.",
    emailSent: "Potvrzení jsme poslali na {email}.",
    emailMissing: "Uschovej tuto stránku jako doklad (číslo a datum).",
    next: "Obchod tě kontaktuje kvůli vrácení zboží. Peníze vrátíme nejpozději do 14 dnů od tohoto odstoupení.",
    errOrder: "Objednávku jsme nenašli. Zkontroluj číslo objednávky.", errContact: "E-mail nebo telefon neodpovídá objednávce.",
    errCancelled: "Objednávka už je zrušená.", errExpired: "Lhůta {days} dnů od doručení uplynula.",
    errOpen: "K této objednávce už existuje otevřené vrácení nebo odstoupení.",
    errItems: "Vyber alespoň jednu položku.", errOff: "Online odstoupení není k dispozici. Kontaktuj obchod.",
    subject: "Potvrzení odstoupení — objednávka {order}",
    emailIntro: "Obdrželi jsme tvé odstoupení od smlouvy.",
    product: "Položka", qty: "Množství", refNo: "Číslo", dateLabel: "Datum a čas",
    merchantSubject: "Odstoupení od smlouvy — objednávka {order}",
    merchantIntro: "{name} odstoupil(a) od objednávky {order}. Vrácení peněz do {due}.",
    noReason: "Bez důvodu (právo na odstoupení)",
  },
};

export function wt(lang, key, vars = {}) {
  const dict = T[lang] || T.ro;
  return String(dict[key] ?? T.ro[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}

export const pickLang = (value) => {
  const l = String(value || "").slice(0, 2).toLowerCase();
  return WITHDRAWAL_LANGS.includes(l) ? l : "ro";
};

// Short reference the customer can quote: RTG-XXXXXX
export const withdrawalRef = (id) => `RTG-${String(id || "").slice(-6).toUpperCase()}`;

// Last day the withdrawal can be made: 14 days (or the store's longer return window)
// from delivery; before delivery there's no deadline yet.
export function withdrawalDeadline(order, windowDays = WITHDRAWAL_DAYS) {
  const days = Math.max(WITHDRAWAL_DAYS, Number(windowDays) || 0);
  if (!order?.deliveredAt) return null;
  return new Date(new Date(order.deliveredAt).getTime() + days * 864e5);
}
