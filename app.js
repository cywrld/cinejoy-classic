(() => {
  "use strict";

  const FAVORITES_KEY = "cinejoy-classic-watchlist";
  let catalogNotice = "";
  const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);

  let films = [];
  let favoriteIds = [];
  let storageProblem = "";

  function readFavorites() {
    try {
      const saved = window.localStorage.getItem(FAVORITES_KEY);
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== "string")) {
        throw new Error("The saved watchlist has an unexpected format.");
      }
      return parsed;
    } catch (error) {
      storageProblem = "Your browser could not read the saved watchlist. You can still use it until this page is closed.";
      return [];
    }
  }

  function persistFavorites() {
    try {
      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(favoriteIds));
      storageProblem = "";
      return true;
    } catch (error) {
      storageProblem = "Your browser could not save this change. The watchlist will remain available only until this page is closed.";
      return false;
    }
  }

  function favoriteMessage() {
    return storageProblem ? `<p class="storage-warning">${escapeHTML(storageProblem)}</p>` : "";
  }

  function updateFavoriteCounts() {
    document.querySelectorAll("[data-watchlist-count]").forEach((count) => {
      count.textContent = String(favoriteIds.length);
      count.hidden = favoriteIds.length === 0;
    });
  }

  function movieHref(film) {
    return `movie.html?id=${encodeURIComponent(film.id)}`;
  }

  function movieCard(film) {
    const saved = favoriteIds.includes(film.id);
    const genres = film.genres.map((genre) => `<span>${escapeHTML(genre)}</span>`).join("");
    return `<article class="movie-card">
      <div class="card-poster-wrap">
        <a class="card-poster" href="${movieHref(film)}" aria-label="View ${escapeHTML(film.title)} details">
          <img src="${escapeHTML(film.poster)}" alt="Original illustrated poster for ${escapeHTML(film.title)}" loading="lazy">
        </a>
        <button class="favorite-button${saved ? " is-saved" : ""}" type="button" data-favorite="${escapeHTML(film.id)}" aria-pressed="${saved}" aria-label="${saved ? "Remove" : "Add"} ${escapeHTML(film.title)} ${saved ? "from" : "to"} your watchlist">
          <span aria-hidden="true">${saved ? "♥" : "＋"}</span><span class="visually-hidden">${saved ? "Remove from" : "Add to"} watchlist</span>
        </button>
        <span class="poster-year">${escapeHTML(film.year)}</span>
      </div>
      <div class="card-copy">
        <div class="card-genres">${genres}</div>
        <h3><a href="${movieHref(film)}">${escapeHTML(film.title)}</a></h3>
        <p class="card-director">${escapeHTML(film.director)}</p>
        <a class="card-more" href="${movieHref(film)}">Discover the film <span aria-hidden="true">↗</span></a>
      </div>
    </article>`;
  }

  function displayEmpty(grid, title, message, linkText, linkHref) {
    grid.innerHTML = `<div class="empty-state"><span aria-hidden="true">✳</span><h3>${escapeHTML(title)}</h3><p>${escapeHTML(message)}</p><a class="text-link" href="${escapeHTML(linkHref)}">${escapeHTML(linkText)} <span aria-hidden="true">→</span></a></div>`;
  }

  function initializeCatalog() {
    const grid = document.querySelector("[data-catalog-grid]");
    if (!grid) return;
    const form = document.querySelector("[data-catalog-filters]");
    const search = document.querySelector("[data-search-input]");
    const genreSelect = document.querySelector("[data-genre-filter]");
    const yearSelect = document.querySelector("[data-year-filter]");
    const sortSelect = document.querySelector("[data-sort-filter]");
    const status = document.querySelector("[data-catalog-status]");
    const count = document.querySelector("[data-result-count]");
    const params = new URLSearchParams(window.location.search);

    [...new Set(films.flatMap((film) => film.genres))].sort((a, b) => a.localeCompare(b)).forEach((genre) => {
      genreSelect.insertAdjacentHTML("beforeend", `<option value="${escapeHTML(genre)}">${escapeHTML(genre)}</option>`);
    });
    [...new Set(films.map((film) => film.year))].sort((a, b) => b - a).forEach((year) => {
      yearSelect.insertAdjacentHTML("beforeend", `<option value="${year}">${year}</option>`);
    });
    search.value = params.get("q") || "";
    if (window.location.hash === "#catalog-search") search.focus({ preventScroll: true });
    genreSelect.value = params.get("genre") || "";
    yearSelect.value = params.get("year") || "";
    if (["newest", "oldest", "title"].includes(params.get("sort"))) sortSelect.value = params.get("sort");

    function render() {
      const query = search.value.trim().toLocaleLowerCase();
      const genre = genreSelect.value;
      const year = yearSelect.value;
      const sort = sortSelect.value;
      const filtered = films.filter((film) => {
        const searchable = [film.title, film.director, film.country, film.synopsis, ...film.genres].join(" ").toLocaleLowerCase();
        return (!query || searchable.includes(query)) &&
          (!genre || film.genres.includes(genre)) &&
          (!year || String(film.year) === year);
      });
      filtered.sort((a, b) => {
        if (sort === "oldest") return a.year - b.year || a.title.localeCompare(b.title);
        if (sort === "title") return a.title.localeCompare(b.title);
        return b.year - a.year || a.title.localeCompare(b.title);
      });
      count.textContent = `(${filtered.length})`;
      const nextParams = new URLSearchParams();
      if (search.value.trim()) nextParams.set("q", search.value.trim());
      if (genre) nextParams.set("genre", genre);
      if (year) nextParams.set("year", year);
      if (sort !== "newest") nextParams.set("sort", sort);
      const queryString = nextParams.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${queryString ? `?${queryString}` : ""}`);
      if (filtered.length) {
        grid.innerHTML = filtered.map(movieCard).join("");
        status.textContent = storageProblem || catalogNotice;
      } else {
        displayEmpty(grid, "No films found", "Try another title, genre, or year to find your next favorite.", "Clear your filters", "movies.html");
        status.textContent = storageProblem || catalogNotice;
      }
    }

    form.addEventListener("input", render);
    form.addEventListener("change", render);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      render();
    });
    form.addEventListener("reset", () => window.setTimeout(() => {
      search.value = "";
      genreSelect.value = "";
      yearSelect.value = "";
      sortSelect.value = "newest";
      render();
    }, 0));
    render();
  }

  function initializeHome() {
    const grid = document.querySelector("[data-featured-grid]");
    if (!grid) return;
    const featured = films.filter((film) => film.featured).sort((a, b) => b.year - a.year);
    grid.innerHTML = featured.map(movieCard).join("");
  }

  function initializeWatchlist() {
    const grid = document.querySelector("[data-watchlist-grid]");
    if (!grid) return;
    const count = document.querySelector("[data-watchlist-result-count]");
    const status = document.querySelector("[data-watchlist-status]");
    function render() {
      const saved = films.filter((film) => favoriteIds.includes(film.id));
      count.textContent = `(${saved.length})`;
      status.innerHTML = favoriteMessage();
      if (!saved.length) {
        displayEmpty(grid, "Your watchlist is waiting", "Tap the heart on any film card to keep it here for later.", "Browse all films", "movies.html");
        return;
      }
      grid.innerHTML = saved.map(movieCard).join("");
    }
    document.addEventListener("cinejoy:favorites-changed", render);
    render();
  }

  function initializeMoviePage() {
    const container = document.querySelector("[data-movie-detail]");
    if (!container) return;
    const id = new URLSearchParams(window.location.search).get("id");
    const film = films.find((item) => item.id === id);
    if (!film) {
      document.title = "Film not found — Cywrld";
      displayEmpty(container, "This film is off the program", "We couldn't find that title in this collection.", "Return to the collection", "movies.html");
      return;
    }

    document.title = `${film.title} (${film.year}) — Cywrld`;
    const genres = film.genres.map((genre) => `<span>${escapeHTML(genre)}</span>`).join("");
    const watchPanel = film.videoFile
      ? `<section class="watch-panel" id="watch" aria-labelledby="watch-heading">
          <div class="watch-panel-heading"><div><p class="eyebrow">The local screening room</p><h2 id="watch-heading">Ready when you are.</h2></div><span class="screening-tag">LOCAL FILE</span></div>
          <video class="film-player" controls preload="metadata" playsinline poster="${escapeHTML(film.poster)}" aria-label="Local video player for ${escapeHTML(film.title)}"><source src="${escapeHTML(film.videoFile)}" type="video/mp4">Your browser does not support HTML video.</video>
          <p class="video-notice" data-video-notice>This page does not include or download the film. Playback requires a video file you provide at <code>${escapeHTML(film.videoFile)}</code>. Use only a copy you are authorized to view in your location.</p>
        </section>`
      : `<section class="watch-panel unavailable-panel" id="watch"><p class="eyebrow">The local screening room</p><h2>We don't host this film.</h2><p>This guide has no video file for ${escapeHTML(film.title)}. Check a trusted source for an edition you are authorized to view in your location.</p></section>`;

    container.innerHTML = `<section class="detail-hero">
      <div class="detail-backdrop" aria-hidden="true"></div>
      <div class="detail-hero-inner">
        <a class="back-link" href="movies.html">← Back to the collection</a>
        <div class="detail-poster"><img src="${escapeHTML(film.poster)}" alt="Original illustrated poster for ${escapeHTML(film.title)}"></div>
        <div class="detail-intro"><p class="eyebrow">${escapeHTML(film.country)} <span>·</span> ${escapeHTML(film.year)}</p>
          <h1>${escapeHTML(film.title)}</h1><p class="detail-tagline">${escapeHTML(film.tagline)}</p>
          <div class="detail-genres">${genres}</div>
          <div class="detail-actions"><a class="button button-gold" href="#watch">${film.videoFile ? "Go to local player" : "Viewing information"} <span aria-hidden="true">↓</span></a>
            <button class="button button-outline favorite-button detail-favorite${favoriteIds.includes(film.id) ? " is-saved" : ""}" type="button" data-favorite="${escapeHTML(film.id)}" aria-pressed="${favoriteIds.includes(film.id)}" aria-label="${favoriteIds.includes(film.id) ? "Remove" : "Add"} ${escapeHTML(film.title)} ${favoriteIds.includes(film.id) ? "from" : "to"} your watchlist"><span aria-hidden="true">${favoriteIds.includes(film.id) ? "♥" : "＋"}</span> ${favoriteIds.includes(film.id) ? "Saved to watchlist" : "Add to watchlist"}</button>
          </div>
        </div>
      </div>
    </section>
    <section class="detail-body section-pad"><article class="film-notes"><p class="eyebrow">The story</p><h2>A little context<br>for the <em>curious.</em></h2><p class="film-synopsis">${escapeHTML(film.synopsis)}</p><p class="film-credit"><span>DIRECTOR</span>${escapeHTML(film.director)}</p><p class="film-credit"><span>RUNNING TIME</span>${escapeHTML(film.runtime)}</p><p class="film-credit"><span>GENRE</span>${escapeHTML(film.genres.join(" · "))}</p></article><aside class="detail-side-note"><span aria-hidden="true">✦</span><p>Film versions, availability, and rights can vary by region and edition. Please verify the specific source before viewing.</p></aside></section>
    ${watchPanel}
    <section class="review-panel section-pad" data-review-panel aria-labelledby="reviews-heading">
      <div class="section-heading"><div><p class="eyebrow">Audience notes</p><h2 id="reviews-heading">Ratings &amp; reviews</h2></div><span class="review-average" data-review-average>—</span></div>
      <p class="review-status" data-review-status role="status" aria-live="polite"></p>
      <div class="review-list" data-review-list><p class="loading-note">Loading audience notes…</p></div>
      <form class="review-form" data-review-form>
        <fieldset data-review-fields disabled><legend>Leave a rating</legend>
          <div class="rating-options" role="radiogroup" aria-label="Rate this film">
            <label><input type="radio" name="rating" value="5" required><span aria-hidden="true">★★★★★</span><span class="visually-hidden">5 stars</span></label>
            <label><input type="radio" name="rating" value="4"><span aria-hidden="true">★★★★</span><span class="visually-hidden">4 stars</span></label>
            <label><input type="radio" name="rating" value="3"><span aria-hidden="true">★★★</span><span class="visually-hidden">3 stars</span></label>
            <label><input type="radio" name="rating" value="2"><span aria-hidden="true">★★</span><span class="visually-hidden">2 stars</span></label>
            <label><input type="radio" name="rating" value="1"><span aria-hidden="true">★</span><span class="visually-hidden">1 star</span></label>
          </div>
          <label for="review-name">Display name (optional)</label><input id="review-name" name="display_name" type="text" maxlength="60" autocomplete="nickname" placeholder="Guest">
          <label for="review-text">A short review (optional)</label><textarea id="review-text" name="review" rows="3" maxlength="800" placeholder="What stayed with you?"></textarea>
          <button class="button button-gold" type="submit">Share rating</button>
        </fieldset>
      </form>
    </section>
    <section class="detail-next"><p class="eyebrow">Keep exploring</p><h2>There's always<br><em>another story.</em></h2><a class="text-link" href="movies.html">Back to all films <span aria-hidden="true">→</span></a></section>`;

    const player = container.querySelector(".film-player");
    const notice = container.querySelector("[data-video-notice]");
    if (player && notice) {
      player.addEventListener("error", () => {
        notice.classList.add("is-error");
        notice.textContent = `The local video could not be loaded. Add a video file you are authorized to view at ${film.videoFile}. No film is included or downloaded with this site.`;
      });
      player.addEventListener("loadedmetadata", () => {
        notice.classList.remove("is-error");
        notice.textContent = `Local video loaded. This site does not supply the film; verify your copy's viewing rights for your location.`;
      });
    }
    initializeReviews(container, film);
  }

  function initializeReviews(container, film) {
    const form = container.querySelector("[data-review-form]");
    const status = container.querySelector("[data-review-status]");
    const list = container.querySelector("[data-review-list]");
    const average = container.querySelector("[data-review-average]");
    const fields = container.querySelector("[data-review-fields]");
    const config = window.CINEJOY_SUPABASE;
    fields.disabled = true;
    if (!config || !config.url || !config.anonKey) {
      status.textContent = "Ratings are unavailable until Supabase is configured. Nothing is saved on this device.";
      list.innerHTML = `<p class="review-empty">No online ratings are configured.</p>`;
      form.addEventListener("submit", (event) => event.preventDefault());
      return;
    }

    let sdkPromise;
    async function getClient() {
      let projectUrl;
      try {
        projectUrl = new URL(config.url);
      } catch (error) {
        throw new Error("The Supabase project URL is invalid.");
      }
      const localHost = ["localhost", "127.0.0.1"].includes(projectUrl.hostname);
      if (projectUrl.username || projectUrl.password ||
          (projectUrl.protocol !== "https:" && !(localHost && projectUrl.protocol === "http:"))) {
        throw new Error("Supabase must use HTTPS (HTTP is allowed only for localhost development).");
      }
      if (!window.supabase || typeof window.supabase.createClient !== "function") {
        if (!sdkPromise) {
          sdkPromise = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";
            script.async = true;
            script.onload = resolve;
            script.onerror = () => reject(new Error("The Supabase browser client could not be loaded."));
            document.head.append(script);
          });
        }
        await sdkPromise;
      }
      if (!window.supabase || typeof window.supabase.createClient !== "function") {
        throw new Error("The Supabase browser client is unavailable.");
      }
      return window.supabase.createClient(projectUrl.origin, config.anonKey.trim());
    }

    (async () => {
      const client = await getClient();
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      fields.disabled = !sessionData.session;
      if (sessionData.session) {
        status.textContent = "Signed-in members may submit one public rating per film. Reviews are public and may be moderated.";
      } else {
        const accountLink = document.createElement("a");
        accountLink.href = "account.html";
        accountLink.textContent = "Sign in to leave a rating.";
        status.replaceChildren(accountLink);
      }

      async function loadReviews() {
        const { data: reviews, error } = await client.from("rating_reviews")
          .select("rating,review,display_name,created_at")
          .eq("film_id", film.id).order("created_at", { ascending: false }).limit(30);
        if (error) throw error;
        if (!reviews.length) {
          average.textContent = "No ratings yet";
          list.innerHTML = `<p class="review-empty">Be the first to leave a rating.</p>`;
          return;
        }
        const mean = reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length;
        average.textContent = `${mean.toFixed(1)} ★ · ${reviews.length} ${reviews.length === 1 ? "rating" : "ratings"}`;
        list.innerHTML = reviews.map((review) => {
          const date = new Date(review.created_at);
          const readableDate = Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
          return `<article class="review-entry"><div class="review-entry-meta"><strong>${escapeHTML(review.display_name || "Guest")}</strong><time datetime="${escapeHTML(review.created_at)}">${escapeHTML(readableDate)}</time></div><p class="review-stars" aria-label="${review.rating} out of 5 stars">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</p>${review.review ? `<p class="review-entry-copy">${escapeHTML(review.review)}</p>` : ""}</article>`;
        }).join("");
      }

      await loadReviews();
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!form.reportValidity() || fields.disabled) return;
        const submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        status.textContent = "Saving your rating…";
        const payload = {
          film_id: film.id,
          rating: Number(new FormData(form).get("rating")),
          display_name: form.elements.display_name.value.trim() || "Guest",
          review: form.elements.review.value.trim() || ""
        };
        try {
          const { error } = await client.from("rating_reviews").insert(payload);
          if (error && error.code === "23505") throw new Error("You have already rated this film from this account.");
          if (error) throw error;
          status.textContent = "Your rating is saved in the shared Supabase catalog.";
          form.reset();
          await loadReviews();
        } catch (error) {
          console.error("Cywrld could not save the review:", error);
          status.textContent = `${error.message} No local review was saved.`;
        } finally {
          submit.disabled = false;
        }
      });
    })().catch((error) => {
      console.error("Cywrld could not initialize online reviews:", error);
      fields.disabled = true;
      average.textContent = "Unavailable";
      status.textContent = "Online ratings are unavailable. Sign-in and Supabase must be configured to submit a rating.";
      list.innerHTML = `<p class="review-empty">Online ratings are unavailable. Please try again later.</p>`;
    });
  }

  function isValidFilmCollection(data) {
    if (!Array.isArray(data)) return false;
    const ids = new Set();
    return data.every((film) => {
      if (!film || typeof film.id !== "string" || !/^[a-z0-9-]+$/.test(film.id) ||
          ids.has(film.id) || typeof film.title !== "string" || !film.title.trim() ||
          !Number.isInteger(film.year) || typeof film.director !== "string" ||
          typeof film.country !== "string" || typeof film.runtime !== "string" ||
          typeof film.tagline !== "string" || typeof film.synopsis !== "string" ||
          !Array.isArray(film.genres) || film.genres.length === 0 ||
          film.genres.some((genre) => typeof genre !== "string" || !genre.trim()) ||
          typeof film.poster !== "string" ||
          !(film.poster.startsWith("assets/") || isSupabasePoster(film.poster)) ||
          (film.videoFile !== undefined && (typeof film.videoFile !== "string" || !/^videos\/[a-zA-Z0-9._-]+$/.test(film.videoFile))) ||
          (film.featured !== undefined && typeof film.featured !== "boolean") ||
          (film.publicDomain !== undefined && typeof film.publicDomain !== "boolean")) return false;
      ids.add(film.id);
      return true;
    });
  }

  function isSupabasePoster(poster) {
    const config = window.CINEJOY_SUPABASE;
    if (!config || !config.url) return false;
    try {
      const configured = new URL(config.url);
      const image = new URL(poster);
      return image.origin === configured.origin &&
        image.pathname.startsWith("/storage/v1/object/public/movie-posters/");
    } catch (error) {
      return false;
    }
  }

  function mapDatabaseFilm(row) {
    return {
      id: row.id,
      title: row.title,
      year: row.year,
      director: row.director,
      country: row.country,
      runtime: row.runtime,
      tagline: row.tagline,
      synopsis: row.synopsis,
      genres: row.genres,
      poster: row.poster,
      videoFile: row.video_file || undefined,
      featured: row.featured,
      publicDomain: row.public_domain
    };
  }

  async function fetchOnlineCatalog() {
    const config = window.CINEJOY_SUPABASE;
    if (!config || !config.url || !config.anonKey) return null;
    const baseUrl = config.url.replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}/rest/v1/movies?select=*&order=year.desc,title.asc`, {
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`
      }
    });
    if (!response.ok) throw new Error(`Shared catalog request failed (${response.status}).`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error("The shared catalog returned an invalid response.");
    const data = rows.map(mapDatabaseFilm);
    if (!isValidFilmCollection(data)) throw new Error("The shared catalog contains invalid film data.");
    return data;
  }

  function initializeFavorites() {
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-favorite]");
      if (!button) return;
      const id = button.getAttribute("data-favorite");
      if (!films.some((film) => film.id === id)) return;
      favoriteIds = favoriteIds.includes(id)
        ? favoriteIds.filter((savedId) => savedId !== id)
        : [...favoriteIds, id];
      persistFavorites();
      updateFavoriteCounts();
      document.dispatchEvent(new Event("cinejoy:favorites-changed"));
      document.querySelectorAll(`[data-favorite="${CSS.escape(id)}"]`).forEach((favoriteButton) => {
        const saved = favoriteIds.includes(id);
        favoriteButton.classList.toggle("is-saved", saved);
        favoriteButton.setAttribute("aria-pressed", String(saved));
        favoriteButton.setAttribute("aria-label", `${saved ? "Remove" : "Add"} ${films.find((film) => film.id === id).title} ${saved ? "from" : "to"} your watchlist`);
        if (favoriteButton.classList.contains("detail-favorite")) {
          favoriteButton.innerHTML = `<span aria-hidden="true">${saved ? "♥" : "＋"}</span> ${saved ? "Saved to watchlist" : "Add to watchlist"}`;
        } else {
          favoriteButton.querySelector("[aria-hidden=true]").textContent = saved ? "♥" : "＋";
          favoriteButton.querySelector(".visually-hidden").textContent = `${saved ? "Remove from" : "Add to"} watchlist`;
        }
      });
      const watchlistStatus = document.querySelector("[data-watchlist-status]");
      if (watchlistStatus) watchlistStatus.innerHTML = favoriteMessage();
      const catalogStatus = document.querySelector("[data-catalog-status]");
      if (catalogStatus && storageProblem) catalogStatus.textContent = storageProblem;
    });
  }

  async function initialize() {
    document.querySelectorAll("[data-current-year]").forEach((node) => { node.textContent = String(new Date().getFullYear()); });
    favoriteIds = readFavorites();
    updateFavoriteCounts();
    initializeFavorites();
    try {
      const response = await fetch(new URL("movies.json", document.baseURI));
      if (!response.ok) throw new Error(`Catalog request failed with status ${response.status}.`);
      const data = await response.json();
      if (!isValidFilmCollection(data)) throw new Error("The film catalog has an invalid format.");
      films = data;
      try {
        const sharedCatalog = await fetchOnlineCatalog();
        if (sharedCatalog) films = sharedCatalog;
      } catch (error) {
        catalogNotice = "Showing bundled sample films because the shared catalog is unavailable.";
        console.warn("Cywrld is using the bundled catalog fallback:", error);
      }
      initializeHome();
      initializeCatalog();
      initializeWatchlist();
      initializeMoviePage();
    } catch (error) {
      console.error("Cywrld could not load movies.json:", error);
      document.querySelectorAll("[data-featured-grid], [data-catalog-grid], [data-watchlist-grid], [data-movie-detail]").forEach((grid) => {
        grid.innerHTML = `<div class="empty-state"><span aria-hidden="true">!</span><h3>The collection couldn't load</h3><p>Serve this folder through a local static HTTP server so the browser can read movies.json. No build tools or internet connection are needed.</p></div>`;
      });
    }
  }

  document.addEventListener("DOMContentLoaded", initialize);
})();
