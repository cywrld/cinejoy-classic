# Cywrld

A responsive, static-first guide to movies and a digital store, with no frontend build step. The site uses a restrained AMOLED-black palette, responsive navigation, accessible search and theme controls, and original local SVG artwork.

## Run locally

Serve this folder through a static HTTP server, then open `index.html`. For example:

```sh
python -m http.server 8000
```

Opening HTML through `file://` may prevent the browser from loading local JSON files.

## Public pages

- `index.html` — home and featured movies
- `movies.html` — searchable, filterable, sortable movie catalog
- `shows.html` — series-guide landing page; no episodes are hosted
- `store.html` — software, apps, games, and ebooks
- `purchases.html` — private downloads after verified payment
- `movie.html?id=metropolis` — film details, rights note, optional local video player, and ratings
- `watchlist.html`, `about.html`, `contact.html`, `account.html`, `messages.html`, and `faq.html`

`admin.html` is a separate, directly accessible admin route. It is not linked from public navigation; hiding its URL is not a security control. Supabase Auth and database RLS must be configured before any admin data or mutation is available.

The store contains clearly marked local preview listings when no shared product catalog is configured. Checkout is disabled by default and cannot grant downloads. Live products require Supabase setup, private file storage, Stripe-hosted checkout, server-side Stripe price validation, and a signed webhook before an entitlement is recorded. See [SUPABASE_SETUP.md](SUPABASE_SETUP.md) and [SECURITY.md](SECURITY.md).

The site assistant is a deterministic local FAQ and movie-catalog helper, not a generative AI service. It sends no questions to an external model. Movie data falls back to `movies.json` when Supabase is not configured or offline.

No film files or digital-product files are included. The Metropolis player looks for a user-provided `videos/metropolis.mp4`; verify the source's rights for your location. Product administrators must upload only work they own or are explicitly licensed to distribute.

The site adds no analytics or advertising trackers. Watchlist, theme, account-session, and cookie-preference data use browser storage as described in the privacy copy.
