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

### 2. Vendor list and detail
Same pattern as Customers (already built — should be fast):
- Searchable list, open balance per vendor.
- Detail: contact info tab, transaction list tab (tap a row → transaction
  detail), vendor details tab.
- Pull-to-refresh on both list and detail.

### 3. Create/edit transactions (currently read-only)
- **New Expense:** payee dropdown (searchable), payment account dropdown,
  native date picker, line items (category + description + amount, "Add
  line"), memo, save.
- **New Deposit:** bank account dropdown, native date picker, "other funds"
  lines (account + description + amount), memo, save.
- **Edit existing:** "Edit" in the transaction detail header opens the same
  form pre-filled, saves through the same endpoints the web app uses.
- Explicitly out of scope for mobile: check writing, journal entry creation
  — stay on desktop.

### 4. AI Document Inbox
- **Inbox list:** pending imports grouped by statement/upload. Per card:
  upload date, document name, transaction count, status badge (Pending
  review / Approved / Partially reviewed).
- **Statement review:** transaction list for one import. Per row: date,
  description, signed amount (green deposit / red payment), AI-suggested
  account + confidence indicator, detected vendor.
- **Inline editing:** tap a row to expand; edit offset account (searchable
  dropdown), vendor/payee (searchable, "+ Add new vendor" at the bottom),
  description/memo — saved inline, no navigation away.
- **Approve/Reject:** per-row checkbox (parity with web); "Approve selected"
  posts to the ledger; "Reject" drops rows from the queue.
- **Swipe gestures:** swipe right = approve one row, swipe left = reject.
- Pull-to-refresh for new uploads.

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
