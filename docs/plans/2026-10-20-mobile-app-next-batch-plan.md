# Mobile app — status and next batch

**Deadline: November 1, 2026 (11 days out from 2026-10-20).**

Tracks `apps/mobile`. Delete this file once the batch below ships — git history
keeps it.

---

## Done

**Scaffold & infra**
- Expo + Expo Router, TypeScript, React Native Paper (MD3), TanStack Query,
  FlashList, Reanimated.
- Theme ported from web's exact color tokens (light + an original dark
  palette — web itself has no dark mode); 8px grid, 44px touch targets,
  system fonts (no custom font loaded).
- Axios client, SecureStore-backed access token, 401 → logout.

**Auth**
- Email/password login, "remember me" email, explicit "Remember password for
  Face ID / Touch ID" checkbox (opt-in, only on biometric-capable devices).
- Refresh token fix shipped 2026-10-20 (see item 1 below) — sessions now
  persist past the 15-minute access-token TTL via `/auth/refresh-mobile`,
  not yet device-verified end to end.

**Dashboard** — bank balance, overdue invoices, AI inbox count, recent
transactions feed, pull-to-refresh.

**Transactions** — unified list with type filter chips, search,
pull-to-refresh, tap-through to detail.

**Transaction detail** — read-only, stacked layout for deposit / expense /
check / journal entry. Other unified-transaction types show a "not available
on mobile yet" screen. No editing yet (item 4 below).

**General Ledger** — period presets + account filter, collapsible
per-account sections (beginning/ending balance, debit/credit/running
balance per line). Read-only.

**Invoices** — list (All/Open/Overdue/Paid filters), detail with line items
and amount due. "Pay Now" renders disabled with an explanation: no Stripe or
any payment processor exists anywhere in this backend today, so a real
payment flow needs a backend decision (new dependency, webhook, an auth
model for an unauthenticated payer) before it can be built.

**Customers** — list (search, open balance) and detail (contact info,
open balance, their invoices). Business switcher lives in this tab.

**Not started yet:** everything in the batch below.

---

## Next batch (priority order)

### 1. Refresh token fix — done 2026-10-20
Backend:
- `POST /auth/refresh-mobile`, body `{ refresh_token }`, response
  `{ access_token, refresh_token }`. `POST /auth/logout-mobile` revokes one
  server-side (the client-only logout before this never actually revoked
  anything on the server).
- Reused the existing `refresh_tokens` table rather than a new one — added a
  `token_type` column (`'web' | 'mobile'`, migration `0106`); rotation,
  single-use revoke-on-rotate, and revoke-on-logout were already generic in
  `authService.ts`, keyed by raw token hash regardless of transport.
  Mobile tokens get a 30-day TTL (`JWT_MOBILE_REFRESH_TTL_DAYS`) vs. the
  web's 180; `/auth/login` takes an optional `client: 'mobile'` to tag which
  kind it issues. A token can only be redeemed on the route matching its
  type — a mobile token replayed at the cookie route (or vice versa) is
  rejected, so a leaked token can't silently inherit the other channel's TTL.
- Covered by 7 new integration tests in `authRoute.test.ts` (mobile login
  shape, rotation, single-use reuse-rejection, cross-channel rejection,
  logout-mobile revocation); full 484-test API suite still green.

Mobile:
- `services/apiClient.ts` stores the refresh token in SecureStore alongside
  the access token. On a 401 (not from `/auth/login` or
  `/auth/refresh-mobile` itself), the interceptor calls `/auth/refresh-mobile`
  once (concurrent 401s share one in-flight refresh), retries the original
  request with the new access token, and only logs out if that refresh
  itself fails.
- `useAuth.tsx`'s cold-start check now also tries `/me` when only a refresh
  token survived (not just a non-expired access token), and `logout()` calls
  `/auth/logout-mobile` to revoke server-side before clearing local storage.

**Not yet verified:** an actual background/foreground cycle and app restart
on a device/simulator — the integration tests cover the server contract and
the interceptor logic was written to match it, but nothing here was run
through Expo Go or the simulator yet.

### 2. Vendor list and detail — done 2026-10-20
- Clients tab now has a Customers/Vendors segmented toggle; both lists
  pull-to-refresh.
- Vendor detail: open balance, contact info (tappable email/phone/website),
  account number, 1099 flag, notes, plus a Details/Transactions segmented
  toggle. Transactions tab uses the unified transactions endpoint's
  `contact_id` filter (bills, checks, expenses, vendor credits — every AP
  type, not just one), tapping through to the existing transaction detail
  screen. Pull-to-refresh on both tabs.
- Found and fixed a real bug while building this: `GET /customers/:id` and
  `GET /vendors/:id` don't return `open_balance` (list-only computed
  field) — the customer detail screen was reading it off that response
  anyway and silently showing $0.00 regardless of the real balance. Both
  detail screens now pull the balance from the cached list query instead.

### 3. Create/edit expense + deposit — done 2026-10-20
- **New Expense:** searchable payee picker (vendors, customers, or a
  one-off free-text name), searchable payment-account picker (filtered the
  same way the web app's `expensePaymentAccounts()` does — bank accounts
  then credit cards, ported into `lib/bankAccountOptions.ts`), native date
  picker, payment method, line items (searchable category picker +
  description + amount, "Add line"/remove line), reference, memo, live
  total, save.
- **New Deposit:** searchable bank-account picker (`statementBankAccounts()`,
  same port), native date picker, "other funds" lines (account +
  description + amount), memo, live total, save. Deposits that already have
  undeposited-funds lines (editing one) show those read-only — the API
  keeps them server-side regardless of what's resent, so the form only
  submits the other-funds subset it actually controls.
- **Edit existing:** "Edit" in the transaction detail header (expense/
  deposit only) opens the same form pre-filled from the real create/update
  endpoints' full response shape (vendor_id/customer_id/payment_account_id/
  category_account_id, not just display names — had to extend the mobile
  `ExpenseDetail`/`DepositDetail` types to carry the actual ids once I hit
  this while wiring up the edit form).
- A shared `SearchablePicker` modal (in-memory filter, `FlashList`-backed)
  and `PickerField`/`DateField` components back every dropdown/date input
  across both forms, so picking an account stays fast even with hundreds of
  accounts loaded — no network round trip per keystroke.
- Explicitly out of scope, per the brief: check writing, journal entry
  creation — stay on desktop.
- **Verified end to end** (no UI automation available in this environment —
  see the session's standing workaround note): created an expense via the
  exact same endpoint/body shape `ExpenseForm` posts, then confirmed via
  `GET /reports/general-ledger` that it landed as a balanced JE (debit to
  the expense category, credit to the payment account) — then voided it to
  clean up the test row. Confirms the request shape is right and the
  create → GL path works; the on-device tap-through flow itself still needs
  your own pass in Expo Go/the simulator.

### 4. AI Document Inbox — done 2026-10-20 (checkbox approve/reject; swipe not started)

**API gap-check done before building anything** (per instruction): the
mobile wrapper this screen was going to extend (`listPendingInbox`, hitting
`/integration-inbox`) turned out to be the wrong backend entirely — that's
an unrelated CSV-reconciliation inbox for Stripe/PayPal/Shopify matching.
The real AI Document Inbox lives in `emailImports.ts`
(`GET /email-imports`, `.../approve`, `.../reject`). Gaps found there,
flagged before writing any screen:
- **No grouped/label endpoint** — `GET /email-imports` groups by statement
  already, but there's no `document_name` field. Ported web's own
  `deriveBankTitle`/`deriveBankSubtitle` client-side derivation
  (`lib/emailImportLabel.ts`) instead of inventing a different label.
- **No real "partially reviewed" status** — only `pending/approved/
  rejected`. Inferred client-side from each line's `auto_posted` flag
  (`deriveImportStatus`).
- **No per-line PATCH.** Every edit (offset account, payee override,
  "remember") is bundled into one whole-statement `approve` call — so the
  review screen holds edits in local state only until Approve is tapped;
  there's no "save this line, come back later."
- **No `vendor_id` anywhere in this flow** — vendor "detection" is a
  free-text `payee_name` string, fuzzy-matched client-side against the
  vendor list (ported web's `bestVendorMatch`). Binding a line to a real
  vendor record isn't something the API supports today.
- **Reject is whole-statement only** — dropping one bad line is
  `include: false` on that line at approve time, not a separate action.

**What shipped, working within those constraints:**
- Inbox list (`app/inbox/index.tsx`): one card per statement with the
  derived title/subtitle and a status pill, pull-to-refresh.
- Statement review (`app/inbox/[id].tsx`): there's no `GET /email-imports/
  :id` either — reads from the same list query, same pattern already used
  for customer/vendor detail. A "statement account" picker up top (bank vs.
  card accounts, filtered the same way as the expense/deposit forms), then
  one card per line: description, signed amount, `ConfidenceBadge` (direct
  port of the web component, same colors/thresholds from
  `@accounting/shared`), an editable payee field and offset-account field
  (both via `SearchablePicker`, payee's footer offers "+ Add new vendor"
  calling the real `POST /vendors`), a per-row include checkbox, and a
  "remember this account for `<payee>`" checkbox. "Approve selected (`n`)"
  and "Reject" (confirm dialog) sit in a sticky footer.
- Checkbox approve/reject built and working first, per instruction; swipe
  gestures (swipe right to approve, swipe left to reject) **not started** —
  explicitly deprioritized as nice-to-have until the checkbox flow is
  confirmed working.
- Verified the real shapes against live pending data on the dev API (not
  just reading the schema): `GET /email-imports` on the demo business
  returned real rows matching the mobile types field-for-field. Didn't
  execute an actual approve/reject against that data since it's real
  seed/demo content, not a throwaway row — unlike the expense/GL check,
  this one stops at "the contract matches," not "and it posted correctly."

### 5. Camera capture → AI Inbox
- Camera button on the dashboard and in the AI Inbox screen (`expo-camera`
  or `expo-image-picker`; photo or gallery pick).
- Upload through the existing document-upload endpoint; show a
  "Processing…" state during AI extraction.
- Extracted data lands in the AI Inbox for review — replaces "email a PDF to
  Gmail" for one-off receipts.

### 6. Android testing
- Every screen on an Android emulator (Pixel 6 or similar), plus one small
  screen size.
- Fix platform-specific issues: navigation, keyboard handling, status bar,
  safe areas.
- Verify the `expo-dev-client` build on both platforms.

### 7. Push notifications, settings, app icon
- **Push:** Expo Notifications (covers APNs + FCM). Register device token on
  login, `push_tokens` table (`id, user_id, token, platform, created_at,
  last_used_at`). v1 notification types: "New documents ready for review"
  (AI inbox) and "Invoice paid" (once Stripe exists). Tapping a notification
  opens the relevant screen. Backend sends via Expo's push HTTP API.
- **Settings (More tab):** account info (name/email/role), biometric login
  toggle, push-notifications toggle, theme toggle (light/dark/system), about
  (version/build), sign out.
- **App icon & splash:** real brand mark through Expo's icon config (all iOS
  + Android sizes); splash = brand background + centered logo + brief
  fade-out. If no finalized logo yet, a clean text-based mark in brand
  colors/font is the fallback.

### 8. Polish: error handling and empty states
Sweep every screen:
- Network errors → "Something went wrong · Try again" with a retry button,
  never a crash or blank screen.
- Empty lists → friendly empty state (icon + message, e.g. "No transactions
  yet").
- Form validation → inline under the field, never an alert box.
- No raw error messages or stack traces ever reach the user.

---

## Suggested day-by-day pacing (11 days)
1. Refresh token fix
2. Vendor list
3–4. Create/edit expense (and deposit)
4–5. AI Document Inbox
5–6. Camera capture
6–7. Android testing
7–9. Push notifications, settings, app icon
9–11. Polish pass (empty states, error handling, loading states)

**Checkpoints to demo before moving on:** the expense-creation flow and the
AI Inbox review screen, as soon as each is working — these two are the ones
that decide whether the mobile app is actually useful day to day.

---

## Open decisions / blockers carried over
- Stripe/payment-processor integration: no backend support exists at all;
  "Invoice paid" push notifications (item 7) depend on this shipping first.
- Real logo/brand mark for the app icon — still needed from design.
