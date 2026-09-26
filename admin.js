(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
  const MOVIE_COLUMNS = "id,title,year,director,country,runtime,tagline,synopsis,genres,poster,video_file,featured,public_domain";
  let supabaseClient = null;
  let catalog = [];
  let threads = [];
  let threadMessages = [];
  let releases = [];
  let reviews = [];
  let auditRows = [];
  let selectedThreadId = "";
  let editingId = null;
  let previewUrl = "";
  let authMode = "signin";
  let calendarDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  function show(selector, visible) {
    const node = $(selector);
    if (node) node.hidden = !visible;
  }

  function validSupabaseConfig(config) {
    if (!config || typeof config.url !== "string" || typeof config.anonKey !== "string" || !config.url.trim() || !config.anonKey.trim()) {
      return { valid: false, reason: "Add your Supabase project URL and public anon/publishable key to supabase-config.js." };
    }
    try {
      const url = new URL(config.url);
      const localHost = ["localhost", "127.0.0.1"].includes(url.hostname);
      if (url.username || url.password || (url.protocol !== "https:" && !(localHost && url.protocol === "http:"))) {
        return { valid: false, reason: "Use a valid HTTPS Supabase project URL (HTTP is allowed only for localhost development)." };
      }
      const token = config.anonKey.trim();
      if (token.split(".").length === 3) {
        try {
          const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
          if (payload.role === "service_role") {
            return { valid: false, reason: "The configured key is a service-role secret. Remove it and use the public anon/publishable key instead." };
          }
        } catch (error) {
          // New publishable keys do not have to be JWTs.
        }
      }
      return { valid: true, reason: "" };
    } catch (error) {
      return { valid: false, reason: "The Supabase project URL is not a valid URL." };
    }
  }

  function isStoragePoster(poster) {
    try {
      const base = new URL(window.CINEJOY_SUPABASE.url);
      const image = new URL(poster);
      return image.origin === base.origin && image.pathname.startsWith("/storage/v1/object/public/movie-posters/");
    } catch (error) {
      return false;
    }
  }

  function mapFilm(row) {
    return {
      id: row.id, title: row.title, year: row.year, director: row.director,
      country: row.country, runtime: row.runtime, tagline: row.tagline,
      synopsis: row.synopsis, genres: row.genres, poster: row.poster,
      videoFile: row.video_file || "", featured: Boolean(row.featured),
      publicDomain: Boolean(row.public_domain)
    };
  }

  function toDatabaseFilm(film) {
    return {
      id: film.id, title: film.title, year: film.year, director: film.director,
      country: film.country, runtime: film.runtime, tagline: film.tagline,
      synopsis: film.synopsis, genres: film.genres, poster: film.poster,
      video_file: film.videoFile || null, featured: film.featured,
      public_domain: film.publicDomain
    };
  }

  function validCatalog(data) {
    if (!Array.isArray(data)) return false;
    const ids = new Set();
    return data.every((film) => {
      if (!film || typeof film.id !== "string" || !/^[a-z0-9-]+$/.test(film.id) ||
          ids.has(film.id) || typeof film.title !== "string" || !film.title.trim() ||
          !Number.isInteger(film.year) || typeof film.director !== "string" ||
          typeof film.country !== "string" || typeof film.runtime !== "string" ||
          typeof film.tagline !== "string" || typeof film.synopsis !== "string" ||
          !Array.isArray(film.genres) || !film.genres.length ||
          film.genres.some((genre) => typeof genre !== "string" || !genre.trim()) ||
          typeof film.poster !== "string" ||
          !(film.poster.startsWith("assets/") || isStoragePoster(film.poster)) ||
          (film.videoFile && !/^videos\/[a-zA-Z0-9._-]+$/.test(film.videoFile))) return false;
      ids.add(film.id);
      return true;
    });
  }

  function setAuthMode(mode) {
    authMode = mode;
    const button = $("[data-email-submit]");
    const toggle = $("[data-auth-mode-toggle]");
    const password = $("#admin-password");
    const help = $("[data-auth-provider-note]");
    if (button) button.innerHTML = mode === "signup" ? "Create account <span aria-hidden=\"true\">→</span>" : "Sign in <span aria-hidden=\"true\">→</span>";
    if (toggle) toggle.textContent = mode === "signup" ? "Already have an account? Sign in" : "Create an account instead";
    if (password) password.autocomplete = mode === "signup" ? "new-password" : "current-password";
    if (help) help.textContent = mode === "signup"
      ? "New accounts have no admin permissions. An authorized owner must grant the trusted app-metadata role."
      : "Sign-in alone never grants admin access; Supabase RLS enforces it independently.";
    const form = $("[data-admin-login]");
    if (form) form.dataset.mode = mode;
  }

  function showConfiguration(message) {
    show("[data-admin-setup]", true);
    show("[data-admin-auth]", false);
    show("[data-admin-panel]", false);
    show("[data-admin-denied]", false);
    $("[data-admin-setup-status]").textContent = message;
  }

  function showSignIn() {
    show("[data-admin-auth]", true);
    show("[data-admin-panel]", false);
    show("[data-admin-denied]", false);
    show("[data-admin-setup]", false);
    setAuthMode("signin");
  }

  async function displaySession(session) {
    if (!session) {
      showSignIn();
      return;
    }
    const metadata = session.user.app_metadata || {};
    if (metadata.cinejoy_admin !== true && metadata.cinejoy_admin !== "true") {
      show("[data-admin-auth]", false);
      show("[data-admin-panel]", false);
      show("[data-admin-denied]", true);
      show("[data-admin-setup]", false);
      return;
    }
    show("[data-admin-auth]", false);
    show("[data-admin-panel]", true);
    show("[data-admin-denied]", false);
    show("[data-admin-setup]", false);
    $("[data-admin-email]").textContent = session.user.email || "Administrator";
    currentAdminId = session.user.id;
    await refreshAdminData();
  }

  function renderMetrics() {
    $("[data-metric-total]").textContent = String(catalog.length);
    $("[data-metric-featured]").textContent = String(catalog.filter((film) => film.featured).length);
    $("[data-metric-public-domain]").textContent = String(catalog.filter((film) => film.publicDomain).length);
    $("[data-metric-messages]").textContent = String(threads.filter((thread) => thread.status === "open").length);
  }

  function renderCatalog() {
    const query = $("[data-admin-search]").value.trim().toLocaleLowerCase();
    const filter = $("[data-admin-filter]").value;
    const filtered = catalog.filter((film) => {
      const searchable = [film.title, film.year, film.director, ...film.genres].join(" ").toLocaleLowerCase();
      return (!query || searchable.includes(query)) &&
        (filter === "all" || (filter === "featured" && film.featured) || (filter === "public-domain" && film.publicDomain));
    });
    const body = $("[data-admin-catalog]");
    body.innerHTML = filtered.length ? filtered.map((film) => `<tr>
      <td><div class="admin-film-cell"><img src="${escapeHTML(film.poster)}" alt="" loading="lazy"><div><strong>${escapeHTML(film.title)}</strong><small>${escapeHTML(film.director)}</small></div></div></td>
      <td>${escapeHTML(film.year)}</td><td>${escapeHTML(film.genres.join(", "))}</td>
      <td><span class="admin-flag${film.featured ? " active" : ""}">${film.featured ? "Featured" : "—"}</span><span class="admin-flag${film.publicDomain ? " active" : ""}">${film.publicDomain ? "PD flag" : "—"}</span></td>
      <td class="admin-row-actions"><button class="table-action" type="button" data-edit-film="${escapeHTML(film.id)}">Edit</button><button class="table-action delete-action" type="button" data-delete-film="${escapeHTML(film.id)}">Delete</button></td>
    </tr>`).join("") : `<tr><td colspan="5" class="admin-table-empty">No films match those filters.</td></tr>`;
    const select = $("[data-release-movie]");
    const selected = select.value;
    select.innerHTML = `<option value="">Choose a film</option>${catalog.map((film) => `<option value="${escapeHTML(film.id)}">${escapeHTML(film.title)} (${film.year})</option>`).join("")}`;
    if (catalog.some((film) => film.id === selected)) select.value = selected;
    renderMetrics();
  }

  function renderThreadList() {
    const list = $("[data-admin-inbox]");
    list.innerHTML = threads.length ? threads.map((thread) => {
      const date = new Date(thread.updated_at || thread.created_at);
      const when = Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
      return `<button class="admin-thread-item${thread.id === selectedThreadId ? " is-active" : ""}" type="button" data-admin-open-thread="${escapeHTML(thread.id)}" aria-current="${thread.id === selectedThreadId ? "true" : "false"}"><strong>${escapeHTML(thread.subject)}</strong><span>${escapeHTML(thread.owner_email)} · ${escapeHTML(thread.status)}</span><time datetime="${escapeHTML(thread.updated_at)}">${escapeHTML(when)}</time></button>`;
    }).join("") : `<p class="thread-list-empty">No message threads.</p>`;
    renderMetrics();
  }

  async function openAdminThread(id) {
    const thread = threads.find((item) => item.id === id);
    if (!thread) return;
    selectedThreadId = id;
    renderThreadList();
    show("[data-admin-thread-empty]", false);
    show("[data-admin-thread-view]", true);
    $("[data-admin-thread-email]").textContent = thread.owner_email;
    $("[data-admin-thread-user-id]").textContent = `Account ID: ${thread.user_id} · Subject: ${thread.subject}`;
    $("[data-admin-thread-status]").textContent = `Status: ${thread.status}`;
    $("[data-toggle-thread-status]").textContent = thread.status === "open" ? "Close thread" : "Reopen thread";
    const transcript = $("[data-admin-transcript]");
    transcript.innerHTML = `<p class="thread-list-empty">Loading conversation…</p>`;
    const { data, error } = await supabaseClient.from("thread_messages")
      .select("id,sender_id,sender_role,body,created_at")
      .eq("thread_id", id).order("created_at", { ascending: true });
    if (error) throw error;
    threadMessages = data;
    transcript.innerHTML = data.length ? data.map((message) => {
      const date = new Date(message.created_at);
      const when = Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
      return `<article class="thread-message${message.sender_role === "admin" ? " from-admin" : ""}"><div><strong>${message.sender_role === "admin" ? "Cywrld team" : escapeHTML(thread.owner_email)}</strong><time datetime="${escapeHTML(message.created_at)}">${escapeHTML(when)}</time></div><p>${escapeHTML(message.body)}</p></article>`;
    }).join("") : `<p class="thread-list-empty">No messages in this thread yet.</p>`;
    transcript.scrollTop = transcript.scrollHeight;
  }

  function renderAudit() {
    const body = $("[data-admin-audit]");
    body.innerHTML = auditRows.length ? auditRows.map((entry) => {
      const date = new Date(entry.created_at);
      const when = Number.isNaN(date.getTime()) ? escapeHTML(entry.created_at) : escapeHTML(date.toLocaleString());
      const details = entry.details && Object.keys(entry.details).length
        ? Object.entries(entry.details).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`).join(" · ")
        : "";
      return `<tr><td>${when}</td><td>${escapeHTML(entry.actor_email || entry.actor_id || "Unknown actor")}</td><td>${escapeHTML(entry.action)}</td><td>${escapeHTML(entry.entity_type)}<br><small>${escapeHTML(entry.entity_id || "")}</small></td><td>${escapeHTML(details)}</td></tr>`;
    }).join("") : `<tr><td colspan="5" class="admin-table-empty">No activity has been recorded.</td></tr>`;
  }

  function renderReviews() {
    const list = $("[data-admin-reviews]");
    list.innerHTML = reviews.length ? reviews.map((review) => {
      const film = catalog.find((item) => item.id === review.film_id);
      const date = new Date(review.created_at);
      const when = Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
      return `<article class="admin-review"><div><strong>${escapeHTML(film ? film.title : review.film_id)}</strong><span>${review.rating}/5 ★ · ${escapeHTML(review.display_name)} · ${escapeHTML(when)}</span></div><p>${escapeHTML(review.review || "Rating only.")}</p><button class="table-action delete-action" type="button" data-delete-review="${escapeHTML(review.id)}">Remove review</button></article>`;
    }).join("") : `<div class="admin-empty"><p>No audience ratings yet.</p></div>`;
  }

  function renderCalendar() {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    $("[data-calendar-month]").textContent = calendarDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const start = new Date(year, month, 1);
    const firstDay = start.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevious = new Date(year, month, 0).getDate();
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const labels = weekdays.map((day) => `<div class="calendar-weekday" role="columnheader">${day}</div>`).join("");
    const cells = [];
    for (let index = 0; index < 42; index += 1) {
      let day;
      let cellDate;
      let outside = false;
      if (index < firstDay) {
        day = daysInPrevious - firstDay + index + 1;
        cellDate = new Date(year, month - 1, day);
        outside = true;
      } else if (index >= firstDay + daysInMonth) {
        day = index - firstDay - daysInMonth + 1;
        cellDate = new Date(year, month + 1, day);
        outside = true;
      } else {
        day = index - firstDay + 1;
        cellDate = new Date(year, month, day);
      }
      const dateString = `${cellDate.getFullYear()}-${String(cellDate.getMonth() + 1).padStart(2, "0")}-${String(cellDate.getDate()).padStart(2, "0")}`;
      const dayReleases = releases.filter((release) => release.release_date === dateString);
      const events = dayReleases.map((release) => {
        const film = catalog.find((item) => item.id === release.movie_id);
        return `<div class="calendar-event ${escapeHTML(release.status)}"><span>${escapeHTML(film ? film.title : release.movie_id)}</span><select aria-label="Status for ${escapeHTML(film ? film.title : release.movie_id)}" data-release-status="${escapeHTML(release.id)}"><option value="scheduled"${release.status === "scheduled" ? " selected" : ""}>Scheduled</option><option value="published"${release.status === "published" ? " selected" : ""}>Published</option><option value="cancelled"${release.status === "cancelled" ? " selected" : ""}>Cancelled</option></select><button type="button" class="calendar-delete" data-delete-release="${escapeHTML(release.id)}" aria-label="Remove ${escapeHTML(film ? film.title : release.movie_id)} calendar date">×</button></div>`;
      }).join("");
      const today = new Date();
      const isToday = !outside && today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
      cells.push(`<div class="calendar-day${outside ? " outside-month" : ""}${isToday ? " today" : ""}" role="gridcell" aria-label="${escapeHTML(cellDate.toLocaleDateString())}"><span class="calendar-day-number">${day}</span>${events}</div>`);
    }
    $("[data-release-calendar]").innerHTML = labels + cells.join("");
  }

  async function loadCatalog() {
    $("[data-admin-catalog-status]").textContent = "Loading shared catalog…";
    const { data, error } = await supabaseClient.from("movies").select(MOVIE_COLUMNS)
      .order("year", { ascending: false }).order("title", { ascending: true });
    if (error) throw error;
    catalog = data.map(mapFilm);
    if (!validCatalog(catalog)) throw new Error("The database returned invalid movie data.");
    renderCatalog();
    $("[data-admin-catalog-status]").textContent = `Loaded ${catalog.length} shared films from Supabase.`;
  }

  async function loadInbox() {
    $("[data-admin-inbox-status]").textContent = "Loading private message threads…";
    const { data, error } = await supabaseClient.from("message_threads")
      .select("id,user_id,owner_email,subject,status,created_at,updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    threads = data;
    if (selectedThreadId && !threads.some((thread) => thread.id === selectedThreadId)) {
      selectedThreadId = "";
      show("[data-admin-thread-view]", false);
      show("[data-admin-thread-empty]", true);
    }
    renderThreadList();
    if (selectedThreadId) await openAdminThread(selectedThreadId);
    $("[data-admin-inbox-status]").textContent = `${threads.length} private threads. Replies are saved in the website; no email is sent by an admin reply.`;
  }

  async function loadReleases() {
    const { data, error } = await supabaseClient.from("movie_releases")
      .select("id,movie_id,release_date,note,status,created_at").order("release_date", { ascending: true });
    if (error) throw error;
    releases = data;
    renderCalendar();
  }

  async function loadReviews() {
    const { data, error } = await supabaseClient.from("rating_reviews")
      .select("id,film_id,display_name,rating,review,created_at")
      .order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    reviews = data;
    renderReviews();
  }

  async function loadAudit() {
    const { data, error } = await supabaseClient.from("admin_audit_log")
      .select("id,actor_id,actor_email,action,entity_type,entity_id,details,created_at")
      .order("created_at", { ascending: false }).limit(200);
    if (error) throw error;
    auditRows = data;
    renderAudit();
  }

  async function refreshAdminData() {
    try {
      await loadCatalog();
      const outcomes = await Promise.allSettled([loadInbox(), loadReleases(), loadReviews(), loadAudit()]);
      const failed = outcomes.filter((outcome) => outcome.status === "rejected");
      if (failed.length) {
        failed.forEach((outcome) => console.error("Cywrld admin data request failed:", outcome.reason));
        $("[data-admin-inbox-status]").textContent = "Some admin data could not load. Verify all tables and RLS policies in supabase-setup.sql.";
      }
    } catch (error) {
      console.error("Cywrld could not load the shared catalog:", error);
      $("[data-admin-catalog-status]").textContent = `Could not load shared data: ${error.message}`;
    }
  }

  function setPosterPreview(path) {
    const preview = $("[data-poster-preview]");
    if (path) {
      preview.src = path;
      preview.hidden = false;
      preview.onerror = () => { preview.hidden = true; };
    } else {
      preview.removeAttribute("src");
      preview.hidden = true;
    }
  }

  function resetEditor() {
    const form = $("[data-admin-film-form]");
    form.reset();
    form.elements.id.disabled = false;
    editingId = null;
    $("[data-editor-title]").textContent = "Add a film";
    $("[data-save-film]").textContent = "Save to shared catalog";
    $("[data-cancel-edit]").hidden = true;
    $("[data-admin-form-status]").textContent = "";
    setPosterPreview("");
  }

  function editFilm(id) {
    const film = catalog.find((item) => item.id === id);
    if (!film) return;
    const form = $("[data-admin-film-form]");
    editingId = id;
    form.elements.id.value = film.id;
    form.elements.id.disabled = true;
    form.elements.title.value = film.title;
    form.elements.year.value = film.year;
    form.elements.director.value = film.director;
    form.elements.country.value = film.country;
    form.elements.runtime.value = film.runtime;
    form.elements.genres.value = film.genres.join(", ");
    form.elements.tagline.value = film.tagline;
    form.elements.synopsis.value = film.synopsis;
    form.elements.poster.value = film.poster;
    form.elements.posterUpload.value = "";
    form.elements.videoFile.value = film.videoFile || "";
    form.elements.featured.checked = film.featured;
    form.elements.publicDomain.checked = film.publicDomain;
    setPosterPreview(film.poster);
    $("[data-editor-title]").textContent = `Edit ${film.title}`;
    $("[data-save-film]").textContent = "Save shared changes";
    $("[data-cancel-edit]").hidden = false;
    $("[data-admin-form-status]").textContent = "Editing a shared database row. The catalog ID stays fixed to preserve links.";
    $("#editor-heading").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function readUploadedPoster(file) {
    if (!file) return Promise.resolve(null);
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return Promise.reject(new Error("Choose a PNG, JPEG, or WebP poster image."));
    if (file.size > 250000) return Promise.reject(new Error("Poster images must be 250 KB or smaller."));
    return Promise.resolve(file);
  }

  async function uploadPoster(file, filmId) {
    if (!file) return "";
    const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[file.type];
    const path = `${filmId}/${Date.now()}.${extension}`;
    const { error } = await supabaseClient.storage.from("movie-posters").upload(path, file, {
      upsert: true, contentType: file.type, cacheControl: "3600"
    });
    if (error) throw error;
    return supabaseClient.storage.from("movie-posters").getPublicUrl(path).data.publicUrl;
  }

  async function saveFilm(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const button = $("[data-save-film]");
    const status = $("[data-admin-form-status]");
    button.disabled = true;
    status.textContent = "Saving changes to Supabase…";
    try {
      const filmId = editingId || form.elements.id.value.trim();
      if (!editingId && catalog.some((film) => film.id === filmId)) throw new Error("That catalog ID already exists.");
      const posterFile = await readUploadedPoster(form.elements.posterUpload.files[0]);
      const uploadedPoster = await uploadPoster(posterFile, filmId);
      const poster = uploadedPoster || form.elements.poster.value.trim() ||
        (editingId && catalog.find((film) => film.id === editingId).poster);
      if (!poster || !(poster.startsWith("assets/") || isStoragePoster(poster))) {
        throw new Error("Use an assets/ path or upload a poster to the configured Supabase Storage bucket.");
      }
      const videoFile = form.elements.videoFile.value.trim();
      if (videoFile && !/^videos\/[a-zA-Z0-9._-]+$/.test(videoFile)) throw new Error("Use a relative videos/filename path.");
      const film = {
        id: filmId, title: form.elements.title.value.trim(), year: Number(form.elements.year.value),
        director: form.elements.director.value.trim(), country: form.elements.country.value.trim(),
        runtime: form.elements.runtime.value.trim(),
        genres: form.elements.genres.value.split(",").map((genre) => genre.trim()).filter(Boolean),
        tagline: form.elements.tagline.value.trim(), synopsis: form.elements.synopsis.value.trim(),
        poster, videoFile, featured: form.elements.featured.checked,
        publicDomain: form.elements.publicDomain.checked
      };
      if (!validCatalog([film])) throw new Error("Check the required film fields and poster path.");
      const { error } = await supabaseClient.from("movies").upsert(toDatabaseFilm(film), { onConflict: "id" });
      if (error) throw error;
      status.textContent = `${film.title} saved to the shared catalog.`;
      resetEditor();
      await Promise.all([loadCatalog(), loadAudit()]);
    } catch (error) {
      console.error("Cywrld could not save the movie:", error);
      status.textContent = `Could not save to Supabase: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  }

  async function importBundledFilms() {
    const status = $("[data-admin-catalog-status]");
    status.textContent = "Importing bundled sample films into Supabase…";
    try {
      const response = await fetch(new URL("movies.json", document.baseURI));
      if (!response.ok) throw new Error(`Could not read movies.json (${response.status}).`);
      const films = await response.json();
      if (!validCatalog(films)) throw new Error("The bundled catalog has an invalid format.");
      const { error } = await supabaseClient.from("movies").upsert(films.map(toDatabaseFilm), { onConflict: "id" });
      if (error) throw error;
      await Promise.all([loadCatalog(), loadAudit()]);
      status.textContent = "Bundled sample films are now in the shared catalog. Matching IDs were updated.";
    } catch (error) {
      console.error("Cywrld could not import sample films:", error);
      status.textContent = `Import failed: ${error.message}`;
    }
  }

  async function deleteFilm(id) {
    const film = catalog.find((item) => item.id === id);
    if (!film || !window.confirm(`Delete "${film.title}" from the shared catalog? This affects every visitor.`)) return;
    $("[data-admin-catalog-status]").textContent = `Deleting ${film.title}…`;
    const { data, error } = await supabaseClient.from("movies").delete().eq("id", id).select("id");
    if (error) {
      $("[data-admin-catalog-status]").textContent = `Could not delete from Supabase: ${error.message}`;
      return;
    }
    if (!data || data.length !== 1) {
      $("[data-admin-catalog-status]").textContent = "No row was deleted. Confirm the admin role and RLS setup.";
      return;
    }
    if (editingId === id) resetEditor();
    await Promise.all([loadCatalog(), loadReleases(), loadReviews(), loadAudit()]);
    $("[data-admin-catalog-status]").textContent = `${film.title} deleted from the shared catalog.`;
  }

  async function postAdminReply(event) {
    event.preventDefault();
    if (!selectedThreadId || !event.currentTarget.reportValidity()) return;
    const button = event.currentTarget.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const body = event.currentTarget.elements.body.value.trim();
      const { error } = await supabaseClient.from("thread_messages").insert({ thread_id: selectedThreadId, body });
      if (error) throw error;
      event.currentTarget.reset();
      await Promise.all([loadInbox(), loadAudit()]);
      $("[data-admin-inbox-status]").textContent = "Reply added to the client's private website thread. No email was sent.";
    } catch (error) {
      console.error("Cywrld could not post the admin reply:", error);
      $("[data-admin-inbox-status]").textContent = `Could not post reply: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  }

  async function toggleThreadStatus() {
    const thread = threads.find((item) => item.id === selectedThreadId);
    if (!thread) return;
    const nextStatus = thread.status === "open" ? "closed" : "open";
    const { error } = await supabaseClient.from("message_threads").update({ status: nextStatus }).eq("id", selectedThreadId);
    if (error) {
      $("[data-admin-inbox-status]").textContent = `Could not update thread: ${error.message}`;
      return;
    }
    await Promise.all([loadInbox(), loadAudit()]);
  }

  async function deleteReview(id) {
    if (!window.confirm("Remove this public rating/review? This action is recorded in the audit log.")) return;
    const { data, error } = await supabaseClient.from("rating_reviews").delete().eq("id", id).select("id");
    if (error) {
      $("[data-admin-reviews-status]").textContent = `Could not remove review: ${error.message}`;
      return;
    }
    if (!data || data.length !== 1) {
      $("[data-admin-reviews-status]").textContent = "No review was removed. Confirm the admin RLS policy.";
      return;
    }
    await Promise.all([loadReviews(), loadAudit()]);
    $("[data-admin-reviews-status]").textContent = "Review removed. The moderation action is in the audit log.";
  }

  async function saveRelease(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const release = {
        movie_id: form.elements.movie_id.value,
        release_date: form.elements.release_date.value,
        note: form.elements.note.value.trim(),
        status: form.elements.status.value,
        created_by: currentAdminId
      };
      const { error } = await supabaseClient.from("movie_releases").insert(release);
      if (error) throw error;
      form.reset();
      await Promise.all([loadReleases(), loadAudit()]);
      $("[data-admin-calendar-status]").textContent = "Release date saved to the shared calendar. This schedules metadata only; no movie file was uploaded.";
    } catch (error) {
      console.error("Cywrld could not save calendar date:", error);
      $("[data-admin-calendar-status]").textContent = `Could not save calendar date: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  }
  let currentAdminId = "";

  async function updateReleaseStatus(id, status) {
    const { error } = await supabaseClient.from("movie_releases").update({ status }).eq("id", id);
    if (error) {
      $("[data-admin-calendar-status]").textContent = `Could not update calendar status: ${error.message}`;
      await loadReleases();
      return;
    }
    await Promise.all([loadReleases(), loadAudit()]);
    $("[data-admin-calendar-status]").textContent = "Calendar status updated.";
  }

  async function deleteRelease(id) {
    if (!window.confirm("Remove this date from the shared release calendar?")) return;
    const { error } = await supabaseClient.from("movie_releases").delete().eq("id", id);
    if (error) {
      $("[data-admin-calendar-status]").textContent = `Could not remove date: ${error.message}`;
      return;
    }
    await Promise.all([loadReleases(), loadAudit()]);
    $("[data-admin-calendar-status]").textContent = "Calendar date removed.";
  }

  function bindAdminEvents() {
    $("[data-admin-search]").addEventListener("input", renderCatalog);
    $("[data-admin-filter]").addEventListener("change", renderCatalog);
    $("[data-admin-search-form]").addEventListener("submit", (event) => { event.preventDefault(); renderCatalog(); });
    $("[data-admin-film-form]").addEventListener("submit", saveFilm);
    $("[data-cancel-edit]").addEventListener("click", resetEditor);
    $("[data-admin-film-form]").elements.poster.addEventListener("input", (event) => setPosterPreview(event.target.value));
    $("[data-admin-film-form]").elements.posterUpload.addEventListener("change", (event) => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const file = event.target.files[0];
      previewUrl = file ? URL.createObjectURL(file) : "";
      setPosterPreview(previewUrl || $("[data-admin-film-form]").elements.poster.value);
    });
    $("[data-admin-catalog]").addEventListener("click", (event) => {
      const edit = event.target.closest("[data-edit-film]");
      const remove = event.target.closest("[data-delete-film]");
      if (edit) editFilm(edit.dataset.editFilm);
      if (remove) deleteFilm(remove.dataset.deleteFilm);
    });
    $("[data-admin-inbox]").addEventListener("click", async (event) => {
      const button = event.target.closest("[data-admin-open-thread]");
      if (!button) return;
      try {
        await openAdminThread(button.dataset.adminOpenThread);
      } catch (error) {
        console.error("Cywrld could not load thread:", error);
        $("[data-admin-transcript]").textContent = `Could not load this thread: ${error.message}`;
      }
    });
    $("[data-admin-reply-form]").addEventListener("submit", postAdminReply);
    $("[data-toggle-thread-status]").addEventListener("click", toggleThreadStatus);
    $("[data-admin-reviews]").addEventListener("click", (event) => {
      const button = event.target.closest("[data-delete-review]");
      if (button) deleteReview(button.dataset.deleteReview);
    });
    $("[data-release-form]").addEventListener("submit", saveRelease);
    $("[data-release-calendar]").addEventListener("click", (event) => {
      const button = event.target.closest("[data-delete-release]");
      if (button) deleteRelease(button.dataset.deleteRelease);
    });
    $("[data-release-calendar]").addEventListener("change", (event) => {
      const select = event.target.closest("[data-release-status]");
      if (select) updateReleaseStatus(select.dataset.releaseStatus, select.value);
    });
    $("[data-calendar-prev]").addEventListener("click", () => {
      calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1);
      renderCalendar();
    });
    $("[data-calendar-next]").addEventListener("click", () => {
      calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1);
      renderCalendar();
    });
    $("[data-refresh-admin]").addEventListener("click", refreshAdminData);
    $("[data-refresh-audit]").addEventListener("click", () => loadAudit().catch((error) => {
      $("[data-admin-audit-status]").textContent = `Could not load audit log: ${error.message}`;
    }));
    $("[data-import-samples]").addEventListener("click", importBundledFilms);
    document.querySelectorAll("[data-admin-signout]").forEach((button) => {
      button.addEventListener("click", async () => {
        const { error } = await supabaseClient.auth.signOut();
        if (error) $("[data-admin-login-status]").textContent = `Sign-out failed: ${error.message}`;
      });
    });
    $("[data-admin-login]").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!event.currentTarget.reportValidity()) return;
      const status = $("[data-admin-login-status]");
      const button = $("[data-email-submit]");
      button.disabled = true;
      try {
        const email = event.currentTarget.elements.email.value.trim();
        const password = event.currentTarget.elements.password.value;
        const result = authMode === "signup"
          ? await supabaseClient.auth.signUp({ email, password, options: { emailRedirectTo: window.location.href } })
          : await supabaseClient.auth.signInWithPassword({ email, password });
        if (result.error) throw result.error;
        if (authMode === "signup" && !result.data.session) {
          status.textContent = "Account created. Confirm by email if requested; a project owner must separately grant admin access.";
        } else {
          await displaySession(result.data.session);
        }
      } catch (error) {
        console.error("Cywrld Supabase sign-in failed:", error);
        status.textContent = `Authentication failed: ${error.message}`;
      } finally {
        button.disabled = false;
      }
    });
    $("[data-auth-mode-toggle]").addEventListener("click", () => {
      setAuthMode(authMode === "signup" ? "signin" : "signup");
      $("[data-admin-login-status]").textContent = "";
    });
    $("[data-google-login]").addEventListener("click", async () => {
      const button = $("[data-google-login]");
      button.disabled = true;
      $("[data-admin-login-status]").textContent = "Redirecting to Google through Supabase Auth…";
      try {
        const { error } = await supabaseClient.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.href } });
        if (error) throw error;
      } catch (error) {
        console.error("Cywrld Google OAuth could not start:", error);
        $("[data-admin-login-status]").textContent = `Google sign-in unavailable: ${error.message}. Check Supabase provider and redirect setup.`;
        button.disabled = false;
      }
    });
  }

  async function initialize() {
    document.querySelectorAll("[data-current-year]").forEach((node) => { node.textContent = String(new Date().getFullYear()); });
    const config = window.CINEJOY_SUPABASE;
    const validation = validSupabaseConfig(config);
    if (!validation.valid) {
      showConfiguration(validation.reason);
      return;
    }
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      showConfiguration("The Supabase SDK did not load. Admin login requires internet access to its CDN; public catalog browsing still works from movies.json.");
      return;
    }

    supabaseClient = window.supabase.createClient(config.url.trim().replace(/\/+$/, ""), config.anonKey.trim());
    bindAdminEvents();
    const providers = config.providers || {};
    const emailEnabled = providers.emailPassword === true;
    const googleEnabled = providers.google === true;
    show("[data-provider-email]", emailEnabled);
    show("[data-provider-google]", googleEnabled);
    if (!emailEnabled && !googleEnabled) {
      $("[data-admin-login-status]").textContent = "Supabase is connected, but no sign-in method is enabled here. Configure a provider, then enable it in supabase-config.js.";
    }
    const { data: authListener } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => displaySession(session), 0);
    });
    window.addEventListener("pagehide", () => authListener.subscription.unsubscribe(), { once: true });
    try {
      const { data, error } = await supabaseClient.auth.getSession();
      if (error) throw error;
      await displaySession(data.session);
    } catch (error) {
      console.error("Cywrld could not read Supabase Auth session:", error);
      showConfiguration(`Could not contact Supabase Auth: ${error.message}`);
    }
  }

  document.addEventListener("DOMContentLoaded", initialize);
})();
