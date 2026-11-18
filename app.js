// Tubigan Tracker — static portfolio demo.
// app.js plays both roles the Flask app splits in two: it is the "server"
// (data store, money math, role checks, settlement) AND the browser layer
// (views, pre-fill chain, menus). Every rule mirrors the real app:
//   - recorded total = cash actually collected; concessions are explicit
//   - settlement derives the discrepancy on screen, never stores or forces it
//   - price edits never rewrite history (stops snapshot the price)
//   - roles are checked per view (the real app enforces them server-side)
// Data lives in localStorage; "Reset demo data" reseeds from data.js.

"use strict";

/* ---------------------------------------------------- format helpers */

const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

// Jinja-side ₱ (no thousands separator) — used in tables/cards.
const f2 = (n) => Number(n).toFixed(2);
// app.js-side ₱ (en-PH grouping) — used in the POS tally, like the real app.
const peso = (n) =>
  "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Jinja `gal` filter: whole numbers plain, halves as 2.5, none → —.
function gal(n) {
  if (n === null || n === undefined) return "—";
  const v = Math.round(n * 2) / 2;
  return v % 1 === 0 ? String(v) : String(v);
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function parseMoney(raw) {
  const s = String(raw ?? "").trim();
  if (s === "") return null;
  const v = Number(s);
  return Number.isFinite(v) ? round2(v) : NaN;
}

// Form field access via form.elements.namedItem — works identically in
// every browser and DOM implementation.
const fieldVal = (form, name) => {
  const el = form.elements.namedItem(name);
  return el ? el.value : "";
};
const fieldTrim = (form, name) => fieldVal(form, name).trim();

function phtNow() {
  const d = new Date();
  const date = d.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  const time = d.toLocaleTimeString("en-GB", { timeZone: "Asia/Manila", hour12: false });
  return date + "T" + time.slice(0, 5);
}

/* ------------------------------------------------------------ icons
   Same inline feather-style SVGs as the real templates/icons.html. */

const ICONS = {
  dots: '<svg class="ico ico-dots" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  edit: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>',
  pricing: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.83z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
  deactivate: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
  activate: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  delete: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
  key: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>',
  bell: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
};

/* ------------------------------------------------------------- tabs */

const TABS = [
  ["dashboard", "Dashboard"], ["trips", "Delivery"], ["sales", "Sales"],
  ["customers", "Customers"], ["prices", "Prices"], ["inventory", "Inventory"],
  ["reports", "Reports"], ["users", "Users"],
];
const ROLE_TABS = {
  owner: ["dashboard", "trips", "sales", "customers", "prices", "inventory", "reports", "users"],
  dispatcher: ["trips", "sales", "customers"],
  driver: ["trips"],
};

/* ------------------------------------------------------ data store */

const DB_KEY = "tubigan-demo-db";
const SESSION_KEY = "tubigan-demo-session";

let db = null;

function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.seed_version === DEMO_SEED_VERSION) return parsed;
    }
  } catch (e) { /* corrupted store → reseed */ }
  const fresh = buildSeed();
  localStorage.setItem(DB_KEY, JSON.stringify(fresh));
  return fresh;
}

function saveDB() {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

db = loadDB();

/* --------------------------------------------------------- session */

let session = (() => {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) { return null; }
})();

function currentUser() {
  // Per-render re-read (the real auth gate does this per request):
  // disabling a user kills their session on their very next view.
  if (!session) return null;
  if (session.expires_at && session.expires_at < new Date().toISOString()) {
    session = null; localStorage.removeItem(SESSION_KEY); return null;
  }
  const u = db.users.find((x) => x.id === session.user_id);
  if (!u || !u.active) { session = null; localStorage.removeItem(SESSION_KEY); return null; }
  return u;
}

function signIn(user) {
  const expires = new Date(Date.now() + 30 * 86400000).toISOString();
  session = { user_id: user.id, expires_at: expires };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function signOut() {
  session = null;
  localStorage.removeItem(SESSION_KEY);
}

/* ----------------------------------------------------------- flash */

let flashMsg = null; // { cat, msg } — shown once on the next render
function flash(msg, cat = "") { flashMsg = { cat, msg }; }

function greeting() {
  const u = currentUser();
  const hour = Number(new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Manila", hour12: false }).slice(0, 2));
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const tagline = u.role === "owner"
    ? "Here's how the station looks today."
    : u.role === "dispatcher"
      ? "Ready to roll out today's trips!"
      : "Let's get those gallons moving — safe trip!";
  return `${part} (PHT), ${u.username}! ${tagline}`;
}

/* ----------------------------------------------------- data lookups */

const userById = (id) => db.users.find((u) => u.id === id) || null;
const driverById = (id) => db.drivers.find((d) => d.id === id) || null;
const driverOfUser = (user) => db.drivers.find((d) => d.user_id === user.id) || null;
const customerById = (id) => db.customers.find((c) => c.id === id) || null;
const customerLabel = (id) => (id === null || id === undefined ? "Walk-in" : (customerById(id)?.name || "?"));
const driverLabel = (id) => driverById(id)?.name || "?";
const recordedByLabel = (id) => (id ? (userById(id)?.username || "?") : null);

function tripStops(tripId) {
  return db.stops.filter((s) => s.trip_id === tripId)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id - b.id));
}

function tripTotals(trip) {
  const list = tripStops(trip.id);
  return {
    stops: list.length,
    gallons: list.reduce((a, s) => a + (s.qty || 0), 0),
    cash: round2(list.reduce((a, s) => a + s.cash_collected, 0)),
    discrepancy: trip.cash_remitted === null || trip.cash_remitted === undefined
      ? null : round2(trip.cash_remitted - list.reduce((a, s) => a + s.cash_collected, 0)),
  };
}

function firstActivePrice() {
  const p = db.prices.filter((p) => p.active).sort((a, b) => a.id - b.id)[0];
  return p ? p.unit_price : null;
}

function prefillPrice(customer) {
  if (customer && customer.custom_price !== null && customer.custom_price !== undefined) {
    return customer.custom_price;
  }
  return firstActivePrice();
}

// Drivers' unseen "delivery request" (drives the 🔔 bell + banner).
function driverNotice(user) {
  const profile = driverOfUser(user);
  if (!profile) return null;
  const today = phtToday();
  const t = db.trips.find((t) => t.driver_id === profile.id && t.trip_date === today &&
    t.status === "open" && t.opened_by !== null && t.opened_by !== undefined &&
    !t.seen_by_driver_at);
  if (!t) return null;
  return { trip: t, stops: tripStops(t.id).length, opened_by_name: recordedByLabel(t.opened_by) || "?" };
}

/* --------------------------------------------------------- router */

function parseRoute() {
  const h = location.hash.slice(1) || "/";
  const [pathPart, queryPart] = h.split("?");
  return {
    parts: pathPart.split("/").filter(Boolean),
    query: new URLSearchParams(queryPart || ""),
  };
}

function nav(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

const homeHash = (user) => (user.role === "owner" ? "#/" : "#/trips");

/* --------------------------------------------------- shell + login */

const root = document.getElementById("root");

const BUBBLES_HTML = `<div class="bubbles" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></div>`;
const WAVES_HTML = `<div class="waves" aria-hidden="true"><svg viewBox="0 0 1200 30" preserveAspectRatio="none"><path d="M0 15 Q 75 30 150 15 T 300 15 T 450 15 T 600 15 T 750 15 T 900 15 T 1050 15 T 1200 15 L 1200 30 L 0 30 Z"/></svg><svg class="wave2" viewBox="0 0 1200 30" preserveAspectRatio="none"><path d="M0 15 Q 75 30 150 15 T 300 15 T 450 15 T 600 15 T 750 15 T 900 15 T 1050 15 T 1200 15 L 1200 30 L 0 30 Z"/></svg></div>`;

const FLASH_HTML = () => {
  if (!flashMsg) return "";
  const greet = flashMsg.cat === "greet";
  const cls = flashMsg.cat === "error" ? "flash flash-error" : `flash ${greet ? "flash-greet" : ""}`;
  const html = `${greet ? '<img class="greet-mascot" src="assets/mascot.svg" alt="">' : ""}<span>${esc(flashMsg.msg)}</span>`;
  flashMsg = null;
  return `<div class="${cls.trim()}">${html}</div>`;
};

function tabsNav(user, activeTab) {
  const notice = user.role === "driver" ? driverNotice(user) : null;
  return `<nav class="tabs">${ROLE_TABS[user.role].map((tabId) => {
    const label = TABS.find(([id]) => id === tabId)[1];
    const href = tabId === "dashboard" ? "#/" : "#/" + tabId;
    const bell = tabId === "trips" && notice
      ? ` <span class="nav-bell" title="New delivery request from ${esc(notice.opened_by_name)}">${ICONS.bell}${notice.stops || ""}</span>`
      : "";
    return `<a href="${href}" class="tab ${activeTab === tabId ? "active" : ""}">${label}${bell}</a>`;
  }).join("")}</nav>`;
}

function shell(user, activeTab, content) {
  document.title = (activeTab ? activeTab[0].toUpperCase() + activeTab.slice(1) + " — " : "") + APP_NAME;
  root.innerHTML = `
  <header class="topbar">
    <div class="brand-row">
      <h1><img class="brand-icon" src="assets/logo.png" alt=""> ${APP_NAME}</h1>
      <div class="userbox">
        <span class="who">${esc(user.username)}</span>
        <span class="role-badge role-${user.role}">${user.role}</span>
        <a href="#/login" class="signout" data-action="logout">Sign out</a>
      </div>
    </div>
    ${tabsNav(user, activeTab)}
    ${BUBBLES_HTML}
    ${WAVES_HTML}
  </header>
  <div class="demo-banner">
    <span>🧪 Demo mode — sample data, resets anytime.</span>
    <button type="button" class="small" data-action="reset-demo">Reset demo data</button>
  </div>
  <main>
    <div class="mascot-peek peek-${esc(activeTab)}" aria-hidden="true"><img src="assets/mascot.svg" alt=""></div>
    ${FLASH_HTML()}
    ${content}
  </main>`;
}

/* ---- login (same look as the real self-contained login page) ---- */

function renderLogin() {
  document.title = APP_NAME + " — Sign in";
  root.innerHTML = `
  <div class="login-page">
    <div class="sea" aria-hidden="true">
      <div class="bubbles"><span></span><span></span><span></span><span></span><span></span><span></span></div>
      <div class="waves">
        <svg viewBox="0 0 1200 30" preserveAspectRatio="none"><path d="M0 15 Q 75 30 150 15 T 300 15 T 450 15 T 600 15 T 750 15 T 900 15 T 1050 15 T 1200 15 L 1200 30 L 0 30 Z"/></svg>
        <svg class="wave2" viewBox="0 0 1200 30" preserveAspectRatio="none"><path d="M0 15 Q 75 30 150 15 T 300 15 T 450 15 T 600 15 T 750 15 T 900 15 T 1050 15 T 1200 15 L 1200 30 L 0 30 Z"/></svg>
      </div>
    </div>
    <div class="login-card">
      <img class="login-logo" src="assets/logo.png" alt="">
      <h1>${APP_NAME}</h1>
      <p class="sub">Sign in</p>
      ${FLASH_HTML()}
      <div class="error" id="login-error" hidden></div>
      <form method="post" data-action="login">
        <label>Username
          <input name="username" autofocus required autocomplete="username">
        </label>
        <label>Password or PIN
          <input type="password" name="password" required autocomplete="current-password">
        </label>
        <button type="submit">Sign in</button>
      </form>
      <div class="demo-box">
        <p class="demo-box-title">Portfolio demo — try any role:</p>
        <div class="demo-role-row"><span>Owner</span><button type="button" class="small" data-action="demo-login" data-user="owner" data-pin="1111">Sign in as owner</button></div>
        <div class="demo-role-row"><span>Dispatcher</span><button type="button" class="small" data-action="demo-login" data-user="dispatch" data-pin="2222">Sign in as dispatcher</button></div>
        <div class="demo-role-row"><span>Driver</span><button type="button" class="small" data-action="demo-login" data-user="marlon" data-pin="3333">Sign in as driver</button></div>
        <p class="muted">Or type the username + PIN yourself. Seeded with two weeks of sample deliveries, settlements and reports.</p>
      </div>
    </div>
  </div>`;
}

/* ------------------------------------------------------ dashboard */

function perDriverRows(tripList) {
  const map = new Map();
  for (const t of tripList) {
    const row = map.get(t.driver_id) || { name: driverLabel(t.driver_id), trips: 0, stops: 0, gallons: 0, cash: 0 };
    const totals = tripTotals(t);
    row.trips += 1;
    row.stops += totals.stops;
    row.gallons += totals.gallons;
    row.cash = round2(row.cash + totals.cash);
    map.set(t.driver_id, row);
  }
  return [...map.values()].sort((a, b) => b.cash - a.cash);
}

const PER_DRIVER_TABLE = (rows) => `
  <table class="data">
    <thead><tr><th>Driver</th><th>Deliveries</th><th>Trips</th><th>Gallons</th><th>Cash</th></tr></thead>
    <tbody>${rows.map((r) => `
      <tr>
        <td data-label="Driver">${esc(r.name)}</td>
        <td data-label="Deliveries">${r.trips}</td>
        <td data-label="Trips">${r.stops}</td>
        <td data-label="Gallons">${gal(r.gallons)}</td>
        <td data-label="Cash">₱${f2(r.cash)}</td>
      </tr>`).join("")}
    </tbody>
  </table>`;

function dashboardView(user) {
  const today = phtToday();
  const todayTrips = db.trips.filter((t) => t.trip_date === today);
  const openTrip = todayTrips.find((t) => t.status === "open");
  const activeDrivers = db.drivers.filter((d) => d.active);
  const activeCustomers = db.customers.filter((c) => c.active);
  const todaySales = db.sales.filter((s) => s.sale_date === today);

  const quick = openTrip
    ? `<div class="quick-actions"><a class="quick-btn" href="#/trips/${openTrip.id}">Record a trip — ${esc(driverLabel(openTrip.driver_id))}'s delivery is open →</a></div>`
    : activeDrivers.length
      ? `<div class="quick-actions"><a class="quick-btn" href="#/trips">Open a delivery →</a><a class="quick-btn quick-secondary" href="#/customers">Customers</a></div>`
      : "";

  const perDriver = perDriverRows(todayTrips);

  return `
  <h2>Dashboard</h2>
  <p class="muted">${today} (Philippine time)</p>
  ${quick}
  ${todayTrips.length === 0 ? `<p class="muted">Nothing on the books yet today — a good morning starts with an open delivery. 💧</p>` : ""}
  <div class="cards">
    <div class="card"><div class="card-num">${todayTrips.length}</div><div class="card-label">Deliveries today</div></div>
    <div class="card"><div class="card-num">${activeCustomers.length}</div><div class="card-label">Active customers</div></div>
    <div class="card"><div class="card-num">${activeDrivers.length}</div><div class="card-label">Active drivers</div></div>
    <div class="card"><div class="card-num">${todaySales.length}</div><div class="card-label">Counter sales today</div></div>
    <div class="card"><div class="card-num">₱${f2(todaySales.reduce((a, s) => a + s.amount, 0))}</div><div class="card-label">Counter cash today</div></div>
  </div>
  <h3>Today per driver</h3>
  ${perDriver.length ? PER_DRIVER_TABLE(perDriver) : `
  <div class="empty-state">
    <p>No drivers yet — every delivery needs one.</p>
    <p><a class="small-link" href="#/users">Add a driver account in the Users tab →</a></p>
  </div>`}`;
}

/* ------------------------------------------------------- trips list */

function tripCard(t, user) {
  const totals = tripTotals(t);
  const closed = t.status === "closed";
  let settle = "";
  if (closed && t.cash_remitted !== null && t.cash_remitted !== undefined) {
    const disc = totals.discrepancy;
    const ok = Math.abs(disc || 0) < 0.01;
    settle = `<div class="settle ${ok ? "settle-ok" : "settle-bad"}">remitted ₱${f2(t.cash_remitted)} ` +
      (ok ? "— matches" : `— ${disc < 0 ? "SHORT" : "OVER"} ₱${f2(Math.abs(disc))}`) + `</div>`;
  }
  return `
  <article class="trip-card ${closed ? "trip-closed" : ""}">
    <div class="trip-head">
      <h3><a href="#/trips/${t.id}">${esc(driverLabel(t.driver_id))}</a>
        <span class="pill ${closed ? "pill-off" : "pill-on"}">${t.status}</span>
      </h3>
      <a class="small-link" href="#/trips/${t.id}">open ›</a>
    </div>
    <div class="trip-stats">
      <span><strong>${totals.stops}</strong> trips</span>
      <span><strong>${gal(totals.gallons)}</strong> gal</span>
      <span><strong>₱${f2(totals.cash)}</strong> recorded</span>
    </div>
    ${settle}
    ${t.notes ? `<p class="muted">${esc(t.notes)}</p>` : ""}
  </article>`;
}

function tripsView(user, query) {
  const today = phtToday();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(query.get("date") || "") ? query.get("date") : today;
  const isDriver = user.role === "driver";
  const profile = driverOfUser(user);

  let trips = db.trips.filter((t) => t.trip_date === date);
  if (isDriver) trips = trips.filter((t) => t.driver_id === profile?.id);
  trips.sort((a, b) => (a.status === b.status ? a.id - b.id : a.status === "open" ? -1 : 1));

  const notice = isDriver ? driverNotice(user) : null;

  const openPanel = !isDriver ? `
  <section class="panel">
    <h3>Open a delivery</h3>
    ${db.drivers.filter((d) => d.active).length ? `
    <form method="post" class="inline-form" data-action="open-trip">
      <select name="driver_id" required>${db.drivers.filter((d) => d.active).map((d) =>
        `<option value="${d.id}">${esc(d.name)}</option>`).join("")}</select>
      <input name="notes" placeholder="note (optional)">
      <button type="submit">Open delivery</button>
    </form>
    <p class="muted">One open delivery per driver per day. All trips are recorded
    here at the station — including walk-in sales and extra gallons (pick
    <strong>Walk-in / extra gallons</strong> in the form). Closing the delivery
    is the cash settlement; trips a driver recorded before this change stay
    flagged 🚚 for you to verify.</p>
    ` : `<p class="muted">No drivers yet — create driver accounts in the <strong>Users</strong> tab first.</p>`}
  </section>`
  : `
  ${notice ? `<div class="flash">📦 New delivery request from ${esc(notice.opened_by_name)} —
    ${notice.stops ? `${notice.stops} trip${notice.stops !== 1 ? "s" : ""} waiting` : "no trips recorded yet"}.
    <a href="#/trips/${notice.trip.id}">Open it →</a></div>` : ""}
  <p class="muted">Your trips for the day. Open a delivery to see the trips the
  station recorded for you.</p>`;

  return `
  <h2>${isDriver ? "My Deliveries" : "Delivery"}</h2>
  <form method="get" class="date-picker" data-nav="#/trips">
    <label>Date <input type="date" name="date" value="${date}"></label>
    <button type="submit" class="small">View</button>
    ${date !== today ? `<a class="muted" href="#/trips">back to today</a>` : ""}
  </form>
  ${openPanel}
  ${trips.length === 0 ? `<p class="muted">No trips on ${date}.</p>` : trips.map((t) => tripCard(t, user)).join("")}`;
}

/* ---------------------------------------------------- trip detail */

function settleStripDetail(trip) {
  const totals = tripTotals(trip);
  const disc = totals.discrepancy;
  const ok = Math.abs(disc || 0) < 0.01;
  return `<div class="settle ${ok ? "settle-ok" : "settle-bad"}">Settlement: remitted ₱${f2(trip.cash_remitted)} vs recorded
    ₱${f2(totals.cash)} ` +
    (ok ? "— matches" : `— ${disc < 0 ? "SHORT" : "OVER"} ₱${f2(Math.abs(disc))}`) + `</div>`;
}

function stopFormFields(customers, defaultPrice) {
  return `
    <label>Customer
      <select name="customer_id" id="stop-customer">
        ${customers.map((c) => `<option value="${c.id}" data-price="${prefillPrice(c) ?? ""}"
                data-qty="${c.standing_qty ?? ""}" data-amount="${c.standing_amount ?? ""}">${esc(c.name)}</option>`).join("")}
        <option value="">Walk-in / extra gallons</option>
      </select>
    </label>
    <label>Gallons (rounds)
      <input name="qty" inputmode="decimal" placeholder="e.g. 2">
    </label>
    <label>Price per round ₱
      <input name="unit_price" id="stop-price" inputmode="decimal" value="${defaultPrice ?? ""}">
    </label>
    <label>Cash collected ₱ <span class="muted">(blank = the computed amount)</span>
      <input name="cash_collected" inputmode="decimal" placeholder="auto">
    </label>`;
}

function tripDetailView(user, tripId) {
  const trip = db.trips.find((t) => t.id === Number(tripId));
  if (!trip) return `<p class="muted">Delivery not found.</p>`;
  const isDriver = user.role === "driver";
  const profile = driverOfUser(user);
  if (isDriver && (!profile || trip.driver_id !== profile.id)) {
    flash("That delivery isn't yours.", "error");
    nav("#/trips");
    return "";
  }
  const canManage = trip.status === "open" && (user.role === "owner" || user.role === "dispatcher");

  // A driver viewing an unseen request marks it seen (banner + bell clear).
  if (isDriver && trip.opened_by !== null && trip.opened_by !== undefined && !trip.seen_by_driver_at) {
    trip.seen_by_driver_at = phtNow();
    saveDB();
  }

  const totals = tripTotals(trip);
  const activeCustomers = db.customers.filter((c) => c.active);
  const defaultPrice = firstActivePrice();
  const editable = trip.status === "open" && (user.role === "owner" || user.role === "dispatcher");

  const managePanels = canManage ? `
  <section class="panel">
    <h3>Record a trip</h3>
    <form method="post" class="stack-form" data-action="add-stop" data-trip="${trip.id}">
      ${stopFormFields(activeCustomers, defaultPrice)}
      <button type="submit">Record trip</button>
    </form>
    <p class="muted">No customer on the list? Pick <strong>Walk-in / extra
    gallons</strong> — the delivery still records gallons and cash the same way.</p>
  </section>

  <section class="panel">
    <h3>Close delivery (settlement)</h3>
    <p class="muted">Recorded cash on this delivery: <strong>₱${f2(totals.cash)}</strong>.
    Enter the cash actually handed over — any difference is shown, never hidden.</p>
    <form method="post" class="inline-form" data-action="close-trip" data-trip="${trip.id}">
      <label>Cash remitted ₱
        <input name="cash_remitted" inputmode="decimal" required value="${f2(totals.cash)}">
      </label>
      <button type="submit">Close delivery</button>
    </form>
  </section>`
  : (trip.status === "closed" && user.role === "owner"
    ? `<form method="post" data-action="reopen-trip" data-trip="${trip.id}">
        <button type="submit" class="small">Reopen delivery (owner)</button>
      </form>` : "");

  const stops = tripStops(trip.id);
  return `
  <article class="trip-card ${trip.status === "open" ? "trip-sticky" : ""}">
    <div class="trip-head">
      <h2>${esc(driverLabel(trip.driver_id))} <span class="pill ${trip.status === "open" ? "pill-on" : "pill-off"}">${trip.status}</span></h2>
      <a class="small-link" href="#/trips">‹ all deliveries</a>
    </div>
    <p class="muted">${trip.trip_date} (Philippine time)${trip.notes ? `— ${esc(trip.notes)}` : ""}</p>
    <div class="trip-stats">
      <span><strong>${totals.stops}</strong> trips</span>
      <span><strong>${gal(totals.gallons)}</strong> gal</span>
      <span><strong>₱${f2(totals.cash)}</strong> recorded</span>
    </div>
    ${trip.status === "closed" && trip.cash_remitted !== null && trip.cash_remitted !== undefined ? settleStripDetail(trip) : ""}
  </article>

  ${managePanels}

  <h3>Trips</h3>
  ${stops.length === 0 ? `<p class="muted">No trips recorded yet.</p>` : `
  <table class="data">
    <thead>
      <tr><th>Customer</th><th>Gallons</th><th>Price</th><th>Amount</th><th>Cash</th><th>By</th>${editable ? "<th></th>" : ""}</tr>
    </thead>
    <tbody>${stops.map((s) => `
      <tr>
        <td data-label="Customer">${esc(customerLabel(s.customer_id))}</td>
        <td data-label="Gallons">${gal(s.qty)}</td>
        <td data-label="Price">${s.unit_price !== null && s.unit_price !== undefined ? "₱" + f2(s.unit_price) : "—"}</td>
        <td data-label="Amount">₱${f2(s.amount)}</td>
        <td data-label="Cash">₱${f2(s.cash_collected)}${s.concession && Math.abs(s.concession) >= 0.01
          ? ` <span class="muted">(${s.concession > 0 ? "−" : "+"}₱${f2(Math.abs(s.concession))})</span>` : ""}</td>
        <td data-label="By">${esc(recordedByLabel(s.recorded_by) || "?")}${s.recorded_by && userById(s.recorded_by)?.role === "driver"
          ? ` <span title="recorded by the driver — verify at settlement">🚚</span>` : ""}</td>
        ${editable ? `
        <td data-label="Actions" class="actions actions-row">
          <a class="pill pill-edit" href="#/trips/${trip.id}/stop/${s.id}/edit">Edit</a>
          <button type="submit" class="pill pill-delete" data-action="delete-stop" data-trip="${trip.id}" data-stop="${s.id}">Delete</button>
        </td>` : ""}
      </tr>`).join("")}
    </tbody>
  </table>`}`;
}

/* ------------------------------------------------------- stop edit */

function stopEditView(user, tripId, stopId) {
  const trip = db.trips.find((t) => t.id === Number(tripId));
  const stop = db.stops.find((s) => s.id === Number(stopId) && s.trip_id === Number(tripId));
  if (!trip || !stop) return `<p class="muted">Trip not found.</p>`;
  if (trip.status !== "open" || !(user.role === "owner" || user.role === "dispatcher")) {
    flash("Only open deliveries can be corrected.", "error");
    nav("#/trips");
    return "";
  }
  // Cash pre-fills unless it's an exact gallon stop with no concession
  // (blank = re-derive from qty × price, same rule as the real app).
  const cashPrefill = (!stop.qty || Math.abs(stop.concession || 0) >= 0.01) ? f2(stop.cash_collected) : "";
  return `
  <h2>Edit trip</h2>
  <p class="muted">${esc(driverLabel(trip.driver_id))} — ${trip.trip_date}</p>
  <section class="panel">
    <form method="post" class="stack-form" data-action="save-stop" data-trip="${trip.id}" data-stop="${stop.id}">
      <label>Customer
        <select name="customer_id">
          ${db.customers.map((c) => `<option value="${c.id}" ${c.id === stop.customer_id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
          <option value="" ${stop.customer_id === null ? "selected" : ""}>Walk-in / extra gallons</option>
        </select>
      </label>
      <label>Gallons (rounds)
        <input name="qty" inputmode="decimal" value="${stop.qty ?? ""}">
      </label>
      <label>Price per round ₱
        <input name="unit_price" inputmode="decimal" value="${stop.unit_price ?? ""}">
      </label>
      <label>Cash collected ₱ <span class="muted">(blank = the computed amount)</span>
        <input name="cash_collected" inputmode="decimal" value="${cashPrefill}">
      </label>
      <button type="submit">Save correction</button>
    </form>
  </section>`;
}

/* ---------------------------------------------------------- sales */

let pos = new Map(); // product_id -> { qty, price, name } — reset per view

function renderTally() {
  const bar = document.getElementById("tally-bar");
  if (!bar) return;
  const linesEl = document.getElementById("tally-lines");
  const totalEl = document.getElementById("tally-total");
  const record = document.getElementById("tally-record");
  if (!pos.size) { bar.hidden = true; linesEl.replaceChildren(); return; }
  bar.hidden = false;
  let total = 0;
  const rows = [];
  for (const [id, line] of pos) {
    total += line.qty * line.price;
    const row = document.createElement("div");
    row.className = "tally-line";
    const minus = document.createElement("button");
    minus.type = "button"; minus.className = "tally-minus"; minus.dataset.id = id; minus.textContent = "−";
    const name = document.createElement("span");
    name.className = "tally-name"; name.textContent = line.name + " × " + line.qty;
    const amount = document.createElement("span");
    amount.className = "tally-line-amount"; amount.textContent = peso(line.qty * line.price);
    const plus = document.createElement("button");
    plus.type = "button"; plus.className = "tally-plus"; plus.dataset.id = id; plus.textContent = "+";
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "tally-remove"; remove.dataset.id = id; remove.textContent = "✕";
    row.append(minus, name, amount, plus, remove);
    rows.push(row);
  }
  linesEl.replaceChildren(...rows);
  totalEl.textContent = peso(total);
  record.textContent = "✓ Record " + peso(total);
}

function salesView(user, query) {
  const today = phtToday();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(query.get("date") || "") ? query.get("date") : today;
  pos = new Map();

  const activePrices = db.prices.filter((p) => p.active);
  const daySales = db.sales.filter((s) => s.sale_date === date)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const total = round2(daySales.reduce((a, s) => a + s.amount, 0));

  const posPanel = activePrices.length ? `
  <section class="panel">
    <h3>Counter sale</h3>
    <p class="muted">Tap a product to add a gallon to the tally, then record.</p>
    <form method="post" data-action="sale-record">
      <div class="pos-grid" id="pos-grid">
        ${activePrices.map((p) => `
        <button type="button" class="pos-tile" data-id="${p.id}" data-price="${p.unit_price}" data-name="${esc(p.product)}">
          <span class="pos-name">${esc(p.product)}</span>
          <span class="pos-price">₱${f2(p.unit_price)}</span>
        </button>`).join("")}
      </div>
      <div class="tally-bar" id="tally-bar" hidden>
        <div class="tally-lines" id="tally-lines"></div>
        <div class="tally-subtotal">Subtotal <strong id="tally-total">₱0.00</strong></div>
        <button type="submit" class="pos-record" id="tally-record">✓ Record</button>
      </div>
    </form>
  </section>

  <p class="muted"><button type="button" class="small-link js-custom-toggle">+ Custom price</button>
    — for discounts or off-list prices.</p>
  <section class="panel" id="custom-sale-panel" hidden>
    <h3>Custom sale — any price</h3>
    <form method="post" class="stack-form" data-action="sale-custom">
      <label>Product
        <select name="product_id" id="sale-product">
          ${activePrices.map((p) => `<option value="${p.id}" data-price="${p.unit_price}">${esc(p.product)}</option>`).join("")}
        </select>
      </label>
      <label>Quantity (gallons) <input name="qty" inputmode="decimal" required placeholder="e.g. 2" autocomplete="off"></label>
      <label>Price per gallon ₱ <input name="unit_price" id="sale-price" inputmode="decimal" required value="${activePrices[0].unit_price}" autocomplete="off"></label>
      <button type="submit">Record sale</button>
    </form>
  </section>`
  : `<section class="panel"><h3>Counter sale</h3>
     <p class="muted">No prices in the list yet — add one in the <a href="#/prices">Prices tab</a> first.</p></section>`;

  return `
  <h2>Sales</h2>
  <p class="muted">Walk-in refills sold over the counter at the station —
  recorded here, separate from deliveries. ${date} (Philippine time)</p>
  ${posPanel}
  ${daySales.length ? `
  <table class="data">
    <thead><tr><th>Time</th><th>Product</th><th>Qty</th><th>Unit price</th><th>Amount</th><th>Recorded by</th><th>Actions</th></tr></thead>
    <tbody>${daySales.map((s) => `
      <tr>
        <td data-label="Time">${s.created_at.slice(11, 16)}</td>
        <td data-label="Product">${esc(s.product)}</td>
        <td data-label="Qty">${gal(s.qty)}</td>
        <td data-label="Unit price">₱${f2(s.unit_price)}</td>
        <td data-label="Amount">₱${f2(s.amount)}</td>
        <td data-label="Recorded by">${esc(recordedByLabel(s.recorded_by) || "—")}</td>
        <td data-label="Actions" class="actions">
          ${user.role === "owner" ? `<button type="submit" class="small" data-action="sale-delete" data-sale="${s.id}" data-date="${date}">Delete</button>` : ""}
        </td>
      </tr>`).join("")}
    </tbody>
  </table>
  <p class="muted">Day total: <strong>₱${f2(total)}</strong> across ${daySales.length} sale${daySales.length !== 1 ? "s" : ""}.</p>`
  : `<div class="empty-state"><p>No counter sales recorded for ${date} yet.</p></div>`}

  <form method="get" class="date-picker" data-nav="#/sales">
    <label>Look at another day <input type="date" name="date" value="${date}" max="${today}"></label>
    <button type="submit" class="small">View</button>
  </form>`;
}

/* ------------------------------------------------------ customers */

function customersView(user) {
  const list = [...db.customers].sort((a, b) => (a.active !== b.active ? (a.active ? -1 : 1) : a.name.localeCompare(b.name)));
  return `
  <h2>Customers</h2>

  <section class="panel">
    <h3>Add a customer</h3>
    <form method="post" class="stack-form" data-action="add-customer">
      <label>Name <input name="name" required minlength="2" maxlength="60" autocomplete="off"></label>
      <label>Contact <input name="contact" placeholder="0917-…" autocomplete="off"></label>
      <label>Address <input name="address" placeholder="street / purok" autocomplete="off"></label>
      <button type="submit">Add customer</button>
    </form>
  </section>

  <label class="search-row">Search
    <input id="customer-search" placeholder="name / contact / address" autocomplete="off">
  </label>
  <p id="no-customer-match" class="muted" hidden>No customers match your search.</p>

  <table class="data" id="customers-table">
    <thead><tr><th>Name</th><th>Contact</th><th>Address</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${list.map((c) => `
      <tr>
        <td data-label="Name">${esc(c.name)}</td>
        <td data-label="Contact">${c.contact ? esc(c.contact) : "—"}</td>
        <td data-label="Address">${c.address ? esc(c.address) : "—"}</td>
        <td data-label="Status"><span class="pill ${c.active ? "pill-on" : "pill-off"}">${c.active ? "active" : "inactive"}</span></td>
        <td data-label="Actions" class="actions actions-stack">
          <div class="action-menu">
            <button type="button" class="js-menu-toggle menu-btn" aria-haspopup="true" aria-expanded="false" title="Actions" aria-label="Actions">${ICONS.dots}</button>
            <div class="menu-panel" hidden>
              <button type="button" class="menu-item js-toggle-edit">${ICONS.edit}Edit</button>
              <button type="button" class="menu-item js-toggle-pricing">${ICONS.pricing}Pricing</button>
              <button type="button" class="menu-item" data-action="customer-toggle" data-customer="${c.id}">${c.active ? ICONS.deactivate + "Deactivate" : ICONS.activate + "Activate"}</button>
              <button type="button" class="menu-item menu-danger" data-action="customer-delete" data-customer="${c.id}" data-name="${esc(c.name)}">${ICONS.delete}Delete</button>
            </div>
          </div>
          <form method="post" class="rename-form inline-edit" hidden data-action="customer-rename" data-customer="${c.id}">
            <input name="name" placeholder="name" minlength="2" value="${esc(c.name)}">
            <input name="contact" placeholder="contact" value="${esc(c.contact || "")}">
            <input name="address" placeholder="address" value="${esc(c.address || "")}">
            <button type="submit" class="small">Save</button>
          </form>
          <form method="post" class="price-form inline-edit" hidden data-action="customer-price" data-customer="${c.id}">
            <input name="custom_price" placeholder="custom ₱/round" inputmode="decimal" value="${c.custom_price ?? ""}">
            <input name="standing_qty" placeholder="standing gal" inputmode="decimal" value="${c.standing_qty ?? ""}">
            <input name="standing_amount" placeholder="flat ₱/visit" inputmode="decimal" value="${c.standing_amount ?? ""}">
            <button type="submit" class="small">Set pricing</button>
          </form>
        </td>
      </tr>`).join("")}
    </tbody>
  </table>
  <p class="muted">
    <strong>Custom ₱/round</strong> = this customer's own price (e.g. far customers) —
    the trip form pre-fills it. <strong>Standing gallons</strong> pre-fills their daily
    gallons; <strong>flat ₱/visit</strong> records a fixed per-visit amount instead.
    Leave blank to use the price list. Deactivating never deletes history.
  </p>`;
}

/* --------------------------------------------------------- prices */

function pricesView(user) {
  const list = [...db.prices].sort((a, b) => (a.active !== b.active ? (a.active ? -1 : 1) : a.product.localeCompare(b.product)));
  return `
  <h2>Prices</h2>

  <section class="panel">
    <h3>Add a price</h3>
    <form method="post" class="stack-form" data-action="add-price">
      <label>Product <input name="product" required minlength="2" maxlength="60" placeholder="e.g. Round 5-gal refill" autocomplete="off"></label>
      <label>Price per unit ₱ <input name="unit_price" inputmode="decimal" required placeholder="e.g. 35" autocomplete="off"></label>
      <button type="submit">Add price</button>
    </form>
  </section>

  <table class="data">
    <thead><tr><th>Product</th><th>Price</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${list.map((p) => `
      <tr>
        <td data-label="Product">${esc(p.product)}</td>
        <td data-label="Price">₱${f2(p.unit_price)}</td>
        <td data-label="Status"><span class="pill ${p.active ? "pill-on" : "pill-off"}">${p.active ? "active" : "inactive"}</span></td>
        <td data-label="Actions" class="actions actions-stack">
          <div class="action-menu">
            <button type="button" class="js-menu-toggle menu-btn" aria-haspopup="true" aria-expanded="false" title="Actions" aria-label="Actions">${ICONS.dots}</button>
            <div class="menu-panel" hidden>
              <button type="button" class="menu-item js-toggle-edit">${ICONS.edit}Rename / set price</button>
              <button type="button" class="menu-item" data-action="price-toggle" data-price="${p.id}">${p.active ? ICONS.deactivate + "Deactivate" : ICONS.activate + "Activate"}</button>
            </div>
          </div>
          <form method="post" class="rename-form inline-edit" hidden data-action="price-update" data-price="${p.id}">
            <input name="product" placeholder="rename">
            <input name="unit_price" placeholder="new ₱" inputmode="decimal">
            <button type="submit" class="small">Save</button>
          </form>
        </td>
      </tr>`).join("")}
    </tbody>
  </table>
  <p class="muted">Changing a price here never changes old trips — every trip
  stores the price it was actually charged (snapshot).</p>`;
}

/* ------------------------------------------------------ inventory */

function inventoryView(user) {
  const today = phtToday();
  const items = [...db.inventory_items].sort((a, b) => (a.active !== b.active ? (a.active ? -1 : 1) : a.name.localeCompare(b.name)));
  const latestCount = (itemId) => {
    const rows = db.inventory_counts.filter((c) => c.item_id === itemId)
      .sort((a, b) => (b.count_date + b.created_at).localeCompare(a.count_date + a.created_at));
    return rows[0] || null;
  };
  const activeItems = items.filter((i) => i.active);
  const history = [...db.inventory_counts]
    .sort((a, b) => ((b.count_date + b.created_at).localeCompare(a.count_date + a.created_at)))
    .slice(0, 30);

  const loanSums = new Map();
  for (const l of db.jug_loans) loanSums.set(l.customer_id, round2((loanSums.get(l.customer_id) || 0) + l.qty));
  const loans = [...loanSums.entries()].filter(([, v]) => v > 0).map(([cid, v]) => {
    const rows = db.jug_loans.filter((l) => l.customer_id === cid);
    const last = rows.map((l) => l.created_at).sort().pop();
    return { name: customerLabel(cid), jugs_out: v, last_activity: last };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const totalOut = loans.reduce((a, l) => a + l.jugs_out, 0);
  const activeCustomers = db.customers.filter((c) => c.active);

  return `
  <h2>Inventory</h2>

  <section class="panel">
    <h3>Stock take</h3>
    <p class="muted">Type what you actually counted, then save once. Blank = not counted today.
    The newest count for each item is its current stock.</p>
    ${activeItems.length ? `
    <form method="post" class="stack-form" data-action="inventory-count">
      <label>Date <input type="date" name="count_date" value="${today}" max="${today}" required></label>
      ${activeItems.map((item) => `
      <label>${esc(item.name)} <input name="qty_${item.id}" inputmode="numeric" min="0" step="1" placeholder="how many?" autocomplete="off"></label>`).join("")}
      <label>Note (optional) <input name="notes" maxlength="120" placeholder="e.g. after delivery run" autocomplete="off"></label>
      <button type="submit">Save stock take</button>
    </form>` : `<p class="muted">No items yet — add one below.</p>`}
  </section>

  <table class="data">
    <thead><tr><th>Item</th><th>Current count</th><th>Last counted</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${items.map((item) => {
      const latest = latestCount(item.id);
      return `
      <tr>
        <td data-label="Item">${esc(item.name)}</td>
        <td data-label="Current count">${latest ? latest.qty : "—"}</td>
        <td data-label="Last counted">${latest ? latest.count_date : "—"}</td>
        <td data-label="Status"><span class="pill ${item.active ? "pill-on" : "pill-off"}">${item.active ? "active" : "inactive"}</span></td>
        <td data-label="Actions" class="actions actions-stack">
          <div class="action-menu">
            <button type="button" class="js-menu-toggle menu-btn" aria-haspopup="true" aria-expanded="false" title="Actions" aria-label="Actions">${ICONS.dots}</button>
            <div class="menu-panel" hidden>
              <button type="button" class="menu-item js-toggle-edit">${ICONS.edit}Rename</button>
              <button type="button" class="menu-item" data-action="item-toggle" data-item="${item.id}">${item.active ? ICONS.deactivate + "Deactivate" : ICONS.activate + "Activate"}</button>
            </div>
          </div>
          <form method="post" class="rename-form inline-edit" hidden data-action="item-rename" data-item="${item.id}">
            <input name="name" placeholder="rename" value="${esc(item.name)}">
            <button type="submit" class="small">Save</button>
          </form>
        </td>
      </tr>`;
    }).join("")}
    </tbody>
  </table>

  <section class="panel">
    <h3>Add an item</h3>
    <form method="post" class="stack-form" data-action="item-add">
      <label>Item name <input name="name" required minlength="2" maxlength="60" placeholder="e.g. Caps" autocomplete="off"></label>
      <button type="submit">Add item</button>
    </form>
  </section>

  <section class="panel">
    <h3>Jugs with customers</h3>
    <p class="muted">Lend a jug to a customer or take it back. This is custody only —
    no money involved. Customers with nothing out are not listed.</p>
    ${activeCustomers.length ? `
    <form method="post" class="stack-form" data-action="loan">
      <label>Customer
        <select name="customer_id" required>${activeCustomers.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>
      </label>
      <label>How many jugs <input name="qty" inputmode="numeric" min="1" step="1" required placeholder="e.g. 2" autocomplete="off"></label>
      <div class="loan-buttons">
        <button type="submit" name="direction" value="lend">Lend</button>
        <button type="submit" name="direction" value="return">Take back</button>
      </div>
    </form>` : `<p class="muted">No customers yet — add them on the Customers tab first.</p>`}

    ${loans.length ? `
    <table class="data">
      <thead><tr><th>Customer</th><th>Jugs out</th><th>Last move</th></tr></thead>
      <tbody>${loans.map((loan) => `
        <tr>
          <td data-label="Customer">${esc(loan.name)}</td>
          <td data-label="Jugs out">${loan.jugs_out}</td>
          <td data-label="Last move">${loan.last_activity ? loan.last_activity.slice(0, 10) : "—"}</td>
        </tr>`).join("")}
      </tbody>
    </table>
    <p class="muted">Total jugs out: <strong>${totalOut}</strong></p>`
    : (activeCustomers.length ? `<p class="muted">Nobody has jugs out right now.</p>` : "")}
  </section>

  <section class="panel">
    <h3>Recent stock takes</h3>
    ${history.length ? `
    <table class="data">
      <thead><tr><th>Date</th><th>Item</th><th>Count</th><th>Note</th><th>Recorded by</th></tr></thead>
      <tbody>${history.map((row) => `
        <tr>
          <td data-label="Date">${row.count_date}</td>
          <td data-label="Item">${esc(db.inventory_items.find((i) => i.id === row.item_id)?.name || "?")}</td>
          <td data-label="Count">${row.qty}</td>
          <td data-label="Note">${row.notes ? esc(row.notes) : "—"}</td>
          <td data-label="Recorded by">${esc(recordedByLabel(row.recorded_by) || "—")}</td>
        </tr>`).join("")}
      </tbody>
    </table>
    <p class="muted">Showing the last 30 counts.</p>` : `<p class="muted">No stock takes recorded yet.</p>`}
  </section>`;
}

/* -------------------------------------------------------- reports */

const RANGES = {
  today: [0, "Today"], week: [6, "Last 7 days"], month: [null, "This month"],
  "30": [29, "Last 30 days"], "90": [89, "Last 90 days"],
};

function rangeDates(key) {
  const today = phtToday();
  const to = today;
  let from;
  if (key === "month") from = today.slice(0, 8) + "01";
  else from = addDays(today, -(RANGES[key]?.[0] ?? 29));
  return { from, to };
}

function reportsView(user, query) {
  const rangeKey = RANGES[query.get("range")] ? query.get("range") : "month";
  const { from, to } = rangeDates(rangeKey);

  const trips = db.trips.filter((t) => t.trip_date >= from && t.trip_date <= to)
    .sort((a, b) => b.trip_date.localeCompare(a.trip_date) || b.id - a.id);

  const perDriver = perDriverRows(trips);

  // Day by day (descending by date).
  const dayMap = new Map();
  for (const t of trips) {
    const totals = tripTotals(t);
    const row = dayMap.get(t.trip_date) || { trip_date: t.trip_date, trips: 0, stops: 0, gallons: 0, cash: 0 };
    row.trips += 1; row.stops += totals.stops;
    row.gallons += totals.gallons;
    row.cash = round2(row.cash + totals.cash);
    dayMap.set(t.trip_date, row);
  }
  const daily = [...dayMap.values()].sort((a, b) => b.trip_date.localeCompare(a.trip_date));
  const chartDays = daily.slice(0, 14);
  const chartMax = Math.max(0, ...chartDays.map((d) => d.cash));

  const salesDays = new Map();
  for (const s of db.sales) {
    if (s.sale_date < from || s.sale_date > to) continue;
    const row = salesDays.get(s.sale_date) || { sale_date: s.sale_date, sales: 0, gallons: 0, cash: 0 };
    row.sales += 1; row.gallons += s.qty;
    row.cash = round2(row.cash + s.amount);
    salesDays.set(s.sale_date, row);
  }
  const dailySales = [...salesDays.values()].sort((a, b) => b.sale_date.localeCompare(a.sale_date));

  const discrepancies = trips.filter((t) => t.status === "closed" && t.cash_remitted !== null &&
    Math.abs(round2(t.cash_remitted - tripTotals(t).cash)) >= 0.01)
    .map((t) => ({ trip: t, recorded: tripTotals(t).cash }));

  return `
  <h2>Reports</h2>

  <nav class="range-picker">
    ${Object.keys(RANGES).map((key) =>
      `<a href="#/reports?range=${key}" class="tab ${key === rangeKey ? "active" : ""}">${RANGES[key][1]}</a>`).join("")}
    <a class="small-link" href="#" data-action="export-csv" data-range="${rangeKey}">⬇ Export CSV</a>
  </nav>
  <p class="muted">${from} to ${to} (max 90 days per pull — kind to the free tier).</p>

  <h3>Per driver</h3>
  ${perDriver.length ? PER_DRIVER_TABLE(perDriver) : `<p class="muted">No deliveries in this range.</p>`}

  <h3>Day by day</h3>
  ${daily.length ? `
  <div class="chart" role="img" aria-label="Bar chart of cash recorded per day, last 14 days of the range">
    ${[...chartDays].reverse().map((d) => `
    <div class="chart-col" title="${d.trip_date} — ₱${f2(d.cash)} (${d.trips} delivery${d.trips !== 1 ? "s" : ""})">
      <div class="chart-bar" style="height: ${chartMax ? Math.floor((d.cash / chartMax) * 100) : 0}%"></div>
      <div class="chart-day">${d.trip_date.slice(-2)}</div>
    </div>`).join("")}
  </div>
  <p class="muted chart-note">Cash recorded per day — last 14 days of this range (days with no deliveries aren't shown).</p>
  <table class="data">
    <thead><tr><th>Date</th><th>Deliveries</th><th>Trips</th><th>Gallons</th><th>Cash</th></tr></thead>
    <tbody>${daily.map((d) => `
      <tr>
        <td data-label="Date">${d.trip_date}</td>
        <td data-label="Deliveries">${d.trips}</td>
        <td data-label="Trips">${d.stops}</td>
        <td data-label="Gallons">${gal(d.gallons)}</td>
        <td data-label="Cash">₱${f2(d.cash)}</td>
      </tr>`).join("")}
    </tbody>
  </table>` : `<p class="muted">Nothing yet in this range.</p>`}

  <h3>Counter sales</h3>
  <p class="muted">Walk-in refills sold at the station — kept separate from
  delivery money on purpose.
  <a class="small-link" href="#" data-action="export-sales-csv" data-range="${rangeKey}">⬇ Export counter sales CSV</a></p>
  ${dailySales.length ? `
  <table class="data">
    <thead><tr><th>Date</th><th>Sales</th><th>Gallons</th><th>Cash</th></tr></thead>
    <tbody>${dailySales.map((s) => `
      <tr>
        <td data-label="Date">${s.sale_date}</td>
        <td data-label="Sales">${s.sales}</td>
        <td data-label="Gallons">${gal(s.gallons)}</td>
        <td data-label="Cash">₱${f2(s.cash)}</td>
      </tr>`).join("")}
    </tbody>
  </table>` : `<p class="muted">No counter sales in this range.</p>`}

  <h3>Settlement discrepancies</h3>
  ${discrepancies.length ? `
  <table class="data">
    <thead><tr><th>Date</th><th>Driver</th><th>Recorded</th><th>Remitted</th><th>Difference</th></tr></thead>
    <tbody>${discrepancies.map(({ trip, recorded }) => `
      <tr>
        <td data-label="Date">${trip.trip_date}</td>
        <td data-label="Driver">${esc(driverLabel(trip.driver_id))}</td>
        <td data-label="Recorded">₱${f2(recorded)}</td>
        <td data-label="Remitted">₱${f2(trip.cash_remitted)}</td>
        <td data-label="Difference"><strong>₱${f2(round2(trip.cash_remitted - recorded))}</strong></td>
      </tr>`).join("")}
    </tbody>
  </table>` : `<p class="muted">None — every settlement in this range matched.</p>`}

  <h3>Backup &amp; restore</h3>
  <section class="panel">
    <p class="muted">In the live app this panel downloads/restores a full copy of
    the SQLite ledger. It doesn't apply to this static demo — the sample data
    resets with the <strong>Reset demo data</strong> button in the banner instead.</p>
  </section>`;
}

/* ---------------------------------------------------------- users */

function usersView(user) {
  const activeOwners = db.users.filter((u) => u.role === "owner" && u.active).length;
  const list = [...db.users].sort((a, b) => a.id - b.id);
  return `
  <h2>Users</h2>

  <section class="panel">
    <h3>Add a user</h3>
    <form method="post" class="stack-form" data-action="add-user">
      <label>Username
        <input name="username" required minlength="2" maxlength="30" autocomplete="off">
      </label>
      <label>Role
        <select name="role">
          <option value="dispatcher">Dispatcher</option>
          <option value="driver">Driver</option>
          <option value="owner">Owner</option>
        </select>
      </label>
      <label>Name <span class="muted">(drivers only — shows on their profile)</span>
        <input name="name" placeholder="e.g. Marlon" autocomplete="off">
      </label>
      <label>Password or 4-digit PIN
        <input name="password" required minlength="4" autocomplete="new-password">
      </label>
      <button type="submit">Add user</button>
    </form>
    <p class="muted">Usernames can be edited later (⋯ menu → Edit username); roles
    can't — a wrong role gets a new account instead.</p>
  </section>

  <table class="data">
    <thead><tr><th>Username</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${list.map((u) => {
      const isDriverProfile = !!db.drivers.find((d) => d.user_id === u.id);
      const lastOwner = u.role === "owner" && u.active && activeOwners <= 1;
      return `
      <tr>
        <td data-label="Username">${esc(u.username)}</td>
        <td data-label="Role">${u.role}${isDriverProfile ? " (driver profile)" : ""}</td>
        <td data-label="Status"><span class="pill ${u.active ? "pill-on" : "pill-off"}">${u.active ? "active" : "disabled"}</span></td>
        <td data-label="Actions" class="actions actions-stack">
          <div class="action-menu">
            <button type="button" class="js-menu-toggle menu-btn" aria-haspopup="true" aria-expanded="false" title="Actions" aria-label="Actions">${ICONS.dots}</button>
            <div class="menu-panel" hidden>
              <button type="button" class="menu-item" data-action="user-toggle" data-user="${u.id}"
                ${lastOwner ? `disabled title="Can't disable the last active owner"` : ""}>${u.active ? ICONS.deactivate + "Disable" : ICONS.activate + "Enable"}</button>
              <button type="button" class="menu-item js-rename-toggle">${ICONS.edit}Edit username</button>
              <button type="button" class="menu-item js-reset-toggle">${ICONS.key}Reset password</button>
              ${u.role !== "owner" ? `<button type="button" class="menu-item menu-danger" data-action="user-delete" data-user="${u.id}" data-name="${esc(u.username)}">${ICONS.delete}Delete</button>` : ""}
            </div>
          </div>
          <form method="post" class="rename-form inline-edit" hidden data-action="user-rename" data-user="${u.id}">
            <input name="username" value="${esc(u.username)}" required minlength="2" maxlength="30" autocomplete="off">
            <button type="submit" class="small">Save</button>
          </form>
          <form method="post" class="reset-form inline-edit" hidden data-action="user-reset" data-user="${u.id}">
            <input name="password" placeholder="new password / PIN" minlength="4" required autocomplete="new-password">
            <button type="submit" class="small">Set</button>
          </form>
        </td>
      </tr>`;
    }).join("")}
    </tbody>
  </table>`;
}

/* --------------------------------------------------------- render */

function render() {
  const route = parseRoute();
  const user = currentUser();

  if (!user || route.parts[0] === "login") {
    if (user) { signOut(); } // explicit #/login while signed in = sign out
    renderLogin();
    syncMascot();
    return;
  }

  const tab = route.parts[0] || "";
  const home = homeHash(user);
  if (tab && !ROLE_TABS[user.role].includes(tab)) {
    flash("You don't have access to that tab.", "error");
    nav(home);
    return;
  }

  let content = "";
  if (!tab) content = user.role === "owner" ? dashboardView(user) : tripsView(user, route.query);
  else if (tab === "trips") {
    if (route.parts[1] && route.parts[2] === "stop" && route.parts[3]) {
      content = stopEditView(user, route.parts[1], route.parts[3]);
    } else if (route.parts[1]) {
      content = tripDetailView(user, route.parts[1]);
    } else content = tripsView(user, route.query);
  }
  else if (tab === "sales") content = salesView(user, route.query);
  else if (tab === "customers") content = customersView(user);
  else if (tab === "prices") content = pricesView(user);
  else if (tab === "inventory") content = inventoryView(user);
  else if (tab === "reports") content = reportsView(user, route.query);
  else if (tab === "users") content = usersView(user);

  shell(user, tab || (user.role === "owner" ? "dashboard" : "trips"), content);
  syncMascot();
}

function syncMascot() {
  const topbar = document.querySelector(".topbar");
  if (!topbar) return;
  document.documentElement.style.setProperty("--mascot-top", (topbar.offsetHeight - 34) + "px");
}

/* -------------------------------------------------------- actions */

function requireOwnerDispatcher(user) {
  return user.role === "owner" || user.role === "dispatcher";
}

function doLogin(form) {
  const username = fieldTrim(form, "username");
  const password = fieldVal(form, "password");
  const u = db.users.find((x) => x.username.toLowerCase() === username.toLowerCase());
  const errBox = document.getElementById("login-error");
  const fail = (msg) => { errBox.textContent = msg; errBox.hidden = false; };
  if (!u || u.password !== password) return fail("Wrong username or password.");
  if (!u.active) return fail("This account is disabled — ask the owner.");
  signIn(u);
  flash(greeting(), "greet");
  nav(homeHash(u));
}

function doOpenTrip(user, form) {
  const driverId = Number(fieldVal(form, "driver_id"));
  const driver = driverById(driverId);
  const today = phtToday();
  if (!driver || !driver.active) return flash("Pick a driver.", "error");
  if (db.trips.find((t) => t.driver_id === driverId && t.trip_date === today && t.status === "open")) {
    return flash(`${driver.name} already has an open delivery today.`, "error");
  }
  const t = {
    id: Math.max(0, ...db.trips.map((x) => x.id)) + 1,
    trip_date: today, driver_id: driverId, status: "open",
    cash_remitted: null, closed_at: null, closed_by: null,
    notes: fieldTrim(form, "notes"), opened_by: user.id, seen_by_driver_at: null,
  };
  db.trips.push(t);
  saveDB();
  flash(`Delivery opened for ${driver.name}.`);
  nav("#/trips/" + t.id);
}

// Mirror of the server's stop rules: gallon stops derive amount from
// qty × price (snapshot); blank qty = flat per-visit stop (amount = cash).
function applyStopRules(qtyRaw, priceRaw, cashRaw) {
  if (qtyRaw !== "") {
    const qty = Number(qtyRaw);
    if (!Number.isFinite(qty) || qty <= 0) return { error: "Gallons must be more than zero." };
    const price = Number(priceRaw);
    if (!Number.isFinite(price) || price < 0) return { error: "Enter a valid price per round." };
    let cash = null;
    if (cashRaw !== "") {
      cash = parseMoney(cashRaw);
      if (cash === null || Number.isNaN(cash) || cash < 0) return { error: "Cash can't be negative — charge less instead." };
    }
    const amount = round2(qty * price);
    const cashVal = cash === null ? amount : cash;
    return { qty, unit_price: price, amount, cash: cashVal, concession: round2(amount - cashVal) };
  }
  // flat per-visit stop
  const cash = parseMoney(cashRaw);
  if (cash === null || Number.isNaN(cash) || cash <= 0) {
    return { error: "Enter the cash collected — a flat per-visit trip is recorded by its amount." };
  }
  return { qty: null, unit_price: null, amount: cash, cash, concession: 0 };
}

function doAddStop(user, form) {
  const trip = db.trips.find((t) => t.id === Number(form.dataset.trip));
  if (!trip || trip.status !== "open") return flash("This delivery is closed — reopen it first (owner).", "error");
  if (!requireOwnerDispatcher(user)) return flash("You don't have access to that.", "error");
  const result = applyStopRules(fieldTrim(form, "qty"), fieldTrim(form, "unit_price"), fieldTrim(form, "cash_collected"));
  if (result.error) return flash(result.error, "error");
  db.stops.push({
    id: Math.max(0, ...db.stops.map((s) => s.id)) + 1,
    trip_id: trip.id,
    customer_id: fieldVal(form, "customer_id") === "" ? null : Number(fieldVal(form, "customer_id")),
    qty: result.qty, unit_price: result.unit_price,
    amount: result.amount, cash_collected: result.cash, concession: result.concession,
    recorded_by: user.id, created_at: phtNow(),
  });
  saveDB();
  flash(result.qty ? `Trip recorded — ${gal(result.qty)} gal, ₱${f2(result.cash)} cash.` : `Flat trip recorded — ₱${f2(result.cash)}.`);
  nav("#/trips/" + trip.id);
}

function doSaveStop(user, form) {
  const trip = db.trips.find((t) => t.id === Number(form.dataset.trip));
  const stop = db.stops.find((s) => s.id === Number(form.dataset.stop));
  if (!trip || !stop) return;
  if (trip.status !== "open") return flash("This delivery is closed — reopen it first (owner).", "error");
  const result = applyStopRules(fieldTrim(form, "qty"), fieldTrim(form, "unit_price"), fieldTrim(form, "cash_collected"));
  if (result.error) return flash(result.error, "error");
  stop.customer_id = fieldVal(form, "customer_id") === "" ? null : Number(fieldVal(form, "customer_id"));
  stop.qty = result.qty;
  stop.unit_price = result.unit_price;
  stop.amount = result.amount;
  stop.cash_collected = result.cash;
  stop.concession = result.concession;
  saveDB();
  flash("Correction saved.");
  nav("#/trips/" + trip.id);
}

function doDeleteStop(user, btn) {
  const tripId = Number(btn.dataset.trip);
  const stopId = Number(btn.dataset.stop);
  const trip = db.trips.find((t) => t.id === tripId);
  const idx = db.stops.findIndex((s) => s.id === stopId && s.trip_id === tripId);
  if (!trip || idx < 0) return;
  if (trip.status !== "open") return flash("This delivery is closed — reopen it first (owner).", "error");
  db.stops.splice(idx, 1);
  saveDB();
  flash("Trip deleted.");
  nav("#/trips/" + tripId);
}

function doCloseTrip(user, form) {
  const trip = db.trips.find((t) => t.id === Number(form.dataset.trip));
  if (!trip || trip.status !== "open") return;
  const cash = parseMoney(fieldVal(form, "cash_remitted"));
  if (cash === null || Number.isNaN(cash) || cash < 0) return flash("Enter the cash actually remitted.", "error");
  const totals = tripTotals(trip);
  trip.status = "closed";
  trip.cash_remitted = cash;
  trip.closed_at = phtNow();
  trip.closed_by = user.id;
  saveDB();
  const disc = round2(cash - totals.cash);
  flash(Math.abs(disc) < 0.01
    ? `Delivery closed — remitted ₱${f2(cash)}, matches the ₱${f2(totals.cash)} recorded.`
    : `Delivery closed — ${disc < 0 ? "SHORT" : "OVER"} ₱${f2(Math.abs(disc))} (recorded ₱${f2(totals.cash)}, remitted ₱${f2(cash)}).`);
  nav("#/trips?date=" + trip.trip_date);
}

function doReopenTrip(user, btn) {
  const trip = db.trips.find((t) => t.id === Number(btn.dataset.trip));
  if (!trip || user.role !== "owner") return;
  trip.status = "open";
  trip.cash_remitted = null;
  trip.closed_at = null;
  trip.closed_by = null;
  saveDB();
  flash("Delivery reopened.");
  nav("#/trips/" + trip.id);
}

/* --- customers --- */

function doAddCustomer(form) {
  const name = fieldTrim(form, "name");
  if (name.length < 2) return flash("Name must be at least 2 characters.", "error");
  db.customers.push({
    id: Math.max(0, ...db.customers.map((c) => c.id)) + 1,
    name, contact: fieldTrim(form, "contact"), address: fieldTrim(form, "address"),
    custom_price: null, standing_qty: null, standing_amount: null, active: 1,
  });
  saveDB();
  flash(`${name} added.`);
  nav("#/customers");
}

function doCustomerRename(form) {
  const c = customerById(Number(form.dataset.customer));
  if (!c) return;
  const name = fieldTrim(form, "name");
  if (name.length < 2) return flash("Name must be at least 2 characters.", "error");
  c.name = name;
  c.contact = fieldTrim(form, "contact");
  c.address = fieldTrim(form, "address");
  saveDB();
  flash("Customer updated.");
  nav("#/customers");
}

function doCustomerPrice(form) {
  const c = customerById(Number(form.dataset.customer));
  if (!c) return;
  const opt = (field) => {
    const raw = fieldTrim(form, field);
    if (raw === "") return null;
    const v = parseMoney(raw);
    if (v === null || Number.isNaN(v)) return NaN;
    return round2(v);
  };
  const custom_price = opt("custom_price"), standing_qty = opt("standing_qty"), standing_amount = opt("standing_amount");
  if ([custom_price, standing_qty, standing_amount].some((v) => Number.isNaN(v))) {
    return flash("Pricing must be numbers (or blank).", "error");
  }
  c.custom_price = custom_price;
  c.standing_qty = standing_qty;
  c.standing_amount = standing_amount;
  saveDB();
  flash(`Pricing set for ${c.name}.`);
  nav("#/customers");
}

function doCustomerToggle(btn) {
  const c = customerById(Number(btn.dataset.customer));
  if (!c) return;
  c.active = c.active ? 0 : 1;
  saveDB();
  flash(`${c.name} ${c.active ? "activated" : "deactivated"}. Deactivating never deletes history.`);
  nav("#/customers");
}

function doCustomerDelete(btn) {
  const c = customerById(Number(btn.dataset.customer));
  if (!c) return;
  if (!confirm(`Delete ${c.name}? Only works if they have no recorded trips.`)) return;
  if (db.stops.find((s) => s.customer_id === c.id)) {
    return flash(`${c.name} has recorded trips and can't be deleted — deactivate instead.`, "error");
  }
  db.customers = db.customers.filter((x) => x.id !== c.id);
  saveDB();
  flash(`${c.name} deleted.`);
  nav("#/customers");
}

/* --- prices --- */

function doAddPrice(form) {
  const product = fieldTrim(form, "product");
  const price = parseMoney(fieldVal(form, "unit_price"));
  if (product.length < 2) return flash("Product name must be at least 2 characters.", "error");
  if (price === null || Number.isNaN(price) || price < 0) return flash("Enter a valid price.", "error");
  db.prices.push({
    id: Math.max(0, ...db.prices.map((p) => p.id)) + 1,
    product, unit_price: price, active: 1,
  });
  saveDB();
  flash(`${product} added at ₱${f2(price)}.`);
  nav("#/prices");
}

function doPriceUpdate(form) {
  const p = db.prices.find((x) => x.id === Number(form.dataset.price));
  if (!p) return;
  const product = fieldTrim(form, "product");
  const price = parseMoney(fieldVal(form, "unit_price"));
  if (product) p.product = product;
  if (price !== null && !Number.isNaN(price)) p.unit_price = round2(price);
  saveDB();
  flash("Price updated — old trips keep their snapshot.");
  nav("#/prices");
}

function doPriceToggle(btn) {
  const p = db.prices.find((x) => x.id === Number(btn.dataset.price));
  if (!p) return;
  p.active = p.active ? 0 : 1;
  saveDB();
  flash(`${p.product} ${p.active ? "activated" : "deactivated"}.`);
  nav("#/prices");
}

/* --- sales --- */

function doSaleRecord(user) {
  if (!pos.size) return;
  const now = phtNow();
  let total = 0, count = 0;
  for (const [, line] of pos) {
    db.sales.push({
      id: Math.max(0, ...db.sales.map((s) => s.id)) + 1,
      sale_date: phtToday(), product: line.name, qty: line.qty,
      unit_price: line.price, amount: round2(line.qty * line.price),
      recorded_by: user.id, created_at: now,
    });
    total += line.qty * line.price;
    count += line.qty;
  }
  saveDB();
  pos = new Map();
  flash(`Recorded ${count} gallon${count !== 1 ? "s" : ""} — ${peso(total)} counter cash.`);
  nav("#/sales");
}

function doSaleCustom(user, form) {
  const qty = Number(fieldTrim(form, "qty"));
  const price = parseMoney(fieldVal(form, "unit_price"));
  if (!Number.isFinite(qty) || qty <= 0) return flash("Quantity must be more than zero.", "error");
  if (price === null || Number.isNaN(price) || price < 0) return flash("Enter a valid price.", "error");
  const p = db.prices.find((x) => x.id === Number(fieldVal(form, "product_id")));
  db.sales.push({
    id: Math.max(0, ...db.sales.map((s) => s.id)) + 1,
    sale_date: phtToday(), product: p ? p.product : "Custom",
    qty, unit_price: price, amount: round2(qty * price),
    recorded_by: user.id, created_at: phtNow(),
  });
  saveDB();
  flash(`Sale recorded — ${peso(qty * price)}.`);
  nav("#/sales");
}

function doSaleDelete(btn) {
  const id = Number(btn.dataset.sale);
  const idx = db.sales.findIndex((s) => s.id === id);
  if (idx < 0) return;
  const s = db.sales[idx];
  if (!confirm(`Delete this sale (${s.product} × ${gal(s.qty)}, ₱${f2(s.amount)})?`)) return;
  db.sales.splice(idx, 1);
  saveDB();
  flash("Sale deleted.");
  nav("#/sales?date=" + btn.dataset.date);
}

/* --- inventory --- */

function doInventoryCount(user, form) {
  const date = fieldVal(form, "count_date") || phtToday();
  const notes = fieldTrim(form, "notes").slice(0, 120);
  let saved = 0;
  const now = phtNow();
  for (const item of db.inventory_items.filter((i) => i.active)) {
    const raw = fieldTrim(form, "qty_" + item.id);
    if (raw === "") continue;
    const qty = Math.floor(Number(raw));
    if (!Number.isFinite(qty) || qty < 0) return flash(`Count for ${item.name} must be 0 or more.`, "error");
    db.inventory_counts.push({
      id: Math.max(0, ...db.inventory_counts.map((c) => c.id)) + 1,
      item_id: item.id, count_date: date, qty, notes,
      recorded_by: user.id, created_at: now,
    });
    saved++;
  }
  saveDB();
  flash(saved ? `Stock take saved — ${saved} item${saved !== 1 ? "s" : ""}.` : "Nothing to save — all counts were blank.");
  nav("#/inventory");
}

function doItemAdd(form) {
  const name = fieldTrim(form, "name");
  if (name.length < 2) return flash("Item name must be at least 2 characters.", "error");
  if (db.inventory_items.find((i) => i.name.toLowerCase() === name.toLowerCase())) {
    return flash("That item already exists.", "error");
  }
  db.inventory_items.push({
    id: Math.max(0, ...db.inventory_items.map((i) => i.id)) + 1,
    name, active: 1,
  });
  saveDB();
  flash(`${name} added.`);
  nav("#/inventory");
}

function doItemRename(form) {
  const item = db.inventory_items.find((i) => i.id === Number(form.dataset.item));
  if (!item) return;
  item.name = fieldTrim(form, "name") || item.name;
  saveDB();
  flash("Item renamed.");
  nav("#/inventory");
}

function doItemToggle(btn) {
  const item = db.inventory_items.find((i) => i.id === Number(btn.dataset.item));
  if (!item) return;
  item.active = item.active ? 0 : 1;
  saveDB();
  flash(`${item.name} ${item.active ? "activated" : "deactivated"}.`);
  nav("#/inventory");
}

function doLoan(user, form, direction) {
  const c = customerById(Number(fieldVal(form, "customer_id")));
  const qty = Math.floor(Number(fieldTrim(form, "qty")));
  if (!c) return flash("Pick a customer.", "error");
  if (!Number.isFinite(qty) || qty < 1) return flash("How many jugs?", "error");
  const outNow = db.jug_loans.filter((l) => l.customer_id === c.id)
    .reduce((a, l) => a + l.qty, 0);
  if (direction === "return" && outNow - qty < 0) {
    return flash(`${c.name} only has ${outNow} jug${outNow !== 1 ? "s" : ""} out — can't take back ${qty}.`, "error");
  }
  db.jug_loans.push({
    id: Math.max(0, ...db.jug_loans.map((l) => l.id)) + 1,
    customer_id: c.id, qty: direction === "lend" ? qty : -qty,
    notes: "", recorded_by: user.id, created_at: phtNow(),
  });
  saveDB();
  flash(direction === "lend"
    ? `Lent ${qty} jug${qty !== 1 ? "s" : ""} to ${c.name}.`
    : `Took back ${qty} jug${qty !== 1 ? "s" : ""} from ${c.name}.`);
  nav("#/inventory");
}

/* --- users --- */

function userOnLedger(u) {
  return db.stops.find((s) => s.recorded_by === u.id) ||
    db.sales.find((s) => s.recorded_by === u.id) ||
    db.trips.find((t) => t.opened_by === u.id || t.closed_by === u.id);
}

function doAddUser(form) {
  const username = fieldTrim(form, "username");
  const password = fieldVal(form, "password");
  const role = fieldVal(form, "role");
  if (username.length < 2 || username.length > 30) return flash("Username must be 2–30 characters.", "error");
  if (db.users.find((u) => u.username.toLowerCase() === username.toLowerCase())) {
    return flash("That username is taken.", "error");
  }
  if (password.length < 4) return flash("Password or PIN must be at least 4 characters.", "error");
  const u = {
    id: Math.max(0, ...db.users.map((x) => x.id)) + 1,
    username, password, role, active: 1,
  };
  db.users.push(u);
  if (role === "driver") {
    db.drivers.push({
      id: Math.max(0, ...db.drivers.map((d) => d.id)) + 1,
      user_id: u.id, name: fieldTrim(form, "name") || username, active: 1,
    });
  }
  saveDB();
  flash(`User ${username} added${role === "driver" ? " — driver profile created" : ""}.`);
  nav("#/users");
}

function doUserToggle(btn) {
  const u = userById(Number(btn.dataset.user));
  if (!u) return;
  const activeOwners = db.users.filter((x) => x.role === "owner" && x.active).length;
  if (u.role === "owner" && u.active && activeOwners <= 1) {
    return flash("Can't disable the last active owner.", "error");
  }
  u.active = u.active ? 0 : 1;
  saveDB();
  flash(`${u.username} ${u.active ? "enabled" : "disabled"}${u.active ? "" : " — their access ends on their next request."}`);
  nav("#/users");
}

function doUserRename(form) {
  const u = userById(Number(form.dataset.user));
  if (!u) return;
  const username = fieldTrim(form, "username");
  if (username.length < 2 || username.length > 30) return flash("Username must be 2–30 characters.", "error");
  if (db.users.find((x) => x.id !== u.id && x.username.toLowerCase() === username.toLowerCase())) {
    return flash("That username is taken.", "error");
  }
  u.username = username;
  const profile = db.drivers.find((d) => d.user_id === u.id);
  if (profile) profile.name = username;
  saveDB();
  flash("Username updated.");
  nav("#/users");
}

function doUserReset(form) {
  const u = userById(Number(form.dataset.user));
  if (!u) return;
  const password = fieldVal(form, "password");
  if (password.length < 4) return flash("Password or PIN must be at least 4 characters.", "error");
  u.password = password;
  saveDB();
  flash(`Password reset for ${u.username}.`);
  nav("#/users");
}

function doUserDelete(btn) {
  const u = userById(Number(btn.dataset.user));
  if (!u || u.role === "owner") return;
  if (!confirm(`Delete ${u.username}?`)) return;
  if (userOnLedger(u)) {
    return flash(`${u.username} is on the ledger (recorded trips/sales) and can't be deleted — disable instead.`, "error");
  }
  db.users = db.users.filter((x) => x.id !== u.id);
  db.drivers = db.drivers.filter((d) => d.user_id !== u.id);
  saveDB();
  flash(`${u.username} deleted.`);
  nav("#/users");
}

/* --- CSV export (client-side, mirrors the real app's report exports) --- */

const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

function downloadCSV(filename, rows) {
  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
}

function doExportStops(rangeKey) {
  const { from, to } = rangeDates(rangeKey);
  const rows = [["trip_date", "driver", "customer", "qty", "unit_price", "amount", "cash_collected", "concession", "recorded_by"]];
  for (const t of db.trips.filter((t) => t.trip_date >= from && t.trip_date <= to).sort((a, b) => a.trip_date.localeCompare(b.trip_date))) {
    for (const s of tripStops(t.id)) {
      rows.push([t.trip_date, driverLabel(t.driver_id), customerLabel(s.customer_id),
        s.qty ?? "", s.unit_price ?? "", f2(s.amount), f2(s.cash_collected), f2(s.concession),
        recordedByLabel(s.recorded_by) || ""]);
    }
  }
  downloadCSV(`tubigan-${from}-to-${to}.csv`, rows);
}

function doExportSales(rangeKey) {
  const { from, to } = rangeDates(rangeKey);
  const rows = [["sale_date", "product", "qty", "unit_price", "amount", "recorded_by"]];
  for (const s of db.sales.filter((s) => s.sale_date >= from && s.sale_date <= to).sort((a, b) => a.sale_date.localeCompare(b.sale_date))) {
    rows.push([s.sale_date, s.product, s.qty, f2(s.unit_price), f2(s.amount), recordedByLabel(s.recorded_by) || ""]);
  }
  downloadCSV(`tubigan-sales-${from}-to-${to}.csv`, rows);
}

/* --------------------------------------------- delegated events */

// Forms + action buttons (click/submit delegation — the DOM is re-rendered
// wholesale, so no listener is ever lost).
document.addEventListener("submit", (e) => {
  const form = e.target.closest("form[data-action]");
  const user = currentUser();

  // date-picker forms just navigate (#/trips?date=… / #/sales?date=…)
  const navForm = e.target.closest("form[data-nav]");
  if (navForm) {
    e.preventDefault();
    const date = navForm.querySelector('input[type="date"]')?.value;
    nav(navForm.dataset.nav + (date ? "?date=" + date : ""));
    return;
  }
  if (!form) return;
  e.preventDefault();
  const action = form.dataset.action;
  if (action === "login") return doLogin(form); // runs while signed out
  if (!user) return;

  switch (action) {
    case "open-trip": return doOpenTrip(user, form);
    case "add-stop": return doAddStop(user, form);
    case "save-stop": return doSaveStop(user, form);
    case "close-trip": return doCloseTrip(user, form);
    case "add-customer": return doAddCustomer(form);
    case "customer-rename": return doCustomerRename(form);
    case "customer-price": return doCustomerPrice(form);
    case "add-price": return doAddPrice(form);
    case "price-update": return doPriceUpdate(form);
    case "sale-record": return doSaleRecord(user);
    case "sale-custom": return doSaleCustom(user, form);
    case "inventory-count": return doInventoryCount(user, form);
    case "item-add": return doItemAdd(form);
    case "item-rename": return doItemRename(form);
    case "loan": {
      const direction = form.querySelector("button[name='direction']:focus")?.value
        || form.getAttribute("data-direction") || "lend";
      return doLoan(user, form, direction);
    }
    case "add-user": return doAddUser(form);
    case "user-rename": return doUserRename(form);
    case "user-reset": return doUserReset(form);
  }
});

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  if (btn.tagName === "FORM" || btn.closest("form[data-action]")) return; // handled by submit

  switch (action) {
    case "demo-login": {
      const u = db.users.find((x) => x.username === btn.dataset.user);
      if (u && u.password === btn.dataset.pin && u.active) {
        signIn(u);
        flash(greeting(), "greet");
        nav(homeHash(u));
      }
      return;
    }
    case "logout":
      e.preventDefault();
      signOut();
      nav("#/login");
      return;
    case "reset-demo": {
      if (!confirm("Reset the demo data? Every change goes back to the original sample ledger.")) return;
      localStorage.removeItem(DB_KEY);
      signOut();
      db = loadDB();
      flash("Demo data reset — you're back to the sample ledger.", "greet");
      nav("#/login");
      return;
    }
    case "delete-stop": {
      const user = currentUser();
      if (user) doDeleteStop(user, btn);
      return;
    }
    case "reopen-trip": {
      const user = currentUser();
      if (user) doReopenTrip(user, btn);
      return;
    }
    case "customer-toggle": {
      const user = currentUser();
      if (user) doCustomerToggle(btn);
      return;
    }
    case "customer-delete": {
      const user = currentUser();
      if (user) doCustomerDelete(btn);
      return;
    }
    case "price-toggle": {
      const user = currentUser();
      if (user) doPriceToggle(btn);
      return;
    }
    case "sale-delete": {
      const user = currentUser();
      if (user) doSaleDelete(btn);
      return;
    }
    case "item-toggle": {
      const user = currentUser();
      if (user) doItemToggle(btn);
      return;
    }
    case "user-toggle": {
      const user = currentUser();
      if (user) doUserToggle(btn);
      return;
    }
    case "user-delete": {
      const user = currentUser();
      if (user) doUserDelete(btn);
      return;
    }
    case "export-csv": {
      e.preventDefault();
      doExportStops(btn.dataset.range || "month");
      return;
    }
    case "export-sales-csv": {
      e.preventDefault();
      doExportSales(btn.dataset.range || "month");
      return;
    }
  }
});

// --- UI-only behaviors, ported from the real app.js verbatim ---

// Stop form pre-fill chain (options carry data-price / data-qty / data-amount):
// standing gallons → fills Gallons; custom/list price → fills Price;
// flat amount → fills Cash and clears gallons/price (records a flat stop).
document.addEventListener("change", (e) => {
  const sel = e.target.closest("#stop-customer");
  if (!sel) return;
  const option = sel.selectedOptions[0];
  if (!option) return;
  const form = sel.closest("form");
  const qty = form?.querySelector('input[name="qty"]');
  const price = form?.querySelector("#stop-price");
  const cash = form?.querySelector('input[name="cash_collected"]');
  if (option.dataset.qty && qty) qty.value = option.dataset.qty;
  if (option.dataset.price && price) price.value = option.dataset.price;
  // A flat amount fills cash and clears gallons/price (submitting records a
  // flat per-visit stop). A gallon customer always leaves cash blank —
  // stale cash from a previous flat pick would fake a concession.
  if (cash) cash.value = option.dataset.amount || "";
  if (option.dataset.amount) {
    if (qty) qty.value = "";
    if (price) price.value = "";
  }
});

// Custom sale price pre-fill from the selected product.
document.addEventListener("change", (e) => {
  const sel = e.target.closest("#sale-product");
  if (!sel) return;
  const option = sel.selectedOptions[0];
  const price = document.getElementById("sale-price");
  if (option && option.dataset.price && price) price.value = option.dataset.price;
});

// Customers tab search — filters the table in the browser only.
document.addEventListener("input", (e) => {
  if (e.target.id !== "customer-search") return;
  const table = document.getElementById("customers-table");
  if (!table) return;
  const q = e.target.value.trim().toLowerCase();
  let shown = 0;
  table.querySelectorAll("tbody tr").forEach((tr) => {
    const hit = tr.textContent.toLowerCase().includes(q);
    tr.hidden = !hit;
    if (hit) shown++;
  });
  const emptyMsg = document.getElementById("no-customer-match");
  if (emptyMsg) emptyMsg.hidden = shown !== 0;
});

// ⋯ menus: one open at a time; clicking elsewhere closes them.
document.addEventListener("click", (e) => {
  const toggle = e.target.closest(".js-menu-toggle");
  document.querySelectorAll(".action-menu .menu-panel:not([hidden])").forEach((panel) => {
    if (!panel.parentElement.contains(toggle)) panel.hidden = true;
  });
  if (!toggle) return;
  const panel = toggle.parentElement.querySelector(".menu-panel");
  if (!panel) return;
  panel.hidden = !panel.hidden;
  toggle.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
});

// Customers/Prices/Inventory: Edit / Pricing reveal their inline forms.
document.addEventListener("click", (e) => {
  const editBtn = e.target.closest(".js-toggle-edit");
  const priceBtn = e.target.closest(".js-toggle-pricing");
  if (!editBtn && !priceBtn) return;
  const cell = e.target.closest("td.actions");
  if (!cell) return;
  const editForm = cell.querySelector(".rename-form");
  const priceForm = cell.querySelector(".price-form");
  if (editBtn && !editForm) return;
  if (priceBtn && !priceForm) return;
  const menuPanel = cell.querySelector(".menu-panel");
  if (menuPanel) menuPanel.hidden = true;
  if (editBtn) {
    editForm.hidden = !editForm.hidden;
    if (priceForm) priceForm.hidden = true;
    if (!editForm.hidden) {
      const firstInput = editForm.querySelector('input:not([type="hidden"])');
      if (firstInput) firstInput.focus();
    }
  } else {
    priceForm.hidden = !priceForm.hidden;
    editForm.hidden = true;
  }
});

// Users tab: Edit username / Reset password reveals (one at a time).
document.addEventListener("click", (e) => {
  const resetBtn = e.target.closest(".js-reset-toggle");
  const renameBtn = e.target.closest(".js-rename-toggle");
  if (!resetBtn && !renameBtn) return;
  const cell = e.target.closest("td.actions");
  if (!cell) return;
  const form = cell.querySelector(resetBtn ? ".reset-form" : ".rename-form");
  const other = cell.querySelector(resetBtn ? ".rename-form" : ".reset-form");
  if (!form) return;
  const menuPanel = cell.querySelector(".menu-panel");
  if (menuPanel) menuPanel.hidden = true;
  if (other) other.hidden = true;
  form.hidden = !form.hidden;
  if (!form.hidden) {
    const input = form.querySelector('input:not([type="hidden"])');
    if (input) input.focus();
  }
});

// Sales POS tiles: tap = +1 gallon; −/+ adjust the lines; Record commits.
document.addEventListener("click", (e) => {
  const tile = e.target.closest(".pos-tile");
  if (tile) {
    const id = tile.dataset.id;
    const line = pos.get(id) || { qty: 0, price: parseFloat(tile.dataset.price), name: tile.dataset.name };
    line.qty += 1;
    pos.set(id, line);
    renderTally();
    return;
  }
  if (e.target.closest("#tally-bar")) {
    const btn = e.target.closest("button.tally-plus, button.tally-minus, button.tally-remove");
    if (!btn || !btn.dataset.id) return;
    const line = pos.get(btn.dataset.id);
    if (!line) return;
    if (btn.classList.contains("tally-plus")) line.qty += 1;
    else if (btn.classList.contains("tally-minus")) line.qty -= 1;
    if (line.qty <= 0 || btn.classList.contains("tally-remove")) pos.delete(btn.dataset.id);
    renderTally();
  }
});

// Sales: custom-price panel reveal toggle.
document.addEventListener("click", (e) => {
  if (!e.target.closest(".js-custom-toggle")) return;
  const panel = document.getElementById("custom-sale-panel");
  if (!panel) return;
  panel.hidden = !panel.hidden;
  e.target.closest(".js-custom-toggle").textContent =
    panel.hidden ? "+ Custom price" : "− Hide custom price";
});

// Mascot: keep the hang offset in sync with the header's real height.
window.addEventListener("resize", syncMascot);

// The "Lend / Take back" pair submits one form — remember which button was
// pressed before the delegated submit handler runs.
document.addEventListener("click", (e) => {
  const dirBtn = e.target.closest("button[name='direction']");
  if (!dirBtn) return;
  const form = dirBtn.closest("form");
  if (form) form.setAttribute("data-direction", dirBtn.value);
});

window.addEventListener("hashchange", render);
render();
