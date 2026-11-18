// Tubigan Tracker — static portfolio demo.
// data.js builds the seeded sample ledger. No server: the whole "database"
// is a plain JS object (same shape as the Flask app's SQLite schema) that
// app.js keeps in localStorage. Dates are computed relative to *today*
// (Asia/Manila) so the demo always looks like it was used yesterday.
//
// This file only DATA — every rule (money math, settlement, roles) lives in
// app.js, mirroring how the real app keeps logic in one place.

const DEMO_SEED_VERSION = "2026-11-18";
const APP_NAME = "MariClaire Water Delivery";

// ---- Philippine-time helpers (the real app never uses server UTC) ----

function phtToday() {
  // "YYYY-MM-DD" in Asia/Manila, whatever the viewer's clock says.
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

function phtTimeParts(dateStr, h, m) {
  // ISO-ish timestamp "YYYY-MM-DDTHH:MM" for a Manila date + fixed clock time.
  return dateStr + "T" + String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

function addDays(dateStr, n) {
  const t = Date.parse(dateStr + "T00:00:00Z") + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

// ---- deterministic PRNG so the sample ledger is stable across loads ----

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildSeed() {
  const rnd = mulberry32(20261118);
  const today = phtToday();
  const d = (n) => addDays(today, -n); // "n days ago"
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  let nextId = 1;
  const nid = () => nextId++;

  // ---- users & drivers (owner + 1 dispatcher + 3 drivers + 1 disabled trainee) ----
  const users = [
    { id: nid(), username: "owner",    password: "1111", role: "owner",      active: 1 },
    { id: nid(), username: "dispatch", password: "2222", role: "dispatcher", active: 1 },
    { id: nid(), username: "marlon",   password: "3333", role: "driver",     active: 1 },
    { id: nid(), username: "jessica",  password: "4444", role: "driver",     active: 1 },
    { id: nid(), username: "ronel",    password: "5555", role: "driver",     active: 1 },
    { id: nid(), username: "paolo",    password: "6666", role: "driver",     active: 0 },
  ];
  const OWNER = 1, DISPATCH = 2;
  const MARLON = 3, JESSICA = 4, RONEL = 5;

  // A driver *user* auto-creates a driver profile (same rule as the real
  // Users tab); the disabled trainee keeps an inactive profile too.
  const drivers = [
    { id: nid(), user_id: users[2].id, name: "Marlon",  active: 1 },
    { id: nid(), user_id: users[3].id, name: "Jessica", active: 1 },
    { id: nid(), user_id: users[4].id, name: "Ronel",   active: 1 },
    { id: nid(), user_id: users[5].id, name: "Paolo",   active: 0 },
  ];
  const DRIVER_OF = { [MARLON]: drivers[0].id, [JESSICA]: drivers[1].id, [RONEL]: drivers[2].id };

  // ---- prices (same seed items as the real app's first run) ----
  const prices = [
    { id: nid(), product: "Round 5-gal refill", unit_price: 35, active: 1 },
    { id: nid(), product: "Slim 5-gal refill",  unit_price: 30, active: 1 },
  ];

  // ---- customers: a mix of plain, custom-price, standing-gallons and
  //      flat-per-visit setups so every pre-fill path is demonstrated ----
  const customers = [
    { id: nid(), name: "Elena Reyes",               contact: "0917-442-1188", address: "Purok 3, Rizal St",        custom_price: 35, standing_qty: 2,   standing_amount: null, active: 1 },
    { id: nid(), name: "Mang Ben's Sari-sari Store",contact: "0918-220-7745", address: "Quezon Ave",               custom_price: null, standing_qty: 3, standing_amount: null, active: 1 },
    { id: nid(), name: "Dr. Santos Clinic",         contact: "0917-555-0143", address: "Mabini St",                custom_price: null, standing_qty: null, standing_amount: 150, active: 1 },
    { id: nid(), name: "Aling Rosa Carinderia",     contact: "0921-776-3310", address: "Purok 5",                  custom_price: 33, standing_qty: null, standing_amount: null, active: 1 },
    { id: nid(), name: "Jeric Mendoza",             contact: "0916-303-9921", address: "Sampaguita St",            custom_price: null, standing_qty: null, standing_amount: null, active: 1 },
    { id: nid(), name: "Kat's Salon",               contact: "0917-811-4562", address: "Purok 2",                  custom_price: null, standing_qty: null, standing_amount: null, active: 1 },
    { id: nid(), name: "Lolo Iñigo",                contact: "0919-664-2287", address: "Purok 7",                  custom_price: null, standing_qty: 1,   standing_amount: null, active: 1 },
    { id: nid(), name: "Sampaguita Internet Café",  contact: "0917-233-8890", address: "National Rd",              custom_price: null, standing_qty: null, standing_amount: null, active: 1 },
    { id: nid(), name: "Thea Villanueva",           contact: "0927-114-5509", address: "Purok 4 (far route)",      custom_price: 40, standing_qty: null, standing_amount: null, active: 1 },
    { id: nid(), name: "Brgy Health Center",        contact: "0917-900-3311", address: "Purok 1",                  custom_price: null, standing_qty: 4,   standing_amount: null, active: 1 },
    { id: nid(), name: "Carlo & Mia's Sari-sari",   contact: "0918-447-2210", address: "Purok 6",                  custom_price: null, standing_qty: null, standing_amount: null, active: 1 },
    { id: nid(), name: "Grace Lim",                 contact: "0932-118-4409", address: "Bayanan",                  custom_price: null, standing_qty: null, standing_amount: null, active: 0 },
  ];
  const activeCustomers = customers.filter((c) => c.active);

  // ---- stops & trips: 13 days of settled history + 2 open trips today ----
  const trips = [];
  const stops = [];

  const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

  // one stop; when `by` is a driver user the row carries the 🚚 flag
  function addStop(tripId, dateStr, { customer, qty, price, cashOverride, by, hh, mm }) {
    let amount, cash, concession;
    if (qty !== null && qty !== undefined && qty > 0) {
      amount = round2(qty * price);
      cash = cashOverride !== undefined ? cashOverride : amount;
      concession = round2(amount - cash);
    } else {
      // flat per-visit stop: qty/price stay NULL, amount = cash typed
      amount = cashOverride; cash = cashOverride; concession = 0;
    }
    stops.push({
      id: nid(), trip_id: tripId,
      customer_id: customer ? customer.id : null,
      qty: qty || null, unit_price: qty ? price : null,
      amount, cash_collected: cash, concession,
      recorded_by: by,
      created_at: phtTimeParts(dateStr, hh, mm),
    });
  }

  function makeTrip(dateStr, driverId, { openedBy, seen, status, remitted, closedBy, notes }) {
    const t = {
      id: nid(), trip_date: dateStr, driver_id: driverId,
      status: status, cash_remitted: remitted, closed_at: null, closed_by: null,
      notes: notes || "", opened_by: openedBy, seen_by_driver_at: seen,
    };
    if (status === "closed") {
      t.closed_at = phtTimeParts(dateStr, 17, 5 + Math.floor(rnd() * 40));
      t.closed_by = closedBy;
    }
    trips.push(t);
    return t;
  }

  const round = (by) => (rnd() < 0.8 ? 35 : 30); // mostly Round @ ₱35

  function seedDayTrip(dateStr, driverId, by, opts = {}) {
    const t = makeTrip(dateStr, driverId, {
      openedBy: opts.openedBy !== undefined ? opts.openedBy : (rnd() < 0.6 ? DISPATCH : null),
      seen: phtTimeParts(dateStr, 8, 10),
      status: "closed", remitted: null, closedBy: OWNER,
      notes: opts.notes,
    });
    const n = opts.stops || (2 + Math.floor(rnd() * 5));
    for (let i = 0; i < n; i++) {
      const isWalkIn = rnd() < 0.2;
      let customer = null, qty, price;
      if (isWalkIn) {
        qty = 1 + Math.floor(rnd() * 3);
        price = round();
      } else {
        customer = pick(activeCustomers);
        qty = customer.standing_qty || 1 + Math.floor(rnd() * 3);
        price = customer.custom_price || round();
      }
      // occasionally a concession (charged ₱5–₱10 less) or a round-up
      let cashOverride;
      const roll = rnd();
      if (roll < 0.12) cashOverride = round2(qty * price - 5);
      else if (roll < 0.18) cashOverride = round2(qty * price + 4);
      addStop(t.id, dateStr, {
        customer, qty, price, cashOverride, by,
        hh: 8 + Math.floor(rnd() * 6), mm: Math.floor(rnd() * 60),
      });
    }
    const total = round2(stops.filter((s) => s.trip_id === t.id)
      .reduce((sum, s) => sum + s.cash_collected, 0));
    t.cash_remitted = opts.remitted !== undefined ? opts.remitted : total;
    return t;
  }

  // 13 days of history — 2 or 3 drivers per day, Ronel occasionally off.
  for (let back = 13; back >= 1; back--) {
    const day = d(back);
    const roster = [DRIVER_OF[MARLON], DRIVER_OF[JESSICA]];
    if (rnd() < 0.7) roster.push(DRIVER_OF[RONEL]);
    for (const driverId of roster) {
      seedDayTrip(day, driverId, DISPATCH);
    }
  }

  // Featured trips so the settlement story is always visible:
  // T-9 Marlon came up ₱50 SHORT; T-4 Jessica remitted ₱20 too much (OVER).
  const shortTrip = trips.find((t) => t.trip_date === d(9) && t.driver_id === DRIVER_OF[MARLON]);
  if (shortTrip) shortTrip.cash_remitted = round2(
    stops.filter((s) => s.trip_id === shortTrip.id).reduce((a, s) => a + s.cash_collected, 0) - 50);
  const overTrip = trips.find((t) => t.trip_date === d(4) && t.driver_id === DRIVER_OF[JESSICA]);
  if (overTrip) overTrip.cash_remitted = round2(
    stops.filter((s) => s.trip_id === overTrip.id).reduce((a, s) => a + s.cash_collected, 0) + 20);

  // T-6 Marlon's whole run was recorded by the driver himself → 🚚 flags
  // waiting for dispatcher verification at settlement (trip is closed/matched).
  seedDayTrip(d(6), DRIVER_OF[MARLON], MARLON, { stops: 4, openedBy: null, notes: "driver recorded his own run" });

  // ---- today: one dispatcher-requested open trip (unseen → the 🔔 bell)
  //      and one already-seen open trip with a walk-in stop ----
  const tTodayA = makeTrip(today, DRIVER_OF[MARLON], {
    openedBy: DISPATCH, seen: null, status: "open", remitted: null, closedBy: null,
    notes: "morning route",
  });
  addStop(tTodayA.id, today, { customer: customers[0], qty: 2, price: 35, by: DISPATCH, hh: 7, mm: 40 });
  addStop(tTodayA.id, today, { customer: customers[1], qty: 3, price: 35, by: DISPATCH, hh: 7, mm: 42 });

  const tTodayB = makeTrip(today, DRIVER_OF[JESSICA], {
    openedBy: DISPATCH, seen: phtTimeParts(today, 8, 5), status: "open", remitted: null, closedBy: null,
  });
  addStop(tTodayB.id, today, { customer: null, qty: 2, price: 35, by: DISPATCH, hh: 8, mm: 15 });

  // ---- counter sales (kept separate from delivery money, like the real app) ----
  const sales = [];
  function addSale(dateStr, product, qty, unitPrice, by, hh, mm) {
    sales.push({
      id: nid(), sale_date: dateStr, product,
      qty, unit_price: unitPrice, amount: round2(qty * unitPrice),
      recorded_by: by, created_at: phtTimeParts(dateStr, hh, mm),
    });
  }
  addSale(today, "Round 5-gal refill", 2, 35, DISPATCH, 8, 12);
  addSale(today, "Slim 5-gal refill", 1, 30, DISPATCH, 9, 47);
  addSale(today, "Round 5-gal refill", 3, 35, OWNER, 11, 3);
  for (const back of [1, 2, 3, 5, 6, 8, 9, 11, 12]) {
    const day = d(back);
    const n = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const slim = rnd() < 0.3;
      addSale(day, slim ? "Slim 5-gal refill" : "Round 5-gal refill",
        1 + Math.floor(rnd() * 3), slim ? 30 : 35, rnd() < 0.5 ? DISPATCH : OWNER,
        9 + Math.floor(rnd() * 8), Math.floor(rnd() * 60));
    }
  }

  // ---- inventory: stock takes + jugs out with customers ----
  const inventory_items = [
    { id: nid(), name: "Round jugs", active: 1 },
    { id: nid(), name: "Slim jugs",  active: 1 },
    { id: nid(), name: "Caps",       active: 1 },
  ];
  const inventory_counts = [
    { id: nid(), item_id: inventory_items[0].id, count_date: today, qty: 42, notes: "morning count", recorded_by: OWNER, created_at: phtTimeParts(today, 7, 30) },
    { id: nid(), item_id: inventory_items[1].id, count_date: today, qty: 18, notes: "morning count", recorded_by: OWNER, created_at: phtTimeParts(today, 7, 30) },
    { id: nid(), item_id: inventory_items[2].id, count_date: today, qty: 60, notes: "", recorded_by: OWNER, created_at: phtTimeParts(today, 7, 31) },
    { id: nid(), item_id: inventory_items[0].id, count_date: d(1), qty: 30, notes: "after deliveries", recorded_by: OWNER, created_at: phtTimeParts(d(1), 18, 10) },
    { id: nid(), item_id: inventory_items[1].id, count_date: d(1), qty: 12, notes: "", recorded_by: OWNER, created_at: phtTimeParts(d(1), 18, 10) },
  ];
  const jug_loans = [
    { id: nid(), customer_id: customers[0].id, qty: 2,  notes: "", recorded_by: DISPATCH, created_at: phtTimeParts(d(5), 10, 20) },
    { id: nid(), customer_id: customers[1].id, qty: 3,  notes: "", recorded_by: DISPATCH, created_at: phtTimeParts(d(2), 9, 5) },
    { id: nid(), customer_id: customers[8].id, qty: 1,  notes: "", recorded_by: DISPATCH, created_at: phtTimeParts(d(8), 11, 0) },
    { id: nid(), customer_id: customers[8].id, qty: -1, notes: "returned", recorded_by: DISPATCH, created_at: phtTimeParts(d(3), 15, 40) },
  ];

  return {
    seed_version: DEMO_SEED_VERSION,
    users, drivers, customers, prices, trips, stops, sales,
    inventory_items, inventory_counts, jug_loans,
  };
}
