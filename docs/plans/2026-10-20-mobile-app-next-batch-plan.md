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

### Dev environment fix (2026-10-22) — login was broken, unrelated to mobile

User reported login failing with "Something went wrong" plus debugger
errors. Root cause was two stale-local-environment issues, neither caused
by mobile work:
1. `packages/shared`'s compiled `dist/` predated the `passwords.ts` file
   a recent upstream merge (the sign-in-security feature) added, so the
   API crashed on boot with a missing-export error (`passwordProblem`).
2. That same merge's migration (`db/migrations/0109_sign_in_security.sql`)
   hadn't been applied locally, so even after fixing the boot crash,
   login hit a Postgres "missing column" error (42703).

Fixed by rebuilding `packages/shared` (`npm run build -w @accounting/shared`)
and running `npm run db:migrate` (applied `0108_estimates.sql` and
`0109_sign_in_security.sql`). Confirmed via a direct `curl` login that
returned a valid token. Noting this here since it explains why the prior
chunk (Journal Entries) couldn't be verified live — the dev server was
down for that exact reason, now resolved and retroactively verified below.

### Redesign chunk 14 (2026-10-22) — AR Aging / AP Aging reports — done

Completes the Reports group alongside the other four financial reports.
Both routes (`GET /reports/aging`, `GET /reports/ap-aging`) share one
`AgingRow` shape from `agingBuckets.ts` — confirmed `packages/shared`'s
`agingRowSchema` is stale (wrong field names: `customer_id`/`over_30`
etc. instead of the real `id`/`days_1_30` etc.) and unused by either
route, so typed from the service code directly, same as every other
report so far.

- Web's `AgingReportPage.tsx` renders one wide 7-column table (shared
  for AR/AP via a `kind` prop) — doesn't fit phone width as a table, so
  new shared `components/AgingReportView.tsx` adapts it to a card per
  party (name + total, matching every other list row in this app) with
  the 5 aging buckets as a small grid underneath, only showing non-zero
  buckets (same "blank when zero" convention web uses) — same data and
  bucket boundaries (current/1-30/31-60/61-90/91+, aged off days past
  due date), different layout for the screen size.
- Two thin screens, `app/ar-aging.tsx`/`app/ap-aging.tsx`, both just
  wiring `AgingReportView` to `getArAging`/`getApAging` — the one
  component that isn't near-duplicated across two files, unlike the
  other reports which don't share enough to be worth factoring out.
- `services/api.ts`: added `AgingRow`/`AgingReport` types +
  `getArAging()`/`getApAging()`.
- Wired into the drawer's AR > Aging and AP > Aging items (previously
  both disabled) and the More tab.
- `lib/roleAccess.ts`'s `CLIENT_PAGES` extended with `/ar-aging` and
  `/ap-aging` — both are in web's own `CLIENT_PAGES` list for the same
  reason as the other reports.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform ios`
bundle built with no errors, both endpoints hit against the real dev API
(now that the login fix above got it running again) — response wrapper
shape (`as_of`/`rows`) matched for both, but this demo business had no
overdue AR/AP balances, so `rows` came back empty and the per-row field
names (`days_1_30` etc.) are confirmed from the service source, not from
a populated live response. Also used this chunk to retroactively confirm
the prior chunk's Journal Entries list against live data — response
matched the hand-written `JournalEntryListItem`/`JeLine` types exactly.

### Redesign chunk 15 (2026-10-22) — Record Payment (AR write path) — done

First write-path feature built out of the AR/AP groups (everything
before this chunk was reports/lists). Read the route, service, and zod
schema directly before building anything — `paymentDraftCreateSchema` in
`packages/shared/src/schemas/payment.ts` is accurate (unlike the stale
aging/trial-balance schemas), so client-side validation mirrors it
exactly (money regex, uuid fields, 200/500-char limits).

- **Scope deliberately bounded**: create-and-post in one step (mirroring
  web's `useSaveAndPost`) plus void — no per-invoice add/remove-
  application-after-creation UI, even though `POST .../applications` and
  `DELETE .../applications/:appId` exist server-side. Editing an existing
  payment's allocations isn't a mobile feature yet; the normal "record a
  payment, apply it to invoices, post it" case is fully covered via
  `initial_applications` at creation.
- **`app/payments.tsx`**: status filter chips + list (same pattern as
  every other list screen), a "Record payment" button gated by
  `useCanOpen('/payment/new')` so a viewer/client login doesn't see it.
- **`app/payment/new.tsx`**: customer picker, date, reference, payment
  method, deposit-to account (reusing `statementBankAccounts` — the same
  bank-account filter Expense/Deposit already use, not a new one),
  outstanding-invoices checklist for the picked customer (checking an
  invoice auto-fills its full `amount_due`, editable after — same UX as
  web's allocation table), an optional "amount received" override that
  defaults to the applied sum, an unapplied-amount readout. Open invoices
  are fetched the same N+1 way web does (list posted invoices, then fetch
  each detail for `amount_due`, filtered to balance > 0) since the list
  endpoint doesn't carry a balance — not inventing a batch-balance
  endpoint for this.
- **`app/payment/[id].tsx`**: balance/status card, applications list
  (invoice number + applied amount), a Void button gated to `accountant`+
  AND `applications.length === 0` client-side (mirrors the server's own
  hard guard — `PaymentHasApplicationsError` otherwise) using
  `Alert.prompt` for the required void reason (iOS-only API, consistent
  with this app's iOS-first scope so far).
- `services/api.ts`: added `PaymentRow`/`PaymentApplication`/
  `PaymentDetail`/`PaymentInput` types + `listPayments`/`getPayment`/
  `createPayment`/`postPayment`/`voidPayment`, all shapes read directly
  from `paymentService.ts`'s actual return statements and
  `PaymentsTable`/`PaymentApplicationsTable` in `db/types.ts`.
- Wired into the drawer's AR > Payments item, the Create tab (alongside
  Expense/Deposit), and the More tab.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform ios`
bundle built with no errors, `GET /payments` hit live and confirmed the
`{ payments: [] }` wrapper shape. **Could not exercise the full create→
post→void round trip live** — this demo business (`mobile-demo@example.com`)
has zero customers, so there's nothing to record a payment against. The
request/response shapes are taken directly from the route handlers'
actual `res.json(...)` calls and the zod schema (not guessed), but this
is the first write-path chunk without an end-to-end live exercise — worth
testing for real once there's a customer with an open invoice to pay.

### Redesign chunk 16 (2026-10-22) — Bills (AP, read-only) — done

Mirrors `invoices.tsx`/`app/invoice/[id].tsx` field-for-field for the AP
side — same filter chips (All/Open/Overdue/Paid), same vendor-name-join
pattern (via the already-existing `listVendors`, same as invoices.tsx
joins `listCustomers`), same amount-due header treatment. Read-only this
chunk, same reasoning as Chart of Accounts: create/post require
`staff`/`accountant` and aren't needed for a first browse-and-view screen.

- Caught my own mistake before shipping: initially guessed the bill
  line-item fields as `unit_cost`/`line_total` (copying invoice line
  naming by assumption) — checked `BillLinesTable` in `db/types.ts`
  directly and the real columns are `unit_price`/`line_subtotal`, fixed
  before any typecheck. A reminder to read the actual table definition
  for every new entity rather than pattern-matching off a sibling type,
  even when the sibling is extremely similar.
- `services/api.ts`: added `BillRow`/`BillLine`/`BillDetail` local types
  (no shared zod schema exists for bill reads either — only
  `billDraftCreateSchema` etc. for the write side, same non-issue as
  invoices) + `listBills()`/`getBill()`. Noted the list endpoint's
  computed balance field is named `open_balance` while the detail
  endpoint's is `amount_due` — different names for the same idea,
  confirmed by reading both route handlers rather than assumed to match.
- **`app/bills.tsx`**: list screen, exact invoices.tsx pattern.
- **`app/bill/[id].tsx`**: detail screen — built against the newer
  `AppHeader`/`AppCard` primitives (unlike `app/invoice/[id].tsx`, which
  predates the redesign and still uses Paper's `Appbar`/`Card` directly);
  did not retrofit the older invoice detail screen in this chunk since
  that wasn't asked.
- `lib/roleAccess.ts`: added the same client-role carve-out invoices has
  (`/bills` and `/bill/:id` open to a client login, `/bill/new` still
  blocked) — mirrors web's `canOpenPage`, which special-cases
  `/ap/bills`/`/ap/bills/:id` the same way for a client viewing their own
  bills.
- Wired into the drawer's AP > Bills item and the More tab.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform ios`
bundle built with no errors, `GET /bills` hit live and confirmed the
`{ bills: [] }` wrapper shape. This demo business has 43 vendors but zero
bills (expenses were entered directly instead, a common QBO-style
pattern), so the per-row and per-line field names are confirmed from
`db/types.ts` directly rather than a populated live response — worth a
real check once this business (or another) has an actual bill.

### Redesign chunk 17 (2026-10-22) — Bill Payments (AP write path) — done

Vendor-side mirror of chunk 15's Record Payment, now that Bills exist to
pay (chunk 16). Confirmed the field-name mapping before writing any code
rather than assuming the AR shapes carry over 1:1: `vendor_id`/`bill_id`
replace `customer_id`/`invoice_id`, but `applied_amount`/
`unapplied_amount` are the exact same column names on both sides — a
real difference and a real match, checked against
`BillPaymentsTable`/`BillPaymentApplicationsTable` in `db/types.ts`
rather than guessed either way.

- **Scope note worth flagging**: web actually has *two* AP payment UIs —
  a single-vendor `BillPaymentNewPage.tsx` (the true 1:1 analog of
  `PaymentNewPage.tsx`, which is what this chunk mirrors) and a separate
  QuickBooks-style multi-vendor "Pay Bills" batch grid
  (`PayBillsPage.tsx`, one table of every unpaid bill across *all*
  vendors, posting one payment per vendor via a batch endpoint). Mobile
  only mirrors the single-vendor flow — the batch grid is a materially
  bigger, different UX that wasn't asked for and would need its own
  design pass, not a quick extension of this chunk.
- `services/api.ts`: added `BillPaymentRow`/`BillPaymentApplication`/
  `BillPaymentDetail`/`BillPaymentInput` types + `listBillPayments`/
  `getBillPayment`/`createBillPayment`/`postBillPayment`/
  `voidBillPayment`, reusing the existing `PaymentMethod`/`PaymentStatus`
  enums since both sides use identical values.
- **`app/bill-payment/new.tsx`**: vendor picker, date, reference, method,
  payment account, outstanding-bills checklist, optional amount
  override — same structure as `app/payment/new.tsx`, but simpler in one
  way: `listBills` already returns `open_balance` per row, so no N+1
  per-bill detail fetch was needed (unlike invoices, where `listInvoices`
  doesn't carry a balance).
- **`app/bill-payment/[id].tsx`**: same Void guard as the AR side (zero
  applications required, mirroring the server's `BillPaymentHasApplicationsError`)
  and the same `Alert.prompt` void-reason flow.
- **`app/bill-payments.tsx`**: list screen, exact `payments.tsx` pattern.
- Wired into the drawer's AP > Pay Bills / Bill Payments items, the
  Create tab, and the More tab. No `lib/roleAccess.ts` change needed —
  `/bill-payment/new` is already blocked for viewer/client by the
  existing `/new` regex and the client default-deny.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform ios`
bundle built with no errors, `GET /bill-payments` hit live and confirmed
the `{ bill_payments: [] }` wrapper shape. Same data limitation as
chunks 15/16 — this demo business has no bills, so the full create→
post→void round trip and the per-row field names in a populated response
are still unverified live; the shapes come from `db/types.ts` and the
route handlers' actual `res.json(...)` calls, not guessed.

### Redesign chunk 18 (2026-10-22) — Credit Memos (AR) — done

Rounds out the AR side. Two real structural differences from Payments,
both confirmed against the actual route/service/table code before
writing anything (not assumed to follow the same shape as Payments just
because it's a sibling AR entity):

- **No `GET /credit-memos/:id` detail route exists at all** — only list/
  create/post/apply/void. Web's own `CreditMemoDetailPage.tsx` fetches
  the whole list and finds the row client-side; mobile's
  `app/credit-memo/[id].tsx` does the exact same thing rather than
  inventing a detail endpoint that isn't there.
- **Applying to an invoice is always a separate `POST .../apply` call**
  (`{invoice_id, applied_amount}`), never an `initial_applications` field
  at creation the way Payments has — confirmed credit memos reuse the
  *same* `payment_applications` table as Payments (keyed by
  `credit_memo_id` instead of `payment_id`), just through a different
  endpoint shape. The detail screen's "Apply to an invoice" section
  (single invoice picker + amount, pre-filled to `min(invoice balance,
  credit memo remaining)`) is a deliberate separate step after posting,
  matching web exactly rather than trying to fold it into creation.
- **Role gap caught and fixed before shipping**: credit memo creation
  requires `accountant`, stricter than every other AR/AP write built so
  far (`staff`). The generic `useCanOpen('/credit-memo/new')` check only
  knows the viewer/client rules, so a staff login would have seen the
  "+ New credit memo" button and the Create-tab entry, then hit a 403 on
  save. Fixed by gating both directly with `hasMinRole(effectiveRole,
  'accountant')`, same pattern already used for Void buttons elsewhere.
- `services/api.ts`: added `CreditMemoRow`/`CreditMemoInput` types +
  `listCreditMemos`/`createCreditMemo`/`postCreditMemo`/
  `applyCreditMemoToInvoice`/`voidCreditMemo` (no `getCreditMemo` — see
  above). Local `CM_BADGE` status-color map in both the list and detail
  screens, same reasoning as invoices.tsx's `INVOICE_BADGE`: "posted"
  here means an active unspent credit (blue/open), not a settled state —
  "applied" (fully used up) gets the green/settled treatment instead.
- Wired into the drawer's AR > Credit Memos item, the Create tab (gated
  to accountant+), and the More tab.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform ios`
bundle built with no errors, `GET /credit-memos` hit live and confirmed
the `{ credit_memos: [] }` wrapper shape. Same data gap as the last three
chunks (no customers on this demo business at all, so credit memos are
moot) — full create→post→apply→void flow unverified live.

### Redesign chunk 19 (2026-10-22) — Vendor Credits (AP) — done

Vendor-side mirror of chunk 18's Credit Memos, now fully rounding out
AP alongside AR. Verified the field mapping directly against
`VendorCreditsTable`/`vendorCreditService.ts`/`vendorCredits.ts` before
writing code rather than assuming 1:1 symmetry — one real naming
difference found: the AP side's offset field is generically named
`offset_account_id` (not `expense_account_id`), while AR's equivalent is
`revenue_account_id`. Everything else matches the Credit Memo pattern
exactly: no `GET /vendor-credits/:id` route (list-and-find, same as
`credit-memo/[id].tsx`), application is a separate `POST .../apply` call
reusing `bill_payment_applications` (keyed by `vendor_credit_id` instead
of `bill_payment_id`, confirmed by reading the table directly), and the
same "zero active applications" void guard.

- `services/api.ts`: added `VendorCreditRow`/`VendorCreditInput` types +
  `listVendorCredits`/`createVendorCredit`/`postVendorCredit`/
  `applyVendorCreditToBill`/`voidVendorCredit`.
- **`app/vendor-credits.tsx`**, **`app/vendor-credit/new.tsx`**,
  **`app/vendor-credit/[id].tsx`**: structural mirrors of the three
  credit-memo screens, with the open-bills picker on the apply form
  reusing `listBills`'s embedded `open_balance` (no N+1 fetch needed,
  same simplification Bill Payments already got over Payments).
- Also fixed the same role gap preemptively this time instead of after
  the fact: vendor credit creation is `accountant`-gated both on the
  list screen's "+ New" button and the Create tab (shared boolean with
  Credit Memo, renamed `canCreateAtAccountantLevel` for clarity now that
  it gates two items).
- Wired into the drawer's AP > Vendor Credits item, the Create tab, and
  the More tab.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform ios`
bundle built with no errors, `GET /vendor-credits` hit live and
confirmed the `{ vendor_credits: [] }` wrapper shape. Same data gap as
the prior four write-path chunks — this demo business has no vendors
with open bills, so the full create→post→apply→void flow is still
unverified live across all of Payments/Bill Payments/Credit Memos/
Vendor Credits. Recommended to the user that this whole family of
screens gets a real test pass once real AR/AP data exists, before
building anything further on top.

### Redesign chunk 20 (2026-10-22) — Bank Transactions review inbox — done

First piece of the Banking area, researched before anything was built to
settle a scope question up front: is "Bank Transactions review" the same
feature as Reconciliation? Confirmed **no** — `bank_transactions` is a
staging/triage table for bank-feed rows before they become journal
entries; Reconciliation (`ReconcileWorksheetPage.tsx`) is a separate
workflow that ticks already-coded transactions against a statement
balance, and only *consumes* `is_reconciled` on rows this inbox produces.
Scoped this chunk to the triage inbox only — Reconciliation stays
unbuilt, a distinct future chunk.

- **Deliberately not built this chunk**: "Match to an existing journal
  entry" (needs a date/amount-search picker over JEs, a materially
  different UI problem than every name-based picker in this app) and CSV
  import (desktop-only). Categorize (the QBO "Add" case) and Exclude
  cover the common review path; Unreview (accountant+, blocked once
  `is_reconciled`) undoes either.
- `services/api.ts`: added `BankTransactionRow`/`BankTransactionStatus`/
  `BankTransactionSuggestion` types + `listBankTransactions`/
  `getBankTransaction`/`getBankTransactionSuggestion`/
  `categorizeBankTransaction`/`excludeBankTransaction`/
  `unreviewBankTransaction`, all read directly from
  `BankTransactionsTable` and the route handlers' actual `res.json(...)`
  calls (the shared `bankTransaction.ts` zod schema checked out as
  accurate, unlike several stale ones found earlier this session).
- **`app/bank-transactions.tsx`**: one-bank-account-at-a-time (same as
  web's per-account card selector — a transaction's running context only
  makes sense within one account), status filter chips (For review/
  Categorized/Matched/Excluded).
- **`app/bank-transaction/[id].tsx`**: reuses the existing
  `ConfidenceBadge` component built for the AI document inbox (same
  `{confidence, band, source_layer}` shape the auto-coding engine
  returns everywhere) to show the AI's suggested category with a
  one-tap "Use X" shortcut, plus the Categorize form (account picker +
  memo) and a separate Exclude form (reason required) when
  `status === 'unreviewed'`; otherwise shows the outcome and an Unreview
  button gated to accountant+.
- Wired into the drawer's Accounting > Bank Transactions item and the
  More tab.

**Verified**: `tsc --noEmit` clean (one real type error caught and fixed
— `AppButton`'s `children` prop is typed `string`, not `string[]`, so a
JSX-interpolated multi-part label needed a single template literal
instead), a fresh `expo export --platform ios` bundle built with no
errors, `GET /bank-transactions` hit live (both bank accounts, no status
filter, every combination) and confirmed the `{ bank_transactions: [] }`
wrapper shape — but this demo business has genuinely zero bank
transactions ever imported, so none of the per-row fields or the
Categorize/Exclude/Unreview actions have been exercised against real
data. Continuing the pattern flagged in the last several chunks: this is
now six write/action-capable screens in a row without a live round trip.

### Redesign chunk 21 (2026-10-22) — Reconciliation (Start/Worksheet/History) — done

The last big distinct feature area from the original scope. Read the
route file and service code directly end-to-end before writing anything,
which immediately surfaced something worth flagging: **two separate
backend systems exist** — an older `/reconciliations` route
(`reconciliationService.ts`) that appears unused by web at all, and the
real one, `/bank-rec/*` (`bankReconciliationWorksheetService.ts`), which
is what every `Reconcile*Page.tsx` on web actually calls. Built against
`/bank-rec/*` only; the older route was left untouched.

- **Scoped to Start/Resume → tick/save → Finish, plus a flat History
  list.** Deliberately not built: Undo (`firm_admin`-only, rare — "I
  finished a reconciliation by mistake" is not a common mobile moment),
  Cancel wired into the UI (exists server-side, used only for this
  chunk's own live-API cleanup, see below), and a discrepancy-account
  picker on Finish (the server already defaults to Opening Balance
  Equity when `accept_difference: true` is sent with no account —
  covers the common case without an extra picker).
- **Beginning balance is never user-entered** — confirmed the server
  always computes it from the prior completed reconciliation's ending
  balance (0.00 if none), so the Start form only asks for the statement
  ending balance and date, matching the real constraint rather than
  adding a field the API would ignore.
- **Clearing is kept client-local** (a `Record<string, boolean>` built
  from the worksheet's `items[].is_cleared` on load), recomputing the
  running summary (cleared balance, difference, checked count) in JS on
  every tap rather than a network round trip per toggle — same approach
  web's own worksheet takes. An explicit Save button sends the full
  current state in one `PATCH .../items` call (the endpoint's own
  contract: idempotent upsert keyed on `transaction_type`+
  `transaction_id`), and Finish auto-saves once more right before
  calling finish, so a forgotten Save tap can't lose ticks.
- **Finish handles the non-zero-difference case explicitly**: confirmed
  the server does *not* require an exact match — a nonzero difference
  without `accept_difference: true` throws a precondition error naming
  the amount, so the mobile Finish button checks the local difference
  first and, if nonzero, shows an alert ("$X difference... Finish
  anyway posts an adjusting entry") before calling finish with
  `accept_difference: true`.
- `services/api.ts`: added `ReconcilableAccount`/`ReconciliationRow`/
  `WorksheetItem`/`ReconciliationSummary`/`Worksheet`/
  `ReconciliationHistoryRow` types + `listReconcilableAccounts`/
  `getReconciliationStatus`/`startReconciliation`/`getWorksheet`/
  `saveReconciliationProgress`/`finishReconciliation`/
  `listReconciliationHistory` — the worksheet's `account` field reuses
  the existing `CoaAccount` type from the Chart of Accounts chunk rather
  than redeclaring it, since `resolveAccount`'s `selectAll()` returns
  the exact same `chart_of_accounts` row shape.
- **`app/reconcile.tsx`**: account picker (any reconcilable asset/
  liability/equity account, not just registered bank accounts) +
  beginning-balance display + Resume/Start.
- **`app/reconcile/start.tsx`**: ending balance + date only (service
  charge/interest fields exist server-side but were left off the mobile
  form — skippable, and keeps the form short for the common case).
- **`app/reconcile/[id].tsx`**: the worksheet itself — summary card,
  Deposits/Payments filter chips, tap-to-tick rows (no separate detail
  navigation — ticking *is* the primary interaction, matching every real
  reconciliation tool), Save/Finish footer.
- **`app/reconcile-history.tsx`**: flat list across every account (no
  expandable QBO-style report view — that's a `getReconciliationDetail`
  call not wired up this chunk).
- Retired the long-standing "Reconciliation" disabled stub in the More
  tab (present since the earliest redesign chunks) now that it's real —
  the `STUB_ITEMS` array it was the last entry in is now gone entirely.
- Wired into the drawer's Accounting > Reconcile item and the More tab.

**Verified** — by far the most thorough live check this session, because
this account (1120 — Cash in Bank) actually has real transaction
history, unlike every AR/AP/bank-transactions chunk before it: `tsc
--noEmit` clean, a fresh `expo export --platform ios` bundle built with
no errors, and then a full live round trip via direct API calls (not
through the unfinished mobile UI, to keep it safely reversible) —
`listReconcilableAccounts` (59 real accounts), `getReconciliationStatus`,
`startReconciliation` (confirmed every `ReconciliationRow` field),
`getWorksheet` (64 real items, confirmed `WorksheetItem` and `summary`
field-for-field, confirmed the `account` sub-object matches `CoaAccount`
exactly), `saveReconciliationProgress` (ticked one real item, confirmed
the returned `{reconciliation, summary}` and the recomputed difference
math), then `cancel` to discard the test session cleanly — confirmed via
a final `getReconciliationStatus` call that `in_progress_id` went back
to `null`, leaving no trace. Deliberately did **not** call `finish` live,
since that would have permanently marked a real transaction reconciled
and posted a real adjustment journal entry — tested everything finish
depends on (save, the difference calculation) short of the one
irreversible step.

### Redesign chunk 22 (2026-10-22) — last Paper-default leftovers swapped — done

Closes out the visual-parity component pass completely. The two items
flagged as deliberately deprioritized back in chunk 10 (`settings.tsx`'s
`SegmentedButtons`, the AI inbox's "+ Add new vendor" `TextInput`) plus
two more found by re-running the same app-wide grep sweep that chunk 10
used to confirm it was done (`login.tsx`'s email/password fields,
`vendor/[id].tsx`'s tab switcher + "Add a note" field) — the sweep had
only been run against files touched in that chunk, not the whole app, so
these were missed at the time.

- `app/settings.tsx`: `SegmentedButtons` → `AppSegmentedControl` for the
  theme preference picker.
- `app/inbox/[id].tsx`: the `AddVendorFooter`'s `TextInput` →
  `AppTextInput`, `TextInput.Icon` → a plain `IconButton` in the `right`
  slot (same substitution pattern used for every other Paper-affix swap
  this session).
- `app/(auth)/login.tsx`: email/password fields → `AppTextInput`,
  `containerStyle` used for the existing `styles.input` margin (not
  `style`, which only reaches the inner field).
- `app/vendor/[id].tsx`: the 3-tab switcher → `AppSegmentedControl`, the
  "Add a note" field → `AppTextInput` with `containerStyle={{flex:1}}`
  to preserve its row layout next to the Add button (same
  `containerStyle`-vs-`style` distinction as the login fields).
- Re-ran the app-wide sweep afterward (`grep` across every file for a
  Paper `TextInput`/`Chip`/`SegmentedButtons` import, excluding the
  wrapper components themselves) and confirmed zero remaining hits —
  this really is everything now, not just the two originally flagged.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform ios`
bundle built with no errors. No live device interaction this chunk
(style-only changes, same low-risk category as chunk 9's original pass).

### Redesign chunk 23 (2026-10-22) — Checks list — done

Picked for speed (user is about to test on-device): the check *detail*
view already worked (`app/transaction/[id].tsx?type=check`, from an
earlier chunk), so this only needed the missing list screen — no new
detail screen, no new write path.

- Read `checkService.ts`'s `listChecks` directly rather than assume a
  simple table scan — it actually **unions two sources**: the real
  `checks` table, and "legacy" checks (an `expense_transactions` row
  with `payment_method: 'check'`, predating this feature's own table —
  otherwise invisible here even though GL already shows them). Each
  merged row carries a real `legacy: boolean`, which decides whether a
  tap should open `type=check` or `type=expense` on the existing detail
  screen — confirmed via live data that this demo business's 23 checks
  are *all* legacy rows, so the `type=check` branch (routing to the
  real `getCheck`) is still unverified against a populated response,
  while `type=expense` is fully proven (both by this chunk and prior
  ones).
- `services/api.ts`: added `CheckListRow` type + `listChecks()`.
- **`app/checks.tsx`**: exact `bills.tsx`/`invoices.tsx` pattern — status
  filter chips (All/Posted/Draft/Void — check statuses use `'void'`, not
  `'voided'`, a local `CHECK_BADGE` map same reasoning as every other
  entity's own status vocabulary), tap-through routes by `legacy`.
- Wired into the drawer's AP > Checks item and the More tab. Deliberately
  did not touch the Create tab's "Check" stub (still "Available on
  desktop") — writing a new check is a separate, bigger feature not
  attempted this chunk.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform ios`
bundle built with no errors, `GET /checks` hit live — 23 real rows,
confirmed `CheckListRow` field-for-field including the `legacy`/`path`
fields that drove the routing decision above.

### Polish (2026-10-22) — Chart of Accounts filter cleanup — done

User screenshot of web's own CoA filters (a search box + two dropdown
buttons — type and Active/Inactive/All) alongside mobile's chip-row
version, asking to match. Replaced:

- The 6-chip type-filter row → a single `AppChip` dropdown trigger
  (`AppMenu`/`AppMenuItem`, checkmark on the selected option), same
  pattern already used for the GL account filter.
- The binary "Show/Hide inactive" toggle chip → a proper 3-way Active/
  Inactive/All dropdown, matching web exactly (mobile's API only
  distinguishes active-only vs include-all, so `Inactive` filters
  client-side after fetching with `include_inactive: true`).
- Default status stayed `Active` (unchanged behavior, just a cleaner
  control for the same default web also uses).

**Verified**: `tsc --noEmit` clean, confirmed visually via a live
simulator screenshot (the user's own Metro session was already running,
Fast Refresh picked up the change) — matches the two-dropdown layout
from the user's screenshot exactly.

### Redesign chunk 24 (2026-10-22) — AI Suspense — done

What CLAUDE.md's own AI auto-coding rules call out by name: "Unknowns go
to Suspense, never a guess... blocks period close." A line no coding
layer could place lands here with confidence 0, pre-posted to the
client's Suspense system account — this screen is how it gets moved to
where it actually belongs.

- Flat list with inline recode per row (tap to expand an account picker
  + "Remember for this payee" checkbox + Reclassify button), not a
  separate detail screen — same reason as Credit Memos/Vendor Credits:
  there's no `GET` detail route, only list + the one action, matching
  web's own `SuspensePage.tsx` (an inline `AccountSelect` + button, no
  modal). Used a plain `ScrollView.map()` rather than `FlashList` for
  the same reason `payment/new.tsx`'s outstanding-invoices picker did —
  a bounded list of expandable action cards, not a long virtualized
  feed.
- **Deliberately no `ConfidenceBadge`** on this screen, even though it's
  reused everywhere else AI suggestions show up (bank transactions, the
  AI inbox) — confirmed the list payload itself (`SuspenseItem`) carries
  no confidence/band field at all, because every item here is
  confidence-0 by definition. Showing the badge would imply a signal
  that doesn't exist for this data.
- Header stats card (waiting count / total Suspense balance / oldest
  age in days, red-tinted past 30 days) computed client-side from the
  list, matching web's own header strip.
- Recode (`reclassify`) is `accountant`+ server-side — the expanded
  recode form is swapped for a plain permission message when the
  signed-in role doesn't qualify, same pattern as every other role-
  gated action this session, rather than hiding the row's expand
  affordance entirely (viewing what's stuck in Suspense is still useful
  context for a staff login, even if they can't fix it).
- `services/api.ts`: added `SuspenseItem` type + `listSuspenseItems()`/
  `reclassifySuspenseItem()`, shapes read directly from
  `suspenseService.ts`'s actual type definitions and return statements.
- Wired into the drawer's AI > Suspense item and the More tab.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform ios`
bundle built with no errors, `GET /suspense` hit live and confirmed the
`{ account_id, items }` wrapper shape — this business's Suspense account
exists (`account_id` populated) but currently has zero parked items, so
the per-item fields and the reclassify flow are unverified against a
populated response; worth a check once something real lands in Suspense.

### Redesign chunk 25 (2026-10-22) — AI Coding Rules — done

The "learned client rule" layer CLAUDE.md's auto-coding order starts
with — pairs with Suspense (chunk 24) and the AI Document Inbox.

- **No create form, confirmed by reading the whole route file**: rules
  only ever get created implicitly by the auto-coding engine itself
  (e.g. Suspense's "Remember for this payee" checkbox) — only `PATCH`
  (change which account(s) it posts to) and `DELETE` exist, matching
  web's own `CodingRulesPage.tsx` exactly (no create UI there either).
  A rule is keyed on normalized vendor + direction (+ optional bank
  account), not a free-text pattern — confirmed from
  `AccountCodingMemoryTable` directly rather than assumed.
- Flat list, search-by-vendor (client-side substring), tap-to-expand
  inline edit — same structural pattern as Suspense (one `PickerField`+
  `SearchablePicker` per line this time, since a rule can have multiple
  lines, each needing its own target account), Delete with a confirm
  Alert naming the vendor. Both actions `accountant`+, same permission-
  message fallback pattern as Suspense for a lower role.
- `services/api.ts`: added `CodingRule`/`CodingRuleLine` types +
  `listCodingRules`/`updateCodingRule`/`deleteCodingRule`.
- Wired into the drawer's AI > Coding Rules item and the More tab.

**Verified** — this is the first AI-area chunk with real populated
data: `tsc --noEmit` clean, a fresh `expo export --platform ios` bundle
built with no errors, `GET /ai/coding-rules` hit live (5 real learned
rules) confirming `CodingRule`/`CodingRuleLine` field-for-field, then
`PATCH` exercised live by re-applying one real rule's existing
`account_id` (safe — same value, no functional change beyond the
expected `times_corrected`/`updated_at` bump from calling the endpoint
at all). Did **not** call `DELETE` live — removing a real learned rule
with no create endpoint to restore it would be a one-way action, same
caution as skipping `finish` in the Reconciliation chunk.

### Survey (2026-10-22) — scoping the rest of the drawer's disabled items

User asked to keep going "until there are none." Surveyed every
remaining disabled item (grep for a backend route + a registered web
page per item, not full reads) before committing to build anything,
since several drawer labels could plausibly have been aspirational.
Result: **almost everything is real** — routes and web pages exist for
nearly every remaining item. Two exceptions:

- **Payroll is deliberately excluded from web's own sidebar** — a
  comment in `Sidebar.tsx` says so explicitly ("the firm is not
  offering payroll", per a 2026-10-10 meeting). The backend routes and
  web pages still exist in code but are unlinked from web's nav. Mobile
  never had Payroll in its drawer either — confirmed this isn't a
  missed port, so it stays out, matching web's current product
  decision rather than reviving a deprecated area.
- Financial Planning and Spreadsheet Sync have registered web pages but
  no obviously dedicated backend route file — flagged to check their
  real backing before scoping, not built this round.

### Redesign chunk 26 (2026-10-22) — AP Overview, Contractors, 1099s — done

First batch off the survey. Research confirmed one item was redundant
before building anything: **Expense Transactions** is the same
underlying data mobile's unified Transactions tab already shows filtered
to `type=expense` (confirmed by diffing `ExpenseListPage.tsx`'s columns
against mobile's existing `TransactionRow` — only `payment_account_name`
is missing, not worth a whole separate screen for). The drawer's
"Expense Transactions" item now links straight to the Transactions tab
rather than a redundant new build.

- **`app/ap-overview.tsx`**: 4 KPI tiles (outstanding bills + net
  payable, overdue count, due-7d, due-30d) + top-5-vendors-by-balance,
  tapping a vendor opens the existing vendor detail screen. Confirmed
  live there's no aging-bucket breakdown despite the name — just these
  single numbers, matching the real `apOverviewService.ts` rather than
  the AR Aging report's shape.
- **`app/contractors.tsx`**: vendors with `is_1099=true`, via the
  dedicated `/contractors` route (richer than `listVendors` — adds
  masked tax ID display, `***-**-1234` for SSN / `**-***1234` for EIN).
  Read-only: web's firm_admin-only tax-ID-reveal and inline W-9 edit
  aren't built this chunk — low-frequency, higher-sensitivity actions
  not worth rushing.
- **`app/1099s.tsx`**: per-vendor YTD 1099-eligible total paid, a year
  picker (current year back to 3 years prior). Caught a **real bug on
  web** while researching: web's own `TenNinetyNineReportPage.tsx`
  declares a local `tax_id` field that doesn't match what the service
  actually returns (`tax_id_last_four`/`tax_id_type`) — that column
  silently always renders blank on web. Mobile uses the real field
  names. No $600 threshold logic exists server-side (every nonzero
  total is returned); mobile flags the IRS reporting threshold
  client-side as display-only, not duplicated business logic the API
  doesn't have.
- `services/api.ts`: added `ApOverview`/`Contractor`/`TenNinetyNineRow`
  types + `getApOverview`/`listContractors`/`getTenNinetyNineReport`.
- Wired into the drawer's AP group (Overview/Expense Transactions/
  Contractors/1099s) and the More tab — which is getting long (20
  items); worth a reorganization pass once the remaining survey items
  are done, not now.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform ios`
bundle built with no errors, all three endpoints hit live and confirmed
wrapper shapes — empty data for all three (no bills, no 1099 vendors on
this demo business), consistent with every AR/AP chunk's data gap.

### Redesign chunk 27 (2026-10-22) — Customer Statement — done

Closes out the AR group entirely. A date-range (not point-in-time)
statement for one customer — `customer_id` is a required query param,
confirmed there's no bulk/all-customers variant by reading the route
directly, so this is always a one-customer-at-a-time lookup, same as
web's own `CustomerStatementPage.tsx`.

- Single screen (not a reusable wrapper like Aging's `AgingReportView` —
  there's only one party type here, no AR/AP duality to share code
  between): customer picker, From/To date range (defaulting to fiscal-
  year-to-date via the existing `fiscalYearRange` helper), "Balance
  forward" opening row, one row per invoice/payment/credit-memo line
  with a running balance, "Amount due as of {date}" closing row. View-
  only — web's Export-to-Excel/Print buttons aren't built on mobile.
- `services/api.ts`: added `StatementLine`/`CustomerStatement` types +
  `getCustomerStatement()`.
- Added `/customer-statement` to `lib/roleAccess.ts`'s `CLIENT_PAGES` —
  it's in web's own client allow-list (a client can see their own
  statement), matching the other reports already extended the same way.
- Wired into the drawer's AR > Statements item and the More tab.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform ios`
bundle built with no errors. Couldn't do a full live shape check (no
customers exist on this demo business, the same gap that's blocked
every AR/AP chunk), but confirmed the route itself is reachable and
correctly wired — a bogus `customer_id` reached the service layer and
came back with a proper semantic 404 (`"customer not found: ..."`), not
a routing failure, so the endpoint path and query-param parsing are
confirmed even though the response body's field shape isn't.

### Redesign chunk 28 (2026-10-22) — Bank Accounts, Fixed Assets, Receipts, Bank Rules — done

Second batch off the survey, closing out most of the Accounting group.

- **`app/bank-accounts.tsx`**: the existing `BankAccountRow` (used
  app-wide for payment-account pickers) is a narrow 3-field subset — the
  real `/bank-accounts` route returns a much richer row (institution,
  last four, both `bank_balance` — imported feed total — and
  `book_balance` — the ledger's own total), confirmed by reading
  `bankAccountService.ts` directly. Added a separate `BankAccountFull`
  type rather than widening the existing one, since every current picker
  call site only reads the 3 original fields and widening in place would
  have been unnecessary churn. Read-only — create/deactivate are
  `firm_admin`-only, low-frequency setup actions not built this chunk.
- **`app/fixed-assets.tsx`** + **`app/fixed-asset/[id].tsx`**: list +
  detail, read-only (create/edit/depreciate exist server-side, same
  reference-screen scoping as Chart of Accounts). List also shows the
  `ledger_cost_total` figure the route returns alongside the rows — what
  the ledger holds in the accounts the register's active assets sit in,
  a cross-check figure, not derived client-side.
- **`app/receipts.tsx`**: every file attachment across the business, no
  entity filter (the full reference list). Confirmed genuinely separate
  from the AI Document Inbox (staged email imports awaiting coding) by
  reading both route files — Receipts are already-linked attachments on
  7 different entity types. Deliberately no tap-through navigation: the
  linked document could be any of those 7 types, several without a
  mobile screen yet, so nothing is guessed.
- **`app/bank-rules.tsx`**: manually-defined keyword/amount-match rules
  on the bank feed (`bank_transaction_rules` table) — confirmed distinct
  from AI Coding Rules (the engine's own learned rules, different table
  entirely) before building anything. List + delete (`accountant`+) only
  — create/edit forms and web's dry-run/apply-to-account actions aren't
  built this chunk, same scope-tightening as Contractors' reveal/W-9.
- **Also restructured `app/(tabs)/more.tsx`** while adding these: it had
  grown to 25+ items in one flat, unsectioned list with **no
  `ScrollView`** — items past the fold were being silently clipped on a
  small screen, not just visually noisy. Rewrote it as a data-driven
  array of sections (Reports/AR/AP/Accounting/AI, mirroring the drawer's
  own grouping) rendered in a `ScrollView`, so every future addition is a
  one-line array entry instead of a 5-line JSX block, and nothing clips.
- `services/api.ts`: added `BankAccountFull`/`FixedAssetRow`/
  `ReceiptRow`/`BankRule` types + `listBankAccountsFull`/
  `listFixedAssets`/`getFixedAsset`/`listReceipts`/`listBankRules`/
  `deleteBankRule`.
- Wired all four into the drawer's Accounting group and the (now
  sectioned) More tab.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform ios`
bundle built with no errors, all four endpoints hit live — Bank
Accounts confirmed field-for-field against this business's 2 real
accounts (bank_balance `0`/book_balance `7152.64` on one, a real
divergence since nothing's been reconciled, not a bug); Fixed Assets/
Receipts/Bank Rules all confirmed their wrapper shapes but came back
empty — none of those three features have been used on this demo
business yet.

### Redesign chunk 29 (2026-10-22) — Approvals, Recurring Transactions, Integration Transactions — done

Third survey batch. Two deliberate scope decisions made before building
anything:

- **Books Review deferred, not skipped.** Confirmed it's not a flat
  flagged-transactions list — it's a per-fiscal-period checklist
  (`GET /fiscal-periods/:periodId/review-tasks`, no business-wide list
  endpoint), so it needs a period picker first. Mobile has no Fiscal
  Periods screen yet (a separate Setup item still on the survey list) —
  building Books Review properly means building that foundation first,
  so it's paired with Fiscal Periods in a future chunk rather than
  half-built now.
- **Client Overview skipped outright.** Confirmed `/accounting/client-
  overview` on web actually redirects to `/firm`, a `firm_admin`-only,
  cross-business dashboard with no `businessId` in its own route at all
  (`ctx.business_id: null`) — a roster of every business under the firm,
  not a single-business page. This genuinely doesn't fit the mobile
  app's per-business screen model (every other screen this session
  scopes to `activeBusinessId`); porting it would mean inventing a
  firm-wide mode outside that pattern. Left disabled, same category as
  Payroll (chunk "Survey") — a real product-shape mismatch, not
  something to force in.

What shipped:

- **`app/approvals.tsx`**: the queue CLAUDE.md's own HELD_ACTIONS note
  describes — a staff save that posts to the ledger waits here when a
  business has staff entries wait for an accountant. Status filter chips,
  Approve/Reject inline (both `accountant`+; approving replays the
  original held request as the accountant server-side, so it goes
  through every check the original route makes).
- **`app/recurring-templates.tsx`**: read-only list + one simple action —
  pause/resume via a `Switch`, which is literally just `PATCH
  {is_active}` (confirmed there's no dedicated pause/resume endpoint).
  Create/edit-the-payload/run-now/delete exist server-side but aren't
  built here.
- **`app/integration-transactions.tsx`** + **`app/integration-transaction/[id].tsx`**:
  rows imported from a 3rd-party CSV export (Stripe/PayPal/Shopify/
  generic) — confirmed genuinely distinct from both Bank Transactions
  and the AI email inbox by reading all three route files before writing
  anything. Mirrors the Bank Transactions Categorize/Exclude screen
  closely, with one real difference handled correctly: Categorize here
  needs **two** account pickers (cash/clearing side + category side),
  since a row has no `bank_account_id` to imply one side the way a bank
  transaction already does. No detail GET route exists — list-and-find,
  same pattern as Credit Memos/Vendor Credits.
- `services/api.ts`: added `ApprovalRow`/`RecurringTemplateRow`/
  `IntegrationInboxRow` types + the matching list/action functions,
  reusing the existing `BankTransactionSuggestion` type for the
  integration inbox's AI suggestion (confirmed identical shape).
- Wired into the drawer's Accounting group and the More tab's
  Accounting section.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform ios`
bundle built with no errors, all three endpoints hit live and confirmed
wrapper shapes (`{requests, needs_approval}`, `{templates}`,
`{integration_inbox}`) — empty data for all three, consistent with
every chunk's data-sparsity pattern on this demo business.

## Chunk: Setup group (2026-10-22)

Built out all 7 disabled items under the drawer's Setup group. Scope
split cleanly into read-only views (5) and one write-capable screen
(Fiscal Periods), decided per-item after reading the actual routes:

- **`app/entity.tsx`** + **`app/company-settings.tsx`**: both read
  `GET /businesses/:businessId` (`businessService`'s `BUSINESS_COLUMNS`)
  and split its fields into two screens matching web's own Entity vs.
  Company Settings split — Entity shows identity/address fields, Company
  Settings shows fiscal-year/invoicing/AI-automation fields. Both
  deliberately read-only: the PATCH is `firm_admin`-gated server-side and
  wasn't worth building without a real form-validation pass; revisit if
  a user asks to actually edit these from mobile.
- **`app/cost-centers.tsx`**: list + delete (`accountant`+). No
  create/edit this chunk.
- **`app/users.tsx`**: firm-wide roster (`GET /me/firm/users`, not
  business-scoped — gated on the **raw** `user?.role === 'firm_admin'`,
  not the effective per-business role). Deliberately read-only —
  invite/deactivate/role-change/password-reset all exist server-side but
  are high-blast-radius account-security actions that need a dedicated
  security review before shipping on mobile, not a default-yes.
- **`app/activity-log.tsx`**: read-only audit trail, `accountant`+,
  cursor-paginated (`before: <created_at>`) with an explicit "Load more"
  button rather than infinite scroll, matching this app's established
  pagination pattern.
- **`app/tax-codes.tsx`**: read-only list — rate history is append-only
  server-side, no delete/edit route exists.
- **`app/fiscal-periods.tsx`**: the one screen that needed write actions
  to be useful. Close (`accountant`+, optional memo via `Alert.prompt`)
  and reopen (`firm_admin`+, **required** reason via `Alert.prompt`,
  blocked client-side if left blank) call
  `POST /businesses/:businessId/periods/:id/close` and `/:id/reopen`
  directly — confirmed against `periodCloseService.ts` that reopen has
  no server-side memo/reason persistence beyond the audit record, so the
  reason only needs to reach the audit log, not a column.
- `services/api.ts`: added `BusinessAddress`/`BusinessSettings`,
  `CostCenter`, `FirmUserRow`, `ActivityLogRow`, `TaxCode`,
  `FiscalPeriodStatus`/`FiscalPeriod` types + matching list/action
  functions. Verified every shape directly against
  `apps/api/src/db/types.ts` (`FiscalPeriodsTable`, `BusinessesTable`)
  and the route handlers, not guessed.
- Wired into the drawer's Setup group (all 7 now have a `path`) and a
  new Setup section in the More tab.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform ios`
bundle built with no errors (6.1MB bundle, no warnings), all endpoints
hit live against the dev server as the `accountant`-role demo user —
business settings, cost centers (`{cost_centers: []}`), tax codes
(`{tax_codes: []}`), fiscal periods (`{periods: [...]}`, real rows),
and activity log (`{has_more, rows}`, real rows) all returned and match
the hand-written types field-for-field. `GET /me/firm/users` correctly
403'd for the accountant-role demo user, confirming the Users screen's
gate matches the server's.

Setup group is now fully built. Remaining disabled items: the rest of
Reports (Standard Reports, Cash Activity, Custom Reports, Management
Reports, Performance Center, Financial Planning, Spreadsheet Sync — the
last two still need their backend confirmed), Inventory (6 items,
unresearched), and two top-level items (Messages, Send documents).
Payroll and Client Overview remain deliberately excluded (see the
Survey chunk).

## Chunk: Books Review (2026-10-22)

Unblocked once Fiscal Periods shipped. Mirrors web's
`BooksReviewPage.tsx` exactly rather than inventing a different shape:

- **`app/books-review.tsx`**: a period picker (`AppMenu` over the
  existing `listFiscalPeriods`, descending by `starts_on`) defaulting to
  the period containing today, else the latest open period that's
  started, else the latest open period, else the first — same fallback
  chain as web. Below it, a fixed 4-task checklist per period
  (`reconcile_bank`/`post_adjustments`/`review_unreviewed_txns`/
  `close_period`, hardcoded labels — the task set is server-seeded per
  period, not DB-driven on this screen either) rendered as a 3-way
  `AppSegmentedControl` (To do/In progress/Done) + a notes field saved
  on blur + a "Sign off" button. Sign-off is `accountant`+ only
  (`hideUnless`-equivalent: the button simply isn't rendered below that
  role), matching the PATCH route's own `requireMinRole('accountant')`.
  The GET route has no role guard beyond non-client staff+, confirmed by
  reading `periodReview.ts` directly rather than assuming it matched the
  PATCH route's gate.
- `services/api.ts`: added `ReviewTask`/`ReviewTaskStatus`/
  `ReviewTaskKey` + `listReviewTasks`/`updateReviewTask`, hitting
  `GET /businesses/:businessId/fiscal-periods/:periodId/review-tasks`
  and `PATCH /businesses/:businessId/review-tasks/:id` — both confirmed
  against `periodReview.ts` and `PeriodReviewTasksTable` in
  `apps/api/src/db/types.ts`, not guessed.
- Wired into the drawer's Accounting group (previously a bare label with
  no `path`) and the More tab's Accounting section, next to Approvals.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform ios`
bundle built with no errors. Hit both endpoints live: GET returned the
real 4-task checklist for the demo business's first period with
exact-matching field names, and a PATCH (`notes`) round-tripped and was
reverted to confirm the write path works before moving on.

Note: `periodReview.ts`'s two routes are absent from
`apps/api/tests/integration/roleMatrix.test.ts` — a pre-existing gap on
the backend, not something this mobile port introduced or is in scope
to fix.

## Chunk: Reports group, part 1 (2026-10-22)

Researched all 7 remaining disabled Reports items before building
anything. Per-item verdict: Standard Reports is a pure index page (no
API of its own) — ALIAS-FIX, just needs a drawer link to a menu screen.
Cash Activity, Management Reports, and Performance Center are real,
distinct, already-fully-built-on-web features — BUILD. Custom Reports
and Financial Planning are real but substantially larger (full CRUD) —
deferred to their own chunk. Spreadsheet Sync is real but a thin
CSV/PDF-export wrapper, not an actual sync — lowest priority, deferred.

What shipped this chunk:

- **`app/standard-reports.tsx`**: grouped list of links to the 10
  already-built reports, mirroring web's own grouping
  (`StandardReportsPage.tsx`) exactly — no new API integration.
- **`app/cash-activity.tsx`**: a single bank account's register with a
  running balance — confirmed genuinely distinct from the already-built
  Statement of Cash Flows (`cash-flow.tsx`, hitting
  `/reports/statement-of-cash-flows`) by reading both route handlers
  directly; this one hits `/reports/cash-flow` and defaults to the
  Operating Bank Account when no account is picked. Bank-account picker
  (reusing the existing `listBankAccounts`), date range, 3 summary
  tiles, tap-through to the underlying journal entry — same drilldown
  pattern as General Ledger.
- **`app/management-reports.tsx`**: trailing-12-month revenue-by-month
  (rendered as simple proportional bars, no new chart dependency — the
  mobile app has no chart library yet and this doesn't justify adding
  one) + top-10 expense accounts. Entirely read-only, no filters —
  matches the backend's fixed trailing-12-month window exactly.
- **`app/performance-center.tsx`**: revenue/expense/net-income trends
  with a 3M/6M/12M range toggle and period-over-period delta %, both
  computed client-side from the always-12-month API response (same as
  web — there's no server-side range param).
- `services/api.ts`: added `CashActivityReport`/`CashActivityLine`,
  `ManagementReport`, `PerformanceReport`/`MonthAmount` types + 3 new
  fetch functions, all confirmed against the actual route/service files
  (`financialReports.ts`, `managementReportService.ts`,
  `performanceReportService.ts`), not guessed.
- Wired all 4 into the drawer's Reports group and the More tab's
  Reports section.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform
ios` bundle built with no errors. The dev API server had stopped
running since the start of this session and was restarted
(`npm -w @accounting/api run dev`) to live-verify; all 4 endpoints hit
and confirmed field-for-field against the hand-written types —
`/bank-accounts`, `/reports/cash-flow` (real zero-balance data on this
demo business's default account), `/management-report` and
`/performance-report` (both returning real non-zero months from
March–June 2026).

Remaining in the Reports group: Custom Reports and Financial Planning
(both full-CRUD, next chunk), Spreadsheet Sync (deferred, low
priority).

## Chunk: Custom Reports (2026-10-22)

The first full-CRUD report builder in the mobile app. One screen,
two modes (list / builder) rather than a separate route, since the
builder is really just an inline editor over the list:

- **`app/custom-reports.tsx`**: list mode shows saved reports (name +
  group-by + date range), tap to run-and-open in builder mode;
  `accountant`+ gets a delete icon per row (matches the DELETE route's
  own `requireMinRole('accountant')`, confirmed by reading
  `customReports.ts` directly — create/update are `staff`+, delete is
  stricter). Builder mode: name field, date-range pickers, a group-by
  dropdown (account/month/cost_center/customer/vendor), column toggles
  (debit/credit/net, `AppChip`s), and a collapsible account multi-select
  (checkbox list over the existing CoA — empty selection means "all
  accounts," matching the backend's own `account_ids: []` semantics).
  "Run" calls the ad-hoc `POST .../custom-reports/run` without saving;
  "Save & Run" creates it, then runs the saved version. Results render
  as a simple group-key + column table.
- `services/api.ts`: added `CustomReportDefinition`/`CustomReport`/
  `CustomReportRow` types + list/get/create/update/delete/run functions,
  confirmed against `customReportService.ts` and
  `CustomReportDefinitionsTable` directly — particularly the result row
  shape (`{group_key, debit, credit, net}`), which isn't obvious from
  the route file alone.
- Wired into the drawer's Reports group and the More tab.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform
ios` bundle built with no errors. Ran a full live CRUD round-trip
against the dev server: ad-hoc run (grouped by month, real non-zero
data), create, run-the-saved-version (identical rows), then delete
(204) — the demo record was cleaned up after, not left in the
business's data.

Remaining in the Reports group: Financial Planning (full-CRUD budgets,
next chunk), Spreadsheet Sync (deferred, low priority — a thin
CSV/PDF-export wrapper, not a real sync feature).

## Chunk: Financial Planning / Budgets (2026-10-22)

"Financial Planning" is plain budgets + variance, not a distinct
planning module — confirmed no spec exists for it and the backend
(`budgets.ts`) is literally a budget CRUD + variance API. Mirrors web's
`FinancialPlanningPage.tsx` functionally, but adapted for a phone
screen: web renders a full account × 12-month grid for every active
account at once, which doesn't fit mobile — rebuilt as an account
picker + a 12-row vertical list for whichever account is selected, same
underlying per-cell PATCH, no functionality lost.

- **`app/financial-planning.tsx`**: list mode (budgets + status badge +
  `firm_admin`-only delete, matching the DELETE route's
  `requireMinRole('firm_admin')` — stricter than every other write on
  this route, confirmed by reading `budgets.ts` directly) + a "New
  Budget" form (`accountant`+, name + fiscal year). Detail mode: a
  status segmented control (draft/active/archived, `accountant`+) and
  an Edit/Variance mode toggle. Edit mode shows the selected account's
  12 months as editable amount fields, saved on blur via
  `PATCH .../lines` (one cell at a time, same as web). Variance mode
  shows budget/actual/variance per month for that account, colored by
  sign.
- `services/api.ts`: added `Budget`/`BudgetLine`/`BudgetWithLines`/
  `BudgetVarianceRow` types + list/get/create/update/delete/
  setBudgetLine/getVariance functions, confirmed against
  `budgetService.ts` and `BudgetsTable`/`BudgetLinesTable` directly —
  particularly the variance row shape, which isn't derivable from the
  route file alone.
- Wired into the drawer's Reports group and the More tab.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform
ios` bundle built with no errors. Live round-trip against the dev
server: create → get-with-lines → set one line (`PATCH .../lines`,
amount persisted and normalized to `"500.0000"`) → variance (real rows
against actual posted activity) → status update (`draft` → `active`) →
delete attempt correctly 403'd for the accountant-role demo login,
confirming the firm_admin-only gate matches the mobile screen's own
check. The leftover test budget couldn't be cleaned up under this
login (by design) and was left on the demo business — harmless test
data, same as other chunks' demo artifacts.

**Scope exclusion: Spreadsheet Sync.** Confirmed it's a thin
CSV-file-download wrapper (`GET .../csv-exports/{trial-balance,
journal-entries, general-ledger}`, returning `Content-Disposition:
attachment` raw CSV, not JSON) with no actual sync semantics — web just
triggers a browser download. Mobile has no file-download/share
mechanism anywhere in the app (`expo-sharing`/`expo-file-system` are
not installed), and CLAUDE.md is explicit against adding a dependency
"to make it nicer" when a simpler option exists. Since this is also the
lowest-value, least-distinct item in the batch (confirmed by research
before building anything), excluding it is the proportionate call —
same category as Payroll/Client Overview, not a gap to come back to
unless a user actually asks for on-device export.

Reports group is now fully built except that one deliberate exclusion.
Remaining disabled items overall: Inventory (6 items, unresearched),
and two top-level items (Messages, Send documents).

## Chunk: Messages and Send Documents (2026-10-22)

Researched both before building — unlike Spreadsheet Sync, neither
needed anything mobile doesn't already have.

- **`app/messages.tsx`**: one thread per company (not per-conversation —
  matches web's `MessagesPage.tsx`, a single client-to-firm channel),
  polled every 30s (no websocket infra exists to do better). Chat-
  bubble list, composer hidden behind a "view-only can't send" notice
  for the `viewer` role (matches the backend's own `refuseViewOnly`
  gate on the POST route), marks read on load.
- **`app/send-documents.tsx`**: turned out to need no new upload
  plumbing at all — `uploadDocument()` (services/api.ts) and the full
  camera/library/Files picker flow already existed as
  `components/CameraCaptureButton.tsx`, built earlier for a header
  icon. This screen is just a proper landing page wrapping that same
  component, open to the same roles the backend actually allows
  (`refuseViewOnly` — any non-viewer, client included), not gated
  client-only the way web's UI choice to route staff to the AI inbox
  instead implies.
- `services/api.ts`: added `MessageRow` + list/unread-count/post/
  mark-read functions, confirmed against `messageService.ts` directly
  — including that the POST route returns the raw inserted row, not
  the joined list shape, which isn't obvious from the route file alone.
- `lib/roleAccess.ts`'s `CLIENT_PAGES`: added `/messages` and
  `/send-documents` — confirmed against web's own `roleAccess.ts`
  client allow-list and `apps/api/src/lib/clientAccess.ts`, both of
  which already permit a client login on these two pages. Without this
  the drawer would have hidden both from client logins even though the
  backend fully allows them.
- Wired into the drawer (both are top-level items, not inside a group)
  and a new "General" section at the top of the More tab.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform
ios` bundle built with no errors. Hit all 4 message endpoints live:
list (empty thread), unread-count, post (real row persisted), mark-read
— all matching the hand-written types.

Remaining disabled items overall: Inventory (6 items).

## Chunk: Inventory group (2026-10-23)

Researched all 6 items before building — confirmed real, distinct,
buildable features (the backend has a full `services/inventory/`
surface: items, stock movements, purchase orders, item receipts, sales
orders, shipping labels). No scope exclusions this chunk; every item
shipped.

What shipped:

- **`app/inventory-overview.tsx`**: KPI dashboard (`GET
  /inventory-overview` — item count, stock value, unposted value) +
  recent receipts/fulfilled sales + a "Post opening balance"
  action (`accountant`+, optional entry date) for whatever unposted
  stock value exists.
- **`app/inventory-items.tsx`**: list + detail, in the established
  list/detail-toggle-in-one-screen pattern. Create/edit `staff`+,
  delete `accountant`+. Detail view adds an "Adjust stock" action
  (date + signed quantity + reason + memo) and a stock-movement history
  list. **Caught during live verification**: the create form originally
  had no income/expense/inventory-asset account fields — without an
  asset account, `POST .../item-receipts` refuses with
  `PRECONDITION_FAILED` ("item has no inventory_asset_account_id"), a
  real blocker, not a hypothetical. Added all 3 account pickers to
  create, plus a "Set/Change asset account" action on the detail view
  for items created before this fix.
- **`app/purchase-orders.tsx`** + **`app/purchase-order/new.tsx`** +
  **`app/purchase-order/[id].tsx`**: status-filtered list, a line-item
  builder (item picker + qty + unit cost, add/remove lines, running
  total), and a detail view with a "Receive" shortcut (`staff`+, jumps
  into Item Receipts with the PO pre-selected) and void (`accountant`+).
  **Caught during live verification**: initially gated "Receive"/the
  Item Receipts PO picker to `sent`/`received` status only — reading
  web's `PurchaseOrderDetailPage.tsx` `canReceive` gate directly showed
  a `draft` PO can be received too (there's no separate "send" step at
  all); fixed both the picker filter and matched web's exact
  void-exclusion set (`void`/`received`, not just `void`).
- **`app/item-receipts.tsx`**: list + inline create (PO picker + date +
  memo) — no detail page, matching the backend (list-and-create only,
  no GET /:id route). Accepts an optional `poId` route param so the PO
  detail screen's "Receive" button can pre-select it.
- **`app/sales-orders.tsx`** + **`app/sales-order/new.tsx`** +
  **`app/sales-order/[id].tsx`**: same shape as purchase orders
  (status-filtered list, line-item builder with customer + items), plus
  fulfill (`accountant`+, creates the linked invoice) and void.
- **`app/shipping-labels.tsx`**: list + inline create + delete
  (`accountant`+). **Caught during live verification**: the backend's
  `shippingLabelCreateSchema` has a `.refine()` requiring either
  `invoice_id` or `sales_order_id` — a live `VALIDATION_FAILED` with
  empty `field_errors` (refinement errors don't map to a field) surfaced
  this. Fixed by adding an Invoice/Sales order segmented toggle (the
  form originally only offered sales order, and treated it as
  optional) so a label can link to either, matching what the schema
  actually requires.
- `services/api.ts`: added the full inventory type/function surface —
  `InventoryOverview`, `InventoryItem`/`InventoryItemWithMovements`/
  `StockMovement`, `PurchaseOrder(WithLines)`, `ItemReceipt`,
  `SalesOrder(WithLines)`, `ShippingLabel` + every list/get/create/
  update/delete/action function — all confirmed against the actual
  route and service files (`inventoryItems.ts`, `inventoryOverview.ts`,
  `purchaseOrders.ts`, `itemReceipts.ts`, `salesOrders.ts`,
  `shippingLabels.ts`, `inventoryItemService.ts`,
  `inventoryOverviewService.ts`, `purchaseOrderService.ts`,
  `itemReceiptService.ts`, `salesOrderService.ts`,
  `shippingLabelService.ts`) and the matching `apps/api/src/db/types.ts`
  tables, not guessed.
- Wired all 6 into the drawer's Inventory group and a new Inventory
  section on the More tab.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform
ios` bundle built with no errors (6.4MB). Full live round-trip against
the dev server for every entity: inventory item create → get →
adjust-stock → update (including the asset-account fix); purchase
order create → get → void; item receipt create against a draft PO
(correctly 404/precondition-checked before the asset-account fix, then
succeeded up to an unrelated pre-existing demo-business data issue — an
inactive AP account on this seed business, not a code bug); sales
order create → get → void; shipping label create (linked to a sales
order) → list (confirmed the `so_number`/`invoice_number` join) →
delete (204). Two throwaway demo records (a test customer, one
inventory item) were left on the demo business from this verification,
consistent with every other chunk's demo-data footprint this session.

This closes out the entire "continue until there are none" mandate for
the Inventory group — the last unresearched area. Remaining disabled
items app-wide: none identified in this session's research passes
beyond the deliberately excluded Payroll, Client Overview, and
Spreadsheet Sync.

## Chunk: Create tab stubs — Invoice, Check, Journal Entry (2026-10-23)

A final sweep of the app (not just the drawer — the Create tab's own
`STUB_ITEMS` list) turned up three more disabled "new" forms: Invoice,
Check, and Journal Entry. All three already had list/detail screens
built in earlier chunks (`invoices.tsx`/`invoice/[id].tsx`,
`checks.tsx` + `transaction/[id].tsx`'s `type=check` case,
`journal-entries.tsx` + `transaction/[id].tsx`'s `type=journal` case)
— only the creation form was missing in each case, which is exactly
what the Create tab's disabled placeholders were marking.

- **`app/check/new.tsx`**: payee (vendor/customer/free-text toggle),
  bank account, date, an auto-fetched next check number, and a
  multi-line category/description/amount editor (expense accounts
  sorted first, matching web's `CheckPage.tsx` ordering — but not
  restricted to expense-only, same as web). Posts immediately on save
  (no separate draft step — confirmed by reading `checkService.ts`
  directly), `staff`+.
- **`app/invoice/new.tsx`**: customer, auto-fetched next invoice
  number, issue/due dates (due date defaults to +30 days, matching the
  net-30 fallback used elsewhere in this app), and a line editor
  (description + revenue account + qty + price). Create is `staff`+
  but **posting is `accountant`+ only** — matched to web's own
  `useSaveAndPost` gate (`canPost = hasMinRole(role, 'accountant')`)
  rather than assumed: a staff login only sees "Save draft," an
  accountant+ login sees both "Save draft" and "Save & post."
- **`app/journal-entry/new.tsx`**: date, auto-fetched next journal
  number, and a debit/credit line editor (tap a chip to flip a line
  between debit and credit) with a live balanced/out-of-balance
  indicator — Save is disabled until debits equal credits, matching
  the schema's own two-line-minimum and balance requirement. Gated
  `accountant`+ end-to-end: hidden from the Create tab for lower
  roles (matching the route's `requireMinRole('accountant')`) rather
  than shown and left to 403.
- `services/api.ts`: added `createCheck`/`getNextCheckNumber`,
  `createInvoiceDraft`/`postInvoice`/`getNextInvoiceNumber`,
  `createJournalEntry`/`getNextJournalNumber` + their types.
- `app/(tabs)/create.tsx`: removed the `STUB_ITEMS` disabled-placeholder
  array entirely and wired all three to real routes.

**Two real bugs caught during live verification, not hypothetical:**
1. `journal-entries/next-number` returns `{ journal_number }`, not
   `{ next_number }` as first assumed — a live curl check caught the
   mismatch before it shipped; fixed the type and accessor.
2. `POST /invoices` (create draft) returns `{ invoice, lines }`, not
   the invoice fields flat — unlike `postInvoice`, which does return
   them flat. A live curl showed the real shape; `createInvoiceDraft`
   now unwraps `.invoice` before returning, so the screen's existing
   `created.id` usage needed no further change.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform
ios` bundle built with no errors. Full live round-trip for all three:
check create (posted immediately, real `journal_entry_id` attached);
invoice create → post → get (hit a pre-existing inactive-AR-account
precondition on this demo business first, same category of issue as
the inventory chunk's inactive-AP-account hit — temporarily reactivated
the account to complete verification, confirming the request/response
shapes rather than leaving the check incomplete); journal entry create
→ get, confirmed balanced two-line entry posts and the auto-incrementing
journal number is correct.

This was the actual last remaining stub in the app — the Create tab's
own placeholder list, not just the drawer. No further disabled/stub
entry points are known as of this chunk.

## Chunk: Spreadsheet Sync (2026-10-23)

Previously excluded (2026-10-22 chunk) because it needed a file-
download/share mechanism this app didn't have, and was the lowest-
value item in that batch. Revisited on explicit user request — asked
which of the three remaining "coming soon" items (Payroll, Client
Overview, Spreadsheet Sync) to tackle, user chose this one specifically
(smallest scope, the other two need either a new architecture decision
or a full feature area).

- Added `expo-sharing` (~58.0.20) and `expo-file-system` (~58.0.10) via
  `npx expo install` (SDK-58-matched versions, not hand-picked).
- **`app/spreadsheet-sync.tsx`**: a report-type chip row (Trial Balance
  / Journal Entries / General Ledger — the same 3 reports web's
  `SpreadsheetSyncPage.tsx` exports, confirmed by reading
  `csvExportService.ts` directly) with the matching date filter(s) per
  report (as-of date; or a from/to range, with an optional account
  filter for General Ledger). "Export CSV" fetches the raw CSV text
  from the existing `/csv-exports/*` routes (`responseType: 'text'`,
  since these return `Content-Type: text/csv`, not JSON), writes it to
  a cache file via the new `File`/`Paths` API (`expo-file-system`'s
  SDK-58 class-based API, not the legacy `FileSystem.writeAsStringAsync`
  function API), then opens the native share sheet
  (`expo-sharing`'s `shareAsync`) — save to Files, AirDrop, mail, or
  open directly in a spreadsheet app already on the device. Matches
  what web actually does (a browser download), not a real two-way sync
  — there's no Google Sheets/Excel Online connection anywhere in this
  codebase, confirmed by the absence of any such integration.
- `services/api.ts`: added `exportTrialBalanceCsv`/
  `exportJournalEntriesCsv`/`exportGeneralLedgerCsv`, each returning
  `{content, filename}` with the filename built client-side to match
  `csvExportService.ts`'s own naming convention exactly.
- Wired into the drawer's Reports group and the More tab.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform
ios` bundle built with no errors (6.5MB, both new native modules
included). Hit all 3 export endpoints live and confirmed real CSV
content with the exact headers and filename my code expects
(`Content-Type: text/csv`, `Content-Disposition: attachment;
filename="..."` matching byte-for-byte what the client constructs).
**Not verified**: the on-device half (`File.write` to cache, then
`Sharing.shareAsync`) — curl can exercise the HTTP fetch but not native
file-system/share-sheet behavior; that needs an actual simulator or
device run, which the user should do themselves per this app's
established division of labor (localhost/device acceptance testing is
the user's side of verification, not something a backend check can
substitute for).

All three deliberately-excluded "coming soon" items are now resolved
or explicitly deferred: Spreadsheet Sync shipped; Payroll and Client
Overview remain excluded, pending the user's call on whether to tackle
either (Payroll is a full new feature area; Client Overview needs an
architecture decision since it's firm-wide, not per-business).

## Chunk: Estimates (2026-10-23) — closing a gap found via the capability guide

User shared a "Mobile vs Web Capability Guide" doc (a feature-parity
checklist across 12 areas, dated today) and asked to follow it to tweak
up the mobile app. Cross-checked every row in the guide against the
actual codebase (`ls app/`, `grep` for each named feature) rather than
trusting it outright — it turned out to be accurate for essentially
everything, including features shipped earlier in this very session
(Checks' create-only scope, Invoice draft+post, Journal Entry's
accountant-gating, the inventory item account pickers). **One real
gap found**: the guide claims "Estimates list ✅ Read" on mobile, but
no `estimate`/`estimates` file existed anywhere in `apps/mobile` — this
was the single discrepancy between the guide and reality.

- Confirmed the backend is real (`apps/api/src/routes/estimates.ts`,
  spec at `docs/specs/2026-10-20-estimates-design.md`) before building:
  list/get are open reads; create/edit/convert-to-invoice are `staff`+;
  delete is `firm_admin`+. Scoped mobile to match the guide's own claim
  exactly — read-only (list + detail), no create/edit/convert/accept/
  delete actions.
- **`app/estimates.tsx`**: status filter chips (pending/accepted/
  rejected/closed) + list, same `invoices.tsx`/`bills.tsx` pattern.
- **`app/estimate/[id].tsx`**: customer, dates, memo, line items,
  subtotal/tax/total, and — when the estimate was converted — a tap-
  through link to the resulting invoice (`estimate.invoice_id` +
  `invoice_number`, both confirmed present on the real detail response).
- `services/api.ts`: added `EstimateStatus`/`EstimateRow`/
  `EstimateLine`/`EstimateDetail` types + `listEstimates`/`getEstimate`,
  confirmed against `estimateService.ts`'s actual return shapes
  directly — in particular that `getEstimate` returns a nested
  `{estimate, lines, invoice_number}`, not the row flat, which isn't
  obvious from the route file alone.
- Wired into the drawer's AR group (next to Invoices) and the More
  tab's AR section. No `CLIENT_PAGES` change — confirmed estimates
  aren't in web's own client allow-list either, so the existing
  default-deny for the `client` role already matches web's behavior
  with no new code.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform
ios` bundle built with no errors (6.5MB). Live round-trip against the
dev server: list (empty, `{estimates: []}`), then created a real
throwaway estimate to exercise the full shape — list now showing it
with `customer_name` joined, and `GET /estimates/:id` confirmed the
exact `{estimate, lines, invoice_number}` nesting the mobile type
expects, field-for-field. A delete attempt correctly 403'd for the
accountant-role demo login (delete is `firm_admin`-only) — the leftover
test estimate (`EST-0001`) couldn't be cleaned up under this login and
was left on the demo business, same category as every other chunk's
harmless demo-data footprint this session.

With this, every claim in the user's capability guide now matches the
actual mobile codebase — no further gaps found in that cross-check.

## Chunk: Retire the nav drawer, fold it into the More tab (2026-10-24)

User's own idea: drop the hamburger-triggered slide-out drawer entirely
and have that same grouped-nav design appear as the body of the More
tab instead. Also fixed a real drift this surfaced: the drawer's
`NAV_GROUPS` (a structural port of web's `Sidebar.tsx`, with role
filtering via `canOpen` and "Desktop only" disabled treatment) and the
old More tab's separate hand-maintained `SECTIONS` array had fallen out
of sync — the latter was missing items (Expense Transactions, Pay
Bills, the disabled Client Overview placeholder) and had no role
filtering at all.

- **`app/(tabs)/more.tsx`**: now renders the drawer's exact former
  content — same groups/icons/ordering, the same expand/collapse
  accordion state, the same `canOpen`-based role filtering (a
  role-denied item is dropped entirely, not shown disabled — that
  treatment stays reserved for features this app hasn't built), the
  same "Desktop only" disabled rows, the same dark sidebar-navy
  styling — as a static page instead of an animated overlay. Dashboard
  and Transactions are left out of the list (the bottom tab bar already
  covers them); Create keeps its own button here instead of a duplicate
  list row. Switched the color tokens from the drawer's hardcoded
  `lightColors` to `theme.app.*` while doing this, so the panel now
  actually follows dark mode instead of always rendering light-palette
  navy regardless of the user's theme setting — a latent bug in the
  original drawer, not something this chunk introduced.
- **`components/AppHeader.tsx`**: removed the hamburger `IconButton`
  and its `useNavDrawer` call — there's nothing left for it to open.
  The business switcher that lived in that same row stays (it's
  independent of the drawer, not something this chunk needed to move),
  just re-padded now that it's the row's leading element instead of
  sitting next to a hamburger.
- **Deleted** `components/NavDrawer.tsx` and `hooks/useNavDrawer.tsx`
  outright (confirmed via `grep` that nothing else referenced either
  before removing them) and un-mounted `NavDrawerProvider`/`<NavDrawer
  />` from `app/_layout.tsx`.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform
ios` bundle built with no errors (6.5MB, unchanged from before — the
Reanimated dependency the drawer used for its slide animation is still
pulled in by other screens, so removing the drawer didn't shrink the
bundle, which is expected and fine). No live device/simulator check
this chunk — a navigation-restructuring change like this is exactly the
kind of thing worth a real tap-through pass before trusting it fully,
same caveat as every other UI-only chunk this session with no
screenshot or simulator session available.

## Chunk: Drop the dark sidebar skin on the More tab (2026-10-24)

The previous chunk's fold-the-drawer-into-More-tab design turned out to
read as broken, not intentional — the user checked against QBO's actual
mobile app (its Menu tab is a plain light page of grouped shortcuts;
QBO deliberately drops the desktop dark sidebar skin for mobile
entirely) and confirmed the suspicion raised at the end of the last
chunk: a light `AppHeader` sitting directly above a dark-navy panel
with no transition reads as a stalled/broken overlay animation, not a
real design.

- **`app/(tabs)/more.tsx`** rebuilt to match: no dark background
  anywhere — the whole screen now uses the same `theme.colors.background`
  every other tab uses. A compact user strip (name + a `StatusBadge`
  role pill + email) replaces the old dark-panel user block. "+ Create"
  is now the real `AppButton` (`default` variant — this app's actual
  brand action color, blue, not the dark-sidebar-specific gold the
  previous chunk used), `fullWidth`, gated the same `canOpen('/expense/
  new')` check as before. Each group is a plain uppercase caption-style
  header row (label + chevron-up/down, no icon — distinct from a leaf
  item row on purpose, so a header doesn't read as just another
  tappable destination) that expands to 48px item rows (icon + label +
  trailing chevron-right, `surface` background, `border` bottom
  separator, `muted` background on press) — independent per-section
  expand state, same as before, all collapsed by default. Role-denied
  items are still dropped entirely (not shown disabled) and features
  this app hasn't built yet still show as a disabled row with a
  "Desktop only" label in place of the chevron — both unchanged in
  behavior, just restyled onto the new light row.
- Same `NAV_GROUPS` data (items, ordering, role filtering via
  `roleAccess.ts`) as the prior chunk — this was purely a visual
  restyle, not a content change.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform
ios` bundle built with no errors (6.5MB). Still no live device/
simulator pass — recommended again, same as the last chunk, before
trusting this fully; this is now the second restyle of this same
screen in two days, which is exactly the kind of churn a real look at
a running simulator would have caught earlier.

## Chunk: More tab — shortcut grid, third pass (2026-10-24)

Third restyle of this one screen in two days. The light-theme row list
from the last chunk was correct in spirit (no dark skin, matches QBO)
but still read as a settings dump — every destination an equally-
weighted small text row, nothing scannable at a glance. This pass adds
a 2-column shortcut-tile grid (QBO mobile's own pattern) for the 6
most-used destinations, so the common case needs no expanding at all.

- **Shortcut grid**: Invoices, Expenses, Customers, Vendors, AI Inbox,
  Messages — 80px tiles, `surface` background, `border` border, 8px
  radius, a 24px icon above a 13px label, 2 per row with an 8px gap.
  Each tile's path is the exact same route its group-accordion sibling
  already used (e.g. the Invoices tile and AR's old "Invoices" row both
  go to `/invoices`) — a dedicated shortcut, not a second screen.
- **Removed the duplicates** from the accordion below: Invoices/
  Customers out of Accounts Receivable, Expense Transactions/Vendors
  out of Accounts Payable, Document Inbox out of AI, and the standalone
  Messages row dropped entirely — all six now live only as tiles.
- **Section headers** went from tiny uppercase caption text (read like
  a form-field label, not a tappable row) to 56px rows at 15px medium
  weight — same expand/collapse behavior, still collapsed by default.
- **Child rows** grew from 48px to 52px and, this round, got real
  per-item icons for the first time — `NavChild` never carried one in
  any earlier version of this file (only the top-level/group entries
  ever had icons), so these ~50 icon choices were pulled from the
  original pre-drawer version of this same screen's own `SECTIONS`
  array (still in scratch context from earlier this session) rather
  than invented fresh — every icon here already meant that exact
  feature somewhere in this app's history, not a new guess.
- **Send documents** moved out of the grid/accordion entirely into its
  own row at the bottom, next to Settings, matching the brief's "bottom
  section" placement.
- No changes to `AppHeader`, the bottom tab bar, routing, or any other
  screen — purely this one screen's body content, as scoped.

**Verified**: `tsc --noEmit` clean, a fresh `expo export --platform
ios` bundle built with no errors (6.5MB). Still no live device/
simulator pass. Flagging plainly: three restyles of one screen without
ever seeing it rendered is not a sustainable loop — a single real
screenshot at this point would likely save more churn than another
round of spec-from-memory changes. Recommend an actual simulator check
before touching this screen again.
