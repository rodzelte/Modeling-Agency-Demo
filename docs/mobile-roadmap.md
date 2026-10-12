# Talent mobile portal: architecture and roadmap

Status: **Mobile 2 (memberships) built; the rest is plan only.** This work starts after the GHL sync is live and verified (see [ghl-sync.md](ghl-sync.md)). Nothing here changes the CRM sync.

## What already exists

Phase 15 built a talent portal at `/portal` (migration `024`):

**Sign-in and account linking**
- Talent sign in with a magic link.
- Staff invite them from the talent's **Portal** tab (`invite_talent_to_portal`), which creates an `agency_members` row with role `talent` and a `talent_id`.
- The link is: `auth.users` → `agency_members` (role talent, `talent_id`) → `talent` → `ghl_contacts.talent_id` → GHL contact ID.

**Isolation**
- `current_talent_id()` drives every portal policy, so a talent only ever reaches their own row.
- Staff permissions can never be granted to the talent role. A database trigger enforces this.

**Changes need approval**
- Contact, address, measurement and Instagram edits are *requests* (`talent_change_requests`), which staff approve with `apply_change_request`.
- Uploaded digitals arrive as `pending` and can only become public after staff approve them (`guard_photo_review`).

**Other pages:** availability, shared documents and bookings.

So Mobile Phase 1 is mostly done. What's missing is mobile polish, entitlements (free vs paid) and native distribution.

## Recommended architecture: A now, C later

| Option | For | Against |
|---|---|---|
| **A. Responsive Next.js portal + PWA** | Reuses everything: same auth, RLS, routes and UI. One codebase. Can be installed to the home screen on iOS (16.4+) and Android. Camera uploads work through the `<input capture>` file picker. Web push works on Android, and on iOS once installed. | No App Store presence. iOS push only works after installing to the home screen. Limited background features. |
| **B. Expo / React Native app on the same Supabase backend** | App Store and Google Play listings. Native camera, push and offline use. | A second UI codebase. App review cycles. Must re-implement the portal screens. |
| **C. Both: PWA first, then an Expo app** | Ships value now. A native app later reuses the same database, RLS, RPCs and API routes, with no new backend. | The native app is extra work, but only when it's justified |

**Recommendation: C.** Start with **A**, because the portal exists and only needs mobile polish, a manifest and entitlements. Add an **Expo** app (B) only if App Store presence or reliable iOS push becomes a business need.

Both clients talk to the **same** Supabase project and the **same** `/api/portal/*` routes. There is no separate mobile database.

## Free vs paid: entitlements (Mobile Phase 2)

Paid access is enforced **in the database**, so the browser, iOS and Android are all subject to the same rules. Hiding a button is never the control.

```text
plans                 id, key ('free','pro'), name, active
plan_features         plan_id, feature_key ('profile.edit', 'photos.upload', 'portfolio.manage', ...), limits jsonb
billing_customers     talent_id, provider ('stripe' | ...), provider_customer_id
subscriptions         id, talent_id, plan_id, provider, provider_subscription_id (unique),
                      status ('trialing','active','past_due','canceled','expired'),
                      current_period_end, cancel_at, updated_from_event_id
billing_events        provider, event_id (unique), type, payload, received_at, processed_at   -- idempotent webhook log
talent_entitlements   view: features granted to a talent now
                      = free plan features
                        ∪ features of subscriptions with status in ('trialing','active')
                        ∪ ('past_due' within a grace period, if the owner wants one)
has_entitlement(feature text) returns boolean      -- security definer, uses current_talent_id()
```

Enforcement points. Each one is a database rule, so no client can skip it:
- **`talent_change_requests` insert policy:** adds `and public.has_entitlement('profile.edit')` for groups that are paid-only. For example: free users may still request contact corrections, but only paid users may request profile customisation.
- **`talent_photos` "talent add own digitals" policy:** adds `has_entitlement('photos.upload')`, plus a count limit from `plan_features.limits`.
- **`storage.objects` "talent upload own digitals" policy:** the same check, so a direct Storage upload with the user's token is refused too.
- **API routes** (`/api/portal/*`) check the same function for a friendly error. The database refuses regardless.
- **Writes to `subscriptions` and `billing_events`:** only the payment webhook can make them, using the secret key after verifying the provider's signature. A client can never write "I paid".

**Payments (Mobile Phase 2):**
- The provider isn't chosen yet; Stripe is the likely default.
- `POST /api/billing/webhook` verifies the signature, stores the event once (keyed on `event_id`), and maps provider states to `subscriptions.status`.
- Entitlements follow from status:

| Status | Paid features |
|---|---|
| `trialing`, `active` | Yes |
| `past_due` | Optional grace period |
| `canceled`, `expired` | No |

- Checkout is started from a server route that creates a provider session. The app never handles card data.
- **App Stores:** Apple and Google require in-app purchase for digital features *sold inside a native app*. Plan either web-only sign-up, or RevenueCat or store billing feeding the same `subscriptions` table, before Mobile Phase 4.

## Photo moderation (Mobile Phase 3)

Today's flow is upload → `review_status = 'pending'` → staff approve → staff make public. Phase 3 extends it:
- **States:** `uploaded` → `pending_review` → `approved` / `rejected` → `published`.
  - Map these onto `review_status` and the existing `public` / `publish_to_website` flags, rather than adding a parallel column.
- **Roles:** staff keep sole control of which photo is the Headshot, 3/4 or Full Body (`talent_photos.photo_role`, added for the GHL sync) and of what is public.
- **Talent:** may suggest a role, which staff confirm.
- **Review queue:** portal uploads already appear in Dashboard → Talent requests.

## Roadmap

| Phase | Scope | Notes |
|---|---|---|
| **Mobile 1: polish what exists** | Web app manifest and icons; mobile layout pass on `/portal`; "Add to Home Screen" prompt; show CRM program tags and approved photos on the portal home; magic-link deep links | No schema change |
| **Mobile 2: entitlements and billing** | **Built (migration 031):** plans, plan_features, talent_subscriptions, billing_events, `has_entitlement()`, RLS on change requests, availability, digitals and storage; `/portal/subscribe`; Dashboard → Memberships (require switch, free access). **Left:** Stripe Checkout route and verified webhook writing 'stripe' rows | Provider: Stripe on the web (avoids store fees); keys in Vercel (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) |
| **Mobile 3: paid photo management** | Paid upload limits; status flow above; talent-suggested photo roles; staff moderation queue improvements | Builds on Phase 2 entitlements |
| **Mobile 4: native app (if justified)** | Expo app reusing Supabase Auth and `/api/portal/*`; push notifications (Expo push, with tokens stored per device); store listings; privacy labels | Decide on store billing first |
| **Mobile 5: bookings, castings and training** | Casting calls, booking confirmations, training schedule (from the GHL custom values already mirrored), attendance | Extends the operations module |

## Security invariants (all phases)

- A talent can only reach rows where `talent_id = current_talent_id()`.
- Paid features are checked in RLS or security-definer RPCs, never only in the UI.
- GHL credentials never reach any client. Talent devices talk only to our backend, which syncs GHL.
- Subscription state changes only through verified payment webhooks.
