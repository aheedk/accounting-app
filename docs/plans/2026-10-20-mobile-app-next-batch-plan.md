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

### 5. Camera capture → AI Inbox — done 2026-10-20
- `expo-image-picker` (camera or library, photo only — kept simple per
  instruction, no cropping/retake UI, one photo at a time).
- Found the real endpoint by research first: `POST /businesses/:businessId/
  ai/documents` (multipart, field name `file`) — the same one-call pipeline
  handles a multi-page bank-statement PDF and a single photographed
  receipt alike (confirmed by reading the classifier prompt, not assumed);
  no separate "receipt mode" exists or was needed. It's synchronous — the
  model call happens inline (can take 15-30s, so the request uses a 45s
  timeout) and the response itself says which queue the upload landed in,
  no polling.
- `CameraCaptureButton` (dashboard header + AI Inbox Appbar) shows a spinner
  while uploading, then routes based on the response: a bank/card
  statement invalidates the inbox query and jumps straight into that
  statement's review screen (`/inbox/[id]`); an invoice or check-stub
  result — which have no mobile review screen yet, out of this batch's
  scope — gets a plain alert saying where it landed instead of a fake
  tap-through.
- Gap worth knowing: the server's mime allowlist is PDF/PNG/JPEG/WEBP —
  **no HEIC**, which is what iPhones capture natively in some settings.
  The mobile upload always sends `image/jpeg` as the declared type (common
  camera-roll default on both platforms), but this hasn't been confirmed
  against every device camera setting — worth a real device check during
  item 6's Android/iOS pass.

### 6. Android testing — code-side prep done 2026-10-20, device pass still needed
- Grepped every `Platform.OS` branch and iOS-specific import/module across
  `app/`, `components/`, `hooks/`, `services/`, `lib/`: all 5 hits
  (`settings.tsx`'s label, `login.tsx`'s `KeyboardAvoidingView` behavior,
  `DateField.tsx`'s native-picker branch, `pushNotifications.ts`'s channel
  setup + platform value) already branch correctly for Android — none are
  iOS-only code with no fallback. No `ActionSheetIOS`/`PushNotificationIOS`/
  `.ios.`-suffixed files, no unguarded `shadowColor`/`shadowOffset`-only
  styling (Paper's own `Card` elevation is already cross-platform).
  `useSafeAreaInsets()` is safe without an explicit `SafeAreaProvider` —
  confirmed Expo Router wraps the root with its own.
- **Still needed, requires a device/emulator (left for you, per
  instruction):** an actual Android pass — navigation, keyboard handling,
  status bar, safe areas, two screen sizes, and verifying the
  `expo-dev-client` build on both platforms. Nothing here is a known
  blocker; it just hasn't been run yet.

### 7. Settings screen and push notification scaffolding — done 2026-10-20
- **Settings** (`app/settings.tsx`, linked from More): account info (name,
  email, role), a biometric-login toggle (reflects whether a password is
  actually stored for it — turning it on when none is stored explains you
  need to sign out and back in with "Remember password" checked, since
  there's no plaintext password sitting in memory post-login to save),
  push-notifications toggle, a light/dark/system theme toggle, version/
  platform under About, and sign out (moved here from the More tab's
  top-level list).
- **Theme preference**: new `useThemePreference` context (SecureStore-backed,
  `system | light | dark`) now drives which Paper theme `_layout.tsx`
  renders, replacing the previous raw `useColorScheme()` — Settings' toggle
  is wired straight into it.
- **Push notification infra**: migration `0107` adds `push_tokens` (`id,
  user_id, token, platform, created_at, last_used_at`, unique on `token` —
  a reinstalled app or a second user on the same device upserts/reassigns
  rather than duplicating). `POST /me/push-tokens` and `DELETE
  /me/push-tokens` (both just `requireAuth`, since a push token is the
  device's own, not a business record — every role including `client` can
  manage its own; `roleMatrix.test.ts`'s 4 role-partition assertions
  updated accordingly, 9/9 still pass). 4 new integration tests cover
  upsert, device-reassignment-on-reinstall, delete-scoped-to-caller, and
  bad-platform rejection; full 488-test API suite green.
- Mobile side: `services/pushNotifications.ts` wraps `expo-notifications` —
  requests permission, gets an Expo push token (fails quietly rather than
  crashing when there's no EAS `projectId` configured yet or running in a
  simulator, both expected ahead of a real device test), registers it.
  `usePushPreference` context backs the Settings toggle and persists the
  token for later deregistration. `useAuth.tsx`'s `login()` silently
  re-registers on every login **only if the user already opted in once
  before** — it doesn't cold-prompt for permission on every sign-in.
- **Notification tap routing scaffolded**: `_layout.tsx` listens for a
  notification response and routes by the payload's `type` —
  `inbox_new_documents` → that statement's review screen (or the inbox
  list if no id), `invoice_paid` → that invoice (not wired to anything
  real yet, since Stripe doesn't exist — scaffolded for when it does).
- **Not yet verified**: actual push delivery needs a real device and an
  EAS project id, neither available here — this is registration/UI
  scaffolding only, as scoped.

### 8. App icon — placeholder shipped, real logo still needed
- No image-generation library available in this environment, so
  `scripts/generate-placeholder-icons.mjs` hand-rolls PNGs via Node's
  built-in `zlib` (navy `#151d33` background, white block-letter "AC"
  mark) at the exact sizes/alpha the existing asset files already use —
  `icon.png`, `splash-icon.png`, `favicon.png`, and the three Android
  adaptive-icon layers (foreground/monochrome transparent, background
  solid). Verified both visually and by checking the alpha channel
  directly (the foreground layer's transparent-vs-opaque pixel counts).
  Swap the same filenames for the real logo when design delivers it —
  nothing in `app.json` needs to change.

### 9. Polish pass — done 2026-10-20
- New shared `EmptyState` (icon + message, a `compact` variant for
  inline/embedded spots) replaced every bare "No X yet"/"No X match" text
  line across the app: General Ledger, Invoices, AI Inbox, Transactions,
  Clients (customers/vendors), Dashboard's recent-transactions card,
  vendor detail's transactions tab, customer detail's invoices list.
  `ErrorState` (retry button, no crash/blank screen) was already in place
  on every data-fetching screen from earlier chunks — confirmed, not
  newly added here.
- **Inline field validation** on the expense/deposit create-edit forms and
  the AI inbox review screen: these previously collapsed every client-side
  check into one combined string shown below the Save button. Split into
  per-field errors now shown under the actual field — Payee, Payment
  account, the Lines section, the inbox's statement-account picker, and
  per-line "pick an offset account" on the specific line that's missing
  one. Server-side errors (from a failed save) still render as inline text
  near the button, not an alert box — that was already true, just confirmed
  it stays true after the split.

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

---

## Visual-parity redesign (2026-10-21) — chunk 1 of N, foundation + nav shell done

The app had drifted visually from web — Paper's default Material look (purple/
teal accents, pill-shaped buttons, system font) instead of the brand. Request:
make mobile unmistakably the same product as web (nav, colors, type, component
shapes, layouts), not a generic Paper app, without silently dropping any
feature it doesn't yet have (show disabled + "Available on desktop" instead).
This is a large, multi-chunk effort; chunk 1 ships the foundation everything
else depends on:

**Colors** — re-derived every token straight from `apps/web/src/index.css`'s
current HSL variables (a fresh conversion, not trusted from memory — the hex
values turned out to already be right from an earlier chunk, but the *gap*
was real: `theme/index.ts` only mapped a handful of MD3 roles, so Paper's
own `secondary`/`tertiary`/`*Container` roles still fell back to stock
Material purple/teal). Now every MD3 color role is explicitly mapped to an
app token (brand only has one accent hue, so `tertiary` intentionally
mirrors `primary` rather than inventing a third color Paper's scheme
assumes exists). Confirmed live on a real simulator screenshot: buttons,
links, and icons all render brand blue, not Material purple.

**Typography** — web is Inter (body) + Fraunces (h1 page titles only, per
web's own CSS comment: "reverted per feedback, everything else stays
Inter") — loaded via `@expo-google-fonts/inter` + `/fraunces` and
`expo-font`'s `useFonts`, gating the splash screen the same way the old
system-font approach did. `Text.defaultProps` is set globally to
`Inter_400Regular` so every existing screen's plain `<Text>` picks it up
without a per-file rewrite; weight-specific spots (headings, emphasized
rows) now reference `fontFamily.semibold`/`.medium` directly, since RN
doesn't reliably synthesize bold from a single loaded weight. Type scale
changed from the earlier phone-rescaled 22/17/14/13/12 to the web's exact
24/18/15/14/12/11, per explicit instruction to match pixel-for-pixel.

**Component shapes** — went with Option B (thin wrappers) since the brief
said pick whichever gets to parity faster: `AppButton` (web's exact variant
palette/weights, 6px radius, not Paper's pill), `AppCard` (white surface +
our border + 6px radius, not Paper's elevation shadow), `StatusBadge`
(consolidates the same green/red/blue/gray pill that had been copy-pasted
as a local `StatusPill` function in 3+ screens). Swapped in: both forms'
Save buttons, inbox's Approve/Reject, login's Sign in, Dashboard's cards —
the highest-visibility primary actions. Paper's own components (Chip,
SegmentedButtons, Menu, TextInput, Switch) are left as-is for now but
render correctly brand-colored since the full MD3 role mapping fixes them
too; swapping their shapes for wrapper primitives as well is follow-up
scope, not done here.

**Navigation** — replaced the 5-tab bottom bar with a left-sliding
`NavDrawer` (Reanimated, backdrop + panel) that's a structural port of
`apps/web/src/components/layout/Sidebar.tsx`'s `ALL_GROUPS` — same
grouping, icons, ordering (Dashboard, Messages, Send documents,
Transactions, Accounts Receivable, Accounts Payable, AI, Accounting,
Reports, Inventory, Setup). Every item mobile hasn't built yet renders
disabled with "Desktop only" instead of being omitted, per explicit
instruction never to just hide a feature. Built mobile screens are wired
in under their real web section (Customers/Vendors under AR/AP rather than
their old standalone "Clients" tab, General Ledger under Reports, Document
Inbox under AI). Bottom bar trimmed to the 4 shortcuts asked for
(Dashboard, Transactions, Create, More) — `clients.tsx` is still a real
route (reached from the drawer via a `?tab=` param), just no longer a tab
icon.

**Header** — new persistent `AppHeader` (hamburger/back · business name ·
title · bell · initials avatar) ported structurally from web's `TopBar.tsx`,
adapted per instruction (bell+avatar instead of the full search bar + name
+ role badge, which doesn't fit phone width the same way). Wired into every
top-level/drawer-destination screen (Dashboard, Transactions, Create, More,
Clients, Invoices, General Ledger, AI Inbox); detail screens pushed from a
list (invoice/customer/vendor/transaction detail, the create/edit forms,
Settings) intentionally keep their existing back-arrow Appbar pattern
rather than re-opening the drawer — they're not primary nav destinations.

**Verified**: full `tsc --noEmit` clean; a real Metro bundle export
(`expo export --platform ios`) built all 2260 modules with no errors; and —
unusually, the user had their own `expo start` already running against a
booted simulator — a live screenshot taken mid-session confirms the header,
drawer-adjacent chrome, blue brand color, Inter type, and trimmed 4-tab bar
all render correctly together, not just in isolation.

**Not done in this chunk** (explicitly carried to the next one — this
request's items 3 and parts of 5/6 are a page-layout-by-page-layout effort
too large for one pass):
- Exact web page layout mirroring beyond what shipped: General Ledger's
  exact column set, customer detail's 3-tab layout + summary sidebar,
  AI inbox's exact table-column parity.
- Swapping Paper's Chip/SegmentedButtons/TextInput for wrapper primitives
  (Option B applied to buttons/cards/badges only so far).
- Drawer's role-based filtering (web's `useCanOpen`) — mobile's drawer
  currently shows every group to every role; only the built-vs-not-built
  gate exists today.
- Tapping an item mid-sentence in the drawer was not interactively
  verified (no UI-automation tooling in this environment, per the
  session's standing note) — confirmed via the static screenshot and code
  review only.

### Redesign chunk 2 (2026-10-21) — forms bottom bar + vendor Notes tab

**Expense/Deposit forms now have web's exact bottom bar** (`ExpensePage.tsx`'s
own layout, read directly before building): Cancel · Make recurring · More ·
Save, not stripped down to just Save. New shared
`components/forms/TransactionFormFooter.tsx` backs both forms:
- **Cancel** — `router.back()`.
- **Make recurring** — shown (not hidden) but recurring templates are a
  whole subsystem not built on mobile; tapping says so plainly ("not
  available on mobile yet — use the web app") rather than faking the flow.
- **More** (existing records only, matching web's own `!isNew` gating) —
  **Copy** (toggles the form into "new" mode in place, keeping every
  current field value — Save then creates a fresh record instead of
  updating), **Void** and **Delete** (real `POST .../void` / `DELETE`
  calls — both already existed on the API from the earlier create/edit
  chunk, just not wired to any UI yet), **Transaction journal** (routes to
  the existing `/transaction/[id]?type=journal` screen using the record's
  own `journal_entry_id` — reuses rather than rebuilds). Void/Delete are
  gated client-side by the same roles the API enforces (`accountant` for
  void, `firm_admin` for delete, via `hasMinRole` against the effective
  per-business role — `role_override` on the active business, falling back
  to the firm-wide role) so a staff login doesn't see options the server
  would 403 anyway.

**Vendor detail now has web's real 3-tab layout** (`VendorDetailPage.tsx`'s
own tab order confirmed before changing anything: Transactions, Details,
Notes — not assumed): added the Notes tab, backed by the real
`GET/POST /vendors/:id/notes` endpoints (already existed, unused by mobile
until now) — list of existing notes (author + date) plus an add-note input.
Customer detail has no equivalent notes-thread endpoint on the API (only a
single flat `notes` text field on the row) — carried to the backlog rather
than faked.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform ios`
bundle built with no errors, and a live screenshot from the user's own
already-running simulator session (mid-session, unprompted) showed the app
healthy in dark mode on an unrelated screen — confirms the redesign isn't
just working in isolation.

**Still open**: General Ledger exact columns, customer detail's 3-tab +
summary sidebar layout, AI inbox exact table columns, Paper component
shape swap-out beyond buttons/cards/badges, drawer role filtering.

### Redesign chunk 3 (2026-10-21) — Transactions list filter/sort redesign — done

User feedback 2026-10-21: the horizontal row of type chips (All/Deposits/
Expenses/Checks/JEs/Bills/Invoices) above the transaction list felt
cluttered — "suffocated." Replaced with a single **Filter** button (shows
an active-count badge, e.g. "Filter (2)") that opens
`components/TransactionFilterPanel.tsx` — a modal sheet in our own surface/
border/radius tokens (not a native action sheet), holding the same filters
web's `/accounting/transactions` page has (read directly from
`TransactionsPage.tsx` before building, not assumed): type, date range
(the same 12-preset set — Last 7/14/30 days, Last 3 months, Previous week/
month/quarter, This week, This year, Last year, Last 7 years, Custom — plus
`presetRange()`/`fiscalYearRange()` ported math so mobile computes identical
start/end dates to web, including using the active business's actual
`fiscal_year_start_month` for This/Last year), reference number, contact
(combined vendor+customer searchable picker, since the API's `contact_id`
already matches either), and amount (operator — equals/between/less than/
less or equal/greater than/greater or equal — with a second value field
when "Between" is picked).

`services/api.ts`'s `listTransactions` extended with `date_start`/
`date_end`/`ref_no`/`amount_op`/`amount_value`/`amount_value2`/`sort_key`/
`sort_dir` — mechanical, since `transactionsService.ts` on the API already
accepted all of them (confirmed, not assumed). New `lib/transactionFilters.ts`
holds the ported preset logic plus `countActiveFilters()` for the button's
badge.

**Not done**: user-controlled sort (still fixed to date desc) — the panel
and query plumbing support `sort_key`/`sort_dir` already, just no UI control
for it yet; the "Amount type" (line/total/line-or-total) option web's
`AmountFilter` has was dropped for v1 since the unified transactions row
only carries each transaction's total (not its lines), so line-level
filtering wouldn't do anything different from total — same limitation
already documented for the equivalent web feature in `docs/backlog.md`.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform ios`
bundle built with no errors.

### Redesign chunk 4 (2026-10-21) — header hierarchy, GL cleanup — done

Live feedback while testing chunk 3: the app "looks amazing" but busy —
specifically the header crammed business name and page title into one row
("Green Gadget..General Ledger"), and General Ledger lines showed a
truncated bold description immediately duplicated in full right below it,
with no way to tap through to the underlying transaction.

- **`AppHeader` is now two rows**, not one: a slim top row (hamburger ·
  business name, small uppercase caption, own breathing room · bell ·
  avatar), then the page title on its own row below — bumped to `h1` size,
  bold, and centered after a follow-up round of feedback ("still want the
  page to be more distinct"). Business name and title no longer compete
  for the same horizontal space or blur together.
- **General Ledger line rows**: dropped the redundant second text line
  when `memo` and `name` are the same string (common in the data — most
  lines had both set to an identical description), and let the one
  remaining line wrap to 2 lines instead of truncating with `…`. Rows are
  now tappable — opens the line's journal entry via the existing
  `/transaction/[id]?type=journal` screen (GL lines only carry
  `journal_entry_id`, not the original expense/deposit/check id, so this
  is "view the transaction's journal entry," not the exact type-specific
  screen — a reasonable scope given what the API returns).

**Verified live**, not just via bundle export: the user had their own
`expo start` running against a booted simulator throughout, and two
screenshots taken mid-session (business switcher mid-use, different
company selected) confirm the new header hierarchy renders correctly with
real data, in dark mode, including the bold centered title.

### Redesign chunk 5 (2026-10-21) — Customer detail parity, Files source for capture — done

**Customer detail** was the thinnest major page relative to web (no tabs,
one card, a bare open-balance number) while Vendor detail already got the
full treatment in chunk 2. Rebuilt against the real
`apps/web/src/pages/customers/CustomerDetailPage.tsx` (read directly, not
assumed — it turns out web's customer page has no tab structure at all,
unlike vendor's 3-tab layout, so this mirrors its actual single-scroll
shape instead of forcing tabs that don't exist on web either):
- Open/Overdue/Paid metric row (same client-side breakdown web computes
  from the same invoice list — no separate stats endpoint exists).
- Full Contact card: company, terms, email, phone, website, opening
  balance (+ as-of date), billing address, shipping address, notes — all
  real fields that existed on the API already but weren't declared in the
  mobile `CustomerDetail` type until now (extended it, plus a shared
  `Address` type).
- Activity card: created, last updated, invoice count.
- Invoices list now shows issue + due date and a real status badge
  (matching Invoices screen's own blue/green/gray/red mapping), not just
  due date and amount.

**Camera capture gets a third source**: "Choose from Files" alongside Take
Photo / Choose from Library, via `expo-document-picker` — lets a user pick
anything already on the device (iCloud Drive, a downloaded statement PDF)
instead of only the camera roll. Shares the same `uploadAndHandle()` path
as the other two sources; `guessMimeType()` gained PDF detection (it only
checked png/webp/else-jpeg before, which would have mislabeled a PDF
picked this way). **Caveat**: `expo-document-picker` is a new native
module — if the simulator/device's dev-client build predates this change,
it needs a native rebuild (not just a JS reload) before "Choose from
Files" will work; Expo Go itself bundles it already, so this only matters
for a custom dev-client build.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform ios`
bundle built with no errors.

### Bug fixes (2026-10-21) — from live testing

- **Camera/Library crashed the app on launch, Choose from Files didn't.**
  Root cause confirmed by inspecting the installed `.app` bundle's actual
  `Info.plist` on the simulator directly: `NSCameraUsageDescription` and
  `NSPhotoLibraryUsageDescription` were missing entirely — the running
  native binary predated the `expo-image-picker` config-plugin entry in
  `app.json` that declares them (its last build timestamp was hours before
  that config existed). iOS hard-kills a process that touches the camera/
  photo-library APIs without those Info.plist keys present — that's the
  exact "quits unexpectedly" symptom, and exactly why Document Picker (no
  privacy-sensitive keys required) was unaffected. Not a code bug. Fixed
  by regenerating the native project (`expo prebuild`) and rebuilding
  (`expo run:ios`) so the keys actually land in the compiled Info.plist —
  confirmed present in the regenerated project before installing.
- **Tapping "Customers" (or "Vendors") in the nav drawer silently landed on
  Dashboard instead.** `clients.tsx` lived inside the `(tabs)` group as a
  tab hidden via `options={{ href: null }}`, and routing to a hidden tab's
  screen from outside the tab navigator doesn't reliably focus it — it
  falls back to the group's default route (Dashboard). Moved `clients.tsx`
  out to a top-level route (`app/clients.tsx`, same pattern already working
  for Invoices/General Ledger/Inbox), dropped the now-unnecessary hidden
  tab entry, and updated the drawer's two links to the new path.
- **AI Inbox's Payee/Offset account fields looked static once filled in,
  even though they were already fully tappable.** Both were plain text
  with no visual affordance — "Tap to set" placeholder text only showed
  while empty, so a filled-in field looked exactly like a read-only label.
  New shared `EditableField` in the inbox review screen gives both a
  bordered box + chevron (the same tappable-field language as
  `PickerField` elsewhere in the app), so they read as editable controls
  whether or not they already have a value — nothing about the actual
  edit behavior changed, since it was already working.

Diagnosis method worth noting: the camera-crash root cause came from
reading the actual compiled `.app`'s `Info.plist` via `PlistBuddy` on the
installed bundle, not from guessing off the source `app.json` — confirms
the standing practice of verifying against real artifacts before asserting
a root cause.

### Redesign chunk 6 (2026-10-21) — Profit & Loss and Balance Sheet reports — done

Built the two most integral financial reports the drawer had marked
"Desktop only" (Reports > Profit & Loss, Reports > Balance Sheet), matching
the real endpoints read directly first (neither has a shared zod/TS type in
`packages/shared` — even the web pages each redeclare their own local copy
of these shapes, so the mobile types follow the same established pattern,
not a shortcut).

- **`app/pnl.tsx`**: period-start/period-end date pickers (defaulting to
  fiscal-year-start → today, using the business's real
  `fiscal_year_start_month`), 3 summary cards (Revenue/Expenses/Net
  income), then Income lines → Total Income → Gross Profit → Expenses
  lines → Total Expenses → Net Operating Income → (Other Expenses, only
  shown if non-zero) → Net Income — same order as web's
  `ProfitLossPage.tsx`, no collapse/expand on either (web doesn't have it
  either).
- **`app/balance-sheet.tsx`**: a single as-of date picker, an in-balance/
  out-of-balance banner (`report.in_balance`, straight from the API), then
  Assets grouped into Current/Fixed/Other Assets blocks → Total Assets,
  Liabilities grouped into Current/Long-Term blocks → Total Liabilities,
  Equity (flat lines + Net Income YTD, italic like web) → Total Equity →
  Total Liabilities and Equity. New `lib/balanceSheetLayout.ts` ports
  web's `assetBlocks`/`liabilityBlocks` grouping logic (keyed off each
  line's own `group` field, not re-derived) since it's web-local code, not
  in the shared package either.
- Wired into the drawer's Reports group (previously both disabled) and
  added as quick links in the More tab, replacing the generic disabled
  "Reports" stub now that two real reports exist there.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform ios`
bundle built with no errors, and both endpoints hit directly against the
real dev API (not just read from source) — the actual JSON response
matched the hand-written mobile types field-for-field, including the
`group` values on balance sheet lines and the negative-amount convention
on liability lines.

### Redesign chunk 7 (2026-10-21) — Trial Balance report — done

Third and last of the core financial reports previously marked "Desktop
only" (Reports > Trial Balance). Route+service code read directly first:
`packages/shared`'s `trialBalanceResponseSchema` turned out to be stale/
incomplete (missing fields the real route returns), so the mobile type
was written from the actual route/service return shape, not the shared
schema — confirmed live against the dev API before shipping.

- **`app/trial-balance.tsx`**: single as-of date picker, a flat table
  (Account | Debit | Credit, account type shown as a caption under the
  name) in `account_type` order exactly as the API returns it — no
  grouping, since web's own `TrialBalancePage.tsx` doesn't group either
  (unlike Balance Sheet, there's no `lib/*Layout.ts` for this report on
  web to port). Totals row + a "Debits equal credits"/"do not match"
  line below, computed from `totals.total_debit === totals.total_credit`.
  Zero-value debit/credit cells render blank instead of "$0.00", matching
  how a real trial balance reads.
- `services/api.ts`: added `TbRow`/`TrialBalanceReport` types +
  `getTrialBalance()`, same "no shared report type, redeclare locally"
  convention as Pnl/BalanceSheet.
- Wired into the drawer's Reports group and the More tab, next to the
  other two reports.

**Verified**: `tsc --noEmit` clean, `expo export --platform ios` bundle
clean, `npm run typecheck -w @accounting/api` clean (no backend changes),
and the endpoint hit directly against the real dev API — response matched
the hand-written type field-for-field (`rows[].{account_id,code,name,
account_type,total_debit,total_credit,net}`, `totals.{total_debit,
total_credit}`, `fiscal_year_start`, `retained_earnings_prior_years`).

### Redesign chunk 8 (2026-10-21) — role-based drawer/Create filtering — done

Until now, every nav drawer item and the Create tab's forms showed for
every role, regardless of what the API would actually let that role do.
Ported web's `apps/web/src/lib/roleAccess.ts` (`canOpenPage`/`useCanOpen`/
`useEffectiveRole`) to a new `apps/mobile/lib/roleAccess.ts`, adapted to
this app's own real routes rather than web's (most of web's pages don't
exist on mobile yet, so the path allow-lists are mobile-specific, not a
line-for-line copy):

- `client` role: only Dashboard, Invoices (view), and the three financial
  reports (`/pnl`, `/balance-sheet`, `/trial-balance`) stay visible in the
  drawer — Transactions, Customers, Vendors, AI Document Inbox, and
  General Ledger are hidden, matching web's `CLIENT_PAGES` allow-list (a
  client only ever sees its own invoices/bills and the standard reports).
- `viewer` role: sees everything staff can, but any `/new` form is
  blocked — same rule as web. Mobile's only two "new" forms today are
  Expense/Deposit, so the Create tab shows an explanatory message instead
  of the form list, and the drawer's "Create" shortcut button is hidden,
  for both `viewer` and `client`.
- Role-denied items are dropped entirely (not shown disabled with a
  note) — deliberately distinct from the "Desktop only" treatment used
  for features this app hasn't built yet. A permission gap and a feature
  gap are different things and read differently to the user: web itself
  removes role-denied items rather than showing them, so mobile matches
  that rather than inventing a new convention.
- A group whose children are all role-denied is dropped too (e.g. the
  whole AR group would disappear for a role that can't open any AR page),
  same as web's `useNavGroups()` behavior.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform ios`
bundle built with no errors. Not re-tested against every role live (no
device test this chunk) — the logic is a direct, narrowly-adapted port of
web's already-shipped `canOpenPage`, which is covered by its own existing
tests on the web side.

### Redesign chunk 9 (2026-10-21) — swapped remaining Paper defaults for brand primitives — done

Last piece of the "Option B thin wrappers" visual-parity work flagged as
deferred back in chunk 1: Paper's default-styled `TextInput`, `Chip`, and
`SegmentedButtons` were still showing Material shapes/colors in the
highest-visibility screens. Added three new primitives in
`components/ui/` alongside the existing `AppButton`/`AppCard`/
`StatusBadge`, matching web's exact specs read from
`apps/web/src/components/ui/input.tsx` and the filter-pill/tab-switcher
treatment on `TransactionsPage.tsx`/`BankTransactionsInboxPage.tsx`:

- **`AppTextInput`**: 40px-tall field, 6px radius, our border color, a
  2px focus ring (web's `focus-visible:border-ring` glow, not Paper's
  Material underline). `label` sits above the field as plain text (web's
  `<Label>` pattern) instead of Paper's floating label. Takes `left`/
  `right` nodes for affixes (a `$` sign, a tappable check/search icon)
  instead of Paper's `<TextInput.Affix>`/`<TextInput.Icon>`, and a
  separate `containerStyle` prop for outer layout (margin) so `style`
  keeps meaning what it means on RN's own `TextInput` (the field itself).
- **`AppChip`**: fully pill-shaped (web's filter pills are `rounded-full`,
  not Paper's rounded-rect Chip), optional trailing icon only when it's
  a dropdown trigger (omitted for a plain toggle chip).
- **`AppSegmentedControl`**: a `bg-muted` track with the active segment
  lifted to the surface color — web's "track with sliding pill" tab-
  switcher look, not Paper's outlined segmented buttons.

Swapped into every high-visibility usage found by searching the whole
app: `ExpenseForm.tsx`/`DepositForm.tsx` (the core transaction-entry
forms — the amount field's `$` affix carried over unchanged), the
Transactions tab's search field, `clients.tsx`'s search field + the
Customers/Vendors segmented toggle, `SearchablePicker.tsx` (the shared
searchable dropdown every create/edit form uses — swap is style-only,
the in-memory filtering stayed untouched so it's still snappy),
`invoices.tsx`'s status filter chips, and `general-ledger.tsx`'s date-
preset chips + account-filter dropdown chip (its "Voided" chip was really
a status pill, so that one became a `StatusBadge` instead, consolidating
with the badge already used everywhere else rather than keeping a
one-off red chip). Left `settings.tsx`'s `SegmentedButtons` and
`inbox/[id].tsx`'s plain note field as Paper defaults — both low-traffic
screens, lowest priority per the earlier visibility triage.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform ios`
bundle built with no errors, grepped every touched file afterward to
confirm no stray `Chip`/`TextInput`/`SegmentedButtons` import from
`react-native-paper` was left behind. No live device interaction this
chunk (no way to drive simulator taps from here) — static verification
only, same caveat as chunk 8.

### Redesign chunk 10 (2026-10-21) — brand-matched dropdown menu — done

Last Paper component still showing Material styling anywhere in the app:
the plain `Menu`/`Menu.Item` dropdown (header business switcher, drawer
business switcher, the transaction form's "More" actions, every filter
dropdown, the GL account filter, the expense payment-method picker).

Deliberately **not** a full Option-B rebuild this time — Paper's `Menu`
already gets anchor measurement, screen-edge handling, and open/close
positioning right, and re-deriving that in plain RN is real risk for
zero visual gain. Instead, new `components/ui/AppMenu.tsx` exports
`AppMenu`/`AppMenuItem` as a thin restyle layer on top of Paper's own
`Menu`/`Menu.Item`: `contentStyle` gives the panel web's shadcn
`dropdown-menu.tsx` look (bordered, rounded, our surface color, instead
of Paper's Material elevation), and `AppMenuItem` pulls text color from
our theme tokens with a `destructive` boolean prop (red text) replacing
the one-off `titleStyle={{color: theme.app.destructive}}` that
`TransactionFormFooter`'s Delete item had been doing inline — now the
same pattern as every other destructive action in the app.

Swapped every call site found by grepping the whole app for `<Menu`:
`AppHeader.tsx` and `NavDrawer.tsx` (both business switchers),
`TransactionFormFooter.tsx` ("More" — Copy/Void/Transaction journal/
Delete), `TransactionFilterPanel.tsx` (type/date-preset/amount-operator
dropdowns), `general-ledger.tsx` (account filter), `ExpenseForm.tsx`
(payment method). No other `<Menu` usages existed anywhere else in
`apps/mobile`, so this fully retires Paper's default Menu styling from
the app — every Paper component still in use now goes through the MD3
role-mapping fix from chunk 1, and every one that showed a Material
shape/pill/panel has a brand-matched wrapper.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform ios`
bundle built with no errors, grepped the whole app afterward to confirm
the only remaining `from 'react-native-paper'` import of `Menu` is
inside `AppMenu.tsx` itself (the wrapper, as intended). No live device
interaction this chunk, same caveat as the last two.

### Redesign chunk 11 (2026-10-21) — Statement of Cash Flows report — done

Fourth and last of the core financial reports previously marked "Desktop
only" (Reports > Cash Flows). Route is `statementOfCashFlowsService.ts`
behind `GET /reports/statement-of-cash-flows` — confirmed via the real
route/service code that `packages/shared` has **no** zod schema for this
response at all (its `cashFlowQuerySchema` belongs to a different,
unrelated `/reports/cash-flow` "Cash Activity by Account" register report
that mobile has not built and did not touch — the drawer's separate "Cash
Activity" entry stays disabled, deliberately not conflated with this one).

- **`app/cash-flow.tsx`**: period-start/period-end date pickers (same
  fiscal-year-start default as P&L), 3 summary cards (Beginning cash/Net
  change/Ending cash), then Operating activities (Net Income + adjustment
  lines → subtotal) → Investing activities (lines or "No investing
  activity" placeholder → subtotal) → Financing activities (same pattern)
  → Net cash increase for period → Cash at beginning of period → Cash at
  end of period — same order and section names as web's
  `StatementOfCashFlowsPage.tsx`. Amounts render through the existing
  `fmtMoney` (which already prints a leading minus for negative values
  via `toLocaleString`), matching web's signed-amount display without
  needing a separate formatter.
- `services/api.ts`: added `CfLine`/`StatementOfCashFlowsReport` types +
  `getStatementOfCashFlows()`, same "no shared report type, redeclare
  locally" convention as the other three reports.
- Wired into the drawer's Reports group (its path added to the existing
  "Cash Flows" entry, left "Cash Activity" disabled) and the More tab.
- `lib/roleAccess.ts`'s `CLIENT_PAGES` allow-list extended with
  `/cash-flow` — web's own `CLIENT_PAGES` includes the cash-flow
  statement for a client login, so the mobile allow-list now matches it
  for all four reports a client can open (pnl/balance-sheet/
  trial-balance/cash-flow).

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform ios`
bundle built with no errors, and the endpoint hit directly against the
real dev API — response matched the hand-written type field-for-field,
including the negative-amount convention on operating-activity
adjustment lines (payroll liability accruals shown as negative cash
adjustments, as expected for an increase in a liability).

### Redesign chunk 12 (2026-10-21) — Chart of Accounts (list + detail) — done

First screen built out of the drawer's remaining fully-disabled groups
(Accounting/Inventory/Setup/rest of AR-AP) — picked Chart of Accounts
specifically per the user's own choice among four options offered,
deliberately scoped **read-only**: no create/edit form. The API's create/
edit routes require `accountant`+ and the detail-balance math has real
edge cases (locked system accounts, subaccount parents) — a lookup/
reference screen carries none of that risk, matching the "no ledger-
posting risk" framing the option was picked under.

- `services/api.ts`: widened the existing `CoaAccount` type (previously a
  narrow `{id,code,name,account_type,detail_type}` picker-only shape used
  by ExpenseForm/DepositForm/general-ledger.tsx's category pickers) to
  the full `chart_of_accounts` row — `parent_id, description, is_system,
  is_active, is_locked, system_key, created_at, updated_at` added.
  Purely additive, so every existing picker call site (which only reads
  `code`/`name`) keeps working unchanged — confirmed by grepping for
  every `CoaAccount` reference first. Added `listChartOfAccounts`'s new
  optional `include_inactive` param, `getAccount()` (single-account +
  computed `balance`), and `getAccountRegister()` (the QBO-style register
  endpoint: running balance per line) — none had a `packages/shared` zod
  schema to check against except the create/edit schemas (accurate, not
  used here since this build has no write path).
- **`app/chart-of-accounts.tsx`**: flat list sorted by code (web's own
  `CoaListPage.tsx` doesn't group this list either, unlike Balance
  Sheet) — search by name/code, a type filter chip row (Assets/
  Liabilities/Equity/Revenue/Expenses), a "Show inactive" toggle chip
  (API's `include_inactive` param), `StatusBadge` for Active/Inactive, a
  lock icon on locked accounts.
- **`app/account/[id].tsx`**: balance card (code/type/detail type/
  description/status) + a "Recent activity" register list reusing
  `general-ledger.tsx`'s `GlLineRow` visual pattern (date/source row,
  memo, voided badge, signed amount, running balance) — tapping a row
  opens the underlying journal entry, same as GL.
- Wired into both of the drawer's two "Chart of Accounts" entries
  (Accounting group and Setup group both link to it on web too — kept
  the duplication the drawer's structural port already carried from
  `Sidebar.tsx` rather than collapsing it) and the More tab (previously
  a disabled stub there).
- No role-access change needed: `lib/roleAccess.ts`'s existing
  `client`-role allow-list already excludes any path not explicitly
  listed, so Chart of Accounts stays hidden for a client login with no
  new code; `viewer` can open it since nothing about it is a `/new` form.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform ios`
bundle built with no errors, and all three endpoints (list, single-
account, register) hit directly against the real dev API — response
shapes matched the hand-written types field-for-field, including the
register's running-`balance` and `counter_account` fields on a real
account with transaction history (18 rows on the Sales revenue account).

### Redesign chunk 13 (2026-10-21) — Journal Entries list — done

Second screen out of the drawer's remaining disabled groups (after Chart
of Accounts). Journal entry *detail* viewing already worked
(`app/transaction/[id].tsx?type=journal`, built in an earlier chunk) —
the gap was a list to browse into it from, since the drawer's Accounting
> Journal item had no path.

Checked web first before building anything: **web has no standalone
journal-entries list page at all** — `apps/web/src/App.tsx` registers
only `/journal/new` and `/journal/:id`; the closest thing is
`RecentJournalEntries.tsx`, a 10-row popover off `GET /journal-entries`
(confirmed by reading it directly, not guessed) that users reach from a
header icon. So there was no established "browse all journal entries"
pattern to mirror — flagged that explicitly rather than inventing a
filterable list screen beyond what the API/web pattern actually supports.
Scoped the mobile screen to match what the popover already does (status
filter + a flat list, same endpoint, same fields) adapted into a real
screen instead of a 10-row dropdown — not a net-new feature, just web's
existing "recent entries" concept given room to be a full screen the way
mobile's screen real estate calls for.

- `services/api.ts`: added `JeLine`/`JournalEntryListItem` types +
  `listJournalEntries()` hitting the same `GET /journal-entries` route
  `RecentJournalEntries.tsx` uses, with a generous `limit: 100` (no
  incremental/infinite-scroll pagination — no other mobile list screen in
  this app has that pattern yet, so a single generous fetch per filter
  change matches the established convention instead of introducing a new
  one).
- **`app/journal-entries.tsx`**: status filter chips (All/Posted/Draft/
  Voided, reusing `AppChip`/`StatusBadge` exactly as every other list
  screen does), each row showing journal number, date, memo, total
  (summed from the entry's own debit lines), and a status badge; tapping
  a row opens the existing journal detail view.
- Wired into the drawer's Accounting > Journal item and the More tab.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform ios`
bundle built with no errors. **Not verified against the live dev API this
chunk** — the local dev server (`localhost:4000`) wasn't running when
this was built, unlike every prior report/CoA chunk. The response shape
was read directly from `journalEntryQueryService.ts`'s `listJournalEntries`
and `apps/web/src/pages/journal/journalEntryTypes.ts`'s
`JournalEntryRecord`/`JournalEntryLine` (not guessed), and the exact same
fields are already proven correct by the long-working `getJournalEntry`
detail call on the same `journal-entries` resource — but this one line
item type is unconfirmed against a real response. Worth a live check the
next time the dev server is up before fully trusting this screen.
