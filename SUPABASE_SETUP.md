# Supabase setup — Cywrld

The movie guide is static and uses `movies.json` when no backend is configured or the online catalog is unavailable. The product store has local preview listings; checkout and downloads remain disabled until both Stripe and Supabase are configured. Accounts, private support conversations, ratings, shared catalog administration, the release calendar, and product management require a Supabase project. No backend credentials or live payment provider are included.

## 1. Configure public browser settings

1. Create a Supabase project.
2. In **Project Settings → API**, copy the project URL and its **anon/public** key (a publishable key is suitable on supported projects).
3. Edit `supabase-config.js`:

   ```js
   window.CINEJOY_SUPABASE = Object.freeze({
     url: "https://YOUR_PROJECT_REF.supabase.co",
     anonKey: "YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY",
     providers: Object.freeze({
       emailPassword: true,
       google: true
     }),
     notifications: Object.freeze({
       ownerEmailEnabled: false
     }),
     payments: Object.freeze({
       checkoutEnabled: false
     })
   });
   ```

   Keep `google: false` until Google OAuth is configured; keep owner email notifications and `payments.checkoutEnabled` false until their server-side setup and tests are complete. The anon/publishable key is public by design, but only appropriate with RLS. **Never put a service-role key, OAuth client secret, Stripe secret, Stripe webhook secret, Resend key, or other secret in this file or any browser asset.**

4. Host the site over HTTPS. For local testing, serve the folder through a static HTTP server; opening HTML through `file://` commonly blocks `movies.json`. In Supabase **Authentication → URL Configuration**, set the hosted site's URL and add the exact hosted redirect URLs for `account.html`, `messages.html`, and `admin.html` (plus your local test origin if needed).

## 2. Create tables, private threads, calendar, and RLS

Run all of `supabase-setup.sql` in the Supabase **SQL Editor**. The script is intended for initial setup and creates:

- A public-readable `movies` catalog with writes limited to authenticated Cywrld admins.
- `message_threads` and append-only `thread_messages`. Each thread stores a server-derived owner email and Auth user ID. Thread participants and admins can read; clients can append to their own open threads; admins can reply, close/reopen threads, and see the account email/ID. Replies are actual database messages and appear to the client in **Messages** after sign-in.
- Public-readable ratings/reviews. Submissions require an authenticated account, are limited to one review per film/account, and have a database per-account rate limit; admins can moderate/remove them.
- An admin-only movie release calendar. It records a film, date, status, and note; it is **scheduling metadata only**. It does not upload or store movie files. The editor can upload small poster images to the configured Storage bucket.
- Digital-product metadata, admin-only Stripe Price IDs and private Storage paths, pending/paid checkout orders, buyer-owned entitlements, and webhook event receipts. Browser roles cannot create or update orders or entitlements.
- An append-only `admin_audit_log` written by database triggers for catalog, thread/reply, release calendar, product administration, payment state, entitlement grants, review moderation, and storage changes. Browser roles receive no update/delete grants for the log.
- A public-read/admin-write `movie-posters` bucket and a private, admin-write `digital-products` bucket restricted to ZIP/PDF/EPUB files up to 100 MB.

RLS is the authorization boundary, not hidden buttons, an unlisted `admin.html` URL, or frontend role checks. Review the SQL and policies for your deployment before inviting users. See [SECURITY.md](SECURITY.md) for deployment headers, safeguards, and remaining limits.

## 3. Enable email/password and Google sign-in

The account and admin pages support email/password sign-up/sign-in and Google OAuth. A Google button is hidden until `providers.google` is explicitly enabled above.

**Email/password**

1. In **Authentication → Sign In / Providers**, enable Email and select the password/confirmation behavior you want.
2. Set the site's allowed redirect URLs in **Authentication → URL Configuration**.
3. Set `providers.emailPassword: true` only after enabling the provider. New sign-ups are ordinary client accounts and do not become admins.

**Google OAuth**

1. In Google Cloud Console, create an OAuth client for a web application. Add your production domain (and local development origin, if used) to **Authorized JavaScript origins**.
2. In Supabase **Authentication → Sign In / Providers → Google**, enable Google and enter the Google client ID and client secret **in the Supabase dashboard only**.
3. Copy the Supabase callback URL shown in that provider panel (normally `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`) into the Google OAuth client's **Authorized redirect URIs**.
4. Add your site routes (`https://YOUR_SITE/account.html`, `/messages.html`, `/admin.html`, and local test equivalents) to Supabase's Auth redirect URL allow-list.
5. Test a Google sign-in/sign-up redirect, then set `providers.google: true` in `supabase-config.js`.

Do not copy the Google client secret into this website. Google-created accounts also start without administrator access.

## 4. Grant administrator access

1. In **Authentication → Users**, create or select the account that should administer Cywrld. Use a strong, unique password for email accounts.
2. Copy that user's UUID and run this in the SQL Editor, replacing the placeholder:

   ```sql
   update auth.users
   set raw_app_meta_data =
     coalesce(raw_app_meta_data, '{}'::jsonb) || '{"cinejoy_admin": true}'::jsonb
   where id = 'YOUR_AUTH_USER_UUID'::uuid;
   ```

   This sets trusted `app_metadata`; do not authorize using user-editable `user_metadata`. Sign out and back in for a fresh token. A normal signed-in account can use private client threads but cannot access the admin console's protected data or mutations.
3. Sign in at `admin.html`. Choose **Import bundled films** to seed/update the sample catalog.

## 5. Use private in-site messages

Clients sign in or create an account at `account.html`, then use `contact.html` or `messages.html`. The server associates new threads with the authenticated account and records its email; clients can only read their own threads. Admin replies are persisted as `thread_messages` and appear in that client's Messages page. Closing a thread prevents further client replies until an admin reopens it.

The default setup sends **no email notification**. Admin replies are delivered inside the website, not by email. The Resend notification in section 7 is only an optional email alert to the site owner and does not send replies to clients.

## 6. Configure owner email notifications (optional)

Owner email notification uses a server-side Supabase Edge Function and Resend. It is off until deployed, all server secrets are present, and `notifications.ownerEmailEnabled` is explicitly switched to `true`.

1. In Resend, create an account, add a sending domain/address, and complete the DNS verification Resend requires (including SPF/DKIM). Generate a new API key with email-sending permission. The `from` address must belong to a verified sender/domain; a random Gmail address generally cannot be used as the sender.
2. If an API key was exposed in a chat, shell history, or repository, revoke it in Resend and generate a replacement. Do not paste API keys into this project or share them in chat.
3. Add these values in the Supabase Dashboard's **Edge Functions → Secrets** (or **Project Settings → Edge Functions → Secrets**):

   | Secret name | Value |
   |---|---|
   | `RESEND_API_KEY` | The newly generated Resend key; keep it only in Supabase secrets |
   | `CINEJOY_NOTIFY_EMAIL` | `you@your-domain.example` |
   | `CINEJOY_FROM_EMAIL` | A sender on your verified domain, e.g. `Cywrld <notices@your-verified-domain.example>` |
   | `CINEJOY_SITE_URL` | Your deployed HTTPS site origin, e.g. `https://your-site.example` |

   Supabase provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` inside Edge Functions. The function reads the service-role key only from the server environment; never add it to the browser.
4. Deploy `supabase/functions/notify-contact/index.ts`. With the Supabase CLI installed and this project linked, run `supabase functions deploy notify-contact`; `supabase/config.toml` requires a verified JWT.
5. In `supabase-config.js`, set `notifications.ownerEmailEnabled: true`. Submit one test thread from a client account. Confirm (a) the thread and message appear in Supabase and both inboxes, (b) the owner receives a notification email, and (c) notification status is recorded. If secrets or deployment are incomplete, the thread can still be saved but the UI reports that no email notification was sent.

The function validates the caller's Supabase session and thread ownership, only notifies for the caller's latest client-authored message, rate-limits notifications to five per account per hour, and sends to the configured owner address. It does not email clients or send admin replies. Owner email alerts contain the client's account email and message body; treat the inbox and mailbox accordingly.

## 7. Data, uploads, and privacy boundaries

- Public catalog reads use only the public anon/publishable key and public `SELECT` policy; network/configuration failures fall back to `movies.json`.
- Authenticated Supabase sessions use the Supabase browser client's local session storage. Authorization is independently enforced by RLS.
- Ratings and display names are public. No emails/profile IDs are exposed by the rating display query. Posting requires sign-in, has a unique per-film/account constraint, and is limited to five reviews per account per hour.
- Admin poster uploads accept PNG/JPEG/WebP up to 250 KB. The bucket is public for display; do not put private assets there.
- Digital product files use a private bucket. The purchase UI has no direct Storage read access; a server function checks the authenticated user's webhook-created entitlement and returns a 60-second signed URL. Only upload original/licensed, malware-scanned content. The site does not perform virus scanning or decide copyright status.
- Release calendar entries are metadata, not film uploads. `video_file` is only a relative path such as `videos/metropolis.mp4`; no video is included or uploaded.
- Cookie preference, theme, and watchlist choices remain local to the browser. This site adds no analytics/marketing trackers or optional cookies.

## 8. Enable Stripe-hosted checkout and private downloads

Checkout is disabled by default in the browser and independently off in the Edge Function environment. A browser success URL never grants access. Only `stripe-webhook` can write a paid order and entitlement after Stripe's signed event has been verified.

1. Create a Stripe account and use **test mode** first. In the Stripe Dashboard, create a one-time product and a USD price. Do not sell copyrighted or unlicensed downloads.
2. In the Supabase Dashboard, add these Edge Function Secrets. Never put them in `supabase-config.js`, HTML, JavaScript, a public repository, or a browser request:

   | Secret name | Value |
   |---|---|
   | `STRIPE_SECRET_KEY` | Stripe test secret key (replace with a production key only after testing) |
   | `STRIPE_WEBHOOK_SECRET` | Signing secret for the deployed webhook endpoint |
   | `STRIPE_CHECKOUT_ENABLED` | `true` only after the webhook and purchase flow are tested |
   | `CINEJOY_SITE_URL` | Exact deployed HTTPS origin, with no page path or trailing route; also used for CORS allow-listing |

   Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. The service-role key remains server-side.
3. Deploy `create-checkout`, `get-product-download`, and `stripe-webhook` using the Supabase CLI. `supabase/config.toml` requires JWT verification for checkout and download functions; the webhook disables Supabase JWT verification because it verifies Stripe's own HMAC signature and timestamp.
4. In the Stripe Dashboard, add a webhook endpoint at `https://YOUR_PROJECT_REF.supabase.co/functions/v1/stripe-webhook`. Subscribe only to `checkout.session.completed` and `checkout.session.async_payment_succeeded` for this flow. Copy its `whsec_...` signing secret directly into Supabase Edge Function Secrets as `STRIPE_WEBHOOK_SECRET`.
5. Sign in to the separate `admin.html` route as an authorized administrator. Create a digital product with the matching Stripe **Price ID**, amount in USD, category, description, and an original/licensed ZIP, PDF, or EPUB file. The server checks that the Stripe price is active, one-time, and matches the database amount/currency before creating hosted Checkout. Product files are uploaded to a private bucket; scan file contents for malware before upload.
6. In `supabase-config.js`, set `payments.checkoutEnabled: true` only after test mode is working. Checkout still fails closed unless `STRIPE_CHECKOUT_ENABLED` and all required secrets are present server-side.
7. Test successful, cancelled, failed, delayed, and duplicate webhook events. Confirm no download appears at the success redirect before webhook processing; only after the signature, session ID, user/product metadata, paid status, amount, and currency match does an entitlement appear. Confirm download links expire after one minute. Switch to production credentials only after these checks.

The endpoint accepts a product ID, never a browser price. Stripe Checkout is hosted by Stripe; card details are not collected by this site. The webhook is idempotent for repeated events. If Stripe, Supabase, webhook configuration, or storage is unavailable, purchases remain unavailable and no browser-side fallback grants access.
