# Tubigan Tracker — Portfolio Demo (static)

A **static, self-contained replica** of the MariClaire Water Delivery tracker
(Flask + SQLite in production; pure HTML/CSS/JS here). Everything runs in the
browser: the sample ledger is seeded by `data.js`, stored in `localStorage`,
and `app.js` plays the server's role — money math, settlement, role checks.

**No server, no build step, no dependencies.** Open `index.html` in any
browser, or serve the folder with any static host (GitHub Pages, Netlify, …).

## Demo logins (also shown on the sign-in page)

| Role       | Username   | PIN  | Sees |
|------------|-----------|------|------|
| Owner      | `owner`   | 1111 | Dashboard · Delivery · Sales · Customers · Prices · Inventory · Reports · Users |
| Dispatcher | `dispatch`| 2222 | Delivery · Sales · Customers |
| Driver     | `marlon`  | 3333 | My Deliveries (one-click buttons sign you in) |

## What to try

- **Delivery** — open a delivery for a driver, record gallon trips and
  walk-ins (customer pricing pre-fills the form: custom price, standing
  gallons, or a flat ₱/visit), then close the delivery — the settlement shows
  the cash discrepancy, it's never forced. History includes one trip that
  came up ₱50 **short** and one that was **over**.
- **🚚 flags** — trips recorded by a driver are marked for dispatcher
  verification at settlement (see the closed trip ~6 days back, "driver
  recorded his own run").
- **Reports** — per-driver, day-by-day chart, counter sales, settlement
  discrepancies, CSV export.
- **Users** — add a driver account; it appears immediately in "Open a
  delivery". The last active owner can't be disabled.
- **Reset demo data** — banner button puts the sample ledger back to factory
  state anytime.

## Relationship to the real app

The production tracker is a Flask + SQLite app (sessions, hashed passwords,
server-side role enforcement, Asia/Manila date handling, price snapshots).
This demo mirrors its UI and rules but is **client-side only** — the data is
fake, passwords are stored in plain text, and nothing leaves the browser.
It exists so reviewers can click through the product without a server.
