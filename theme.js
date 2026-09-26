(() => {
  "use strict";

  const STORAGE_KEY = "Cywrld-color-theme";
  const media = window.matchMedia("(prefers-color-scheme: light)");
  let storedPreference = "";

  try {
    storedPreference = window.localStorage.getItem(STORAGE_KEY) || "";
  } catch (error) {
    console.warn("Cywrld could not read the saved theme preference:", error);
  }
  let theme = storedPreference === "light" || storedPreference === "dark"
    ? storedPreference
    : media.matches ? "light" : "dark";

  function applyTheme() {
    document.documentElement.dataset.theme = theme;
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = theme === "dark" ? "#000000" : "#f6f7f7";
    const button = document.querySelector("[data-theme-toggle]");
    if (!button) return;
    const switchingTo = theme === "dark" ? "light" : "dark";
    button.setAttribute("aria-label", `Switch to ${switchingTo} theme`);
    button.setAttribute("title", `Switch to ${switchingTo} theme`);
    button.setAttribute("aria-pressed", String(theme === "light"));
    button.innerHTML = theme === "dark"
      ? `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.8"></circle><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"></path></svg>`
      : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 15.1A8.4 8.4 0 0 1 8.9 3.8 8.5 8.5 0 1 0 20.2 15.1Z"></path></svg>`;
  }

  document.documentElement.dataset.theme = theme;
  document.addEventListener("DOMContentLoaded", () => {
    const header = document.querySelector(".header-inner");
    if (!header) return;
    const navigation = header.querySelector(".primary-nav");
    if (navigation && !header.querySelector("[data-site-search]")) {
      const form = document.createElement("form");
      form.className = "header-search-form";
      form.dataset.siteSearch = "";
      form.setAttribute("role", "search");
      form.setAttribute("aria-label", "Search movies");
      form.innerHTML = `<label class="visually-hidden" for="site-movie-search">Search movies by title or keyword</label><input id="site-movie-search" name="q" type="search" maxlength="120" placeholder="Search movies…" autocomplete="off"><button type="submit">Search</button>`;
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const query = form.elements.q.value.trim();
        const destination = new URL("movies.html", window.location.href);
        if (query) destination.searchParams.set("q", query);
        destination.hash = "catalog-search";
        window.location.assign(destination.href);
      });
      header.insertBefore(form, navigation);
    }
    const button = document.createElement("button");
    button.className = "theme-toggle";
    button.type = "button";
    button.dataset.themeToggle = "";
    header.append(button);
    applyTheme();
    button.addEventListener("click", () => {
      theme = theme === "dark" ? "light" : "dark";
      storedPreference = theme;
      applyTheme();
      try {
        window.localStorage.setItem(STORAGE_KEY, theme);
      } catch (error) {
        console.warn("Cywrld could not save the theme preference:", error);
      }
    });
  }, { once: true });

  media.addEventListener("change", (event) => {
    if (!storedPreference) {
      theme = event.matches ? "light" : "dark";
      applyTheme();
    }
  });
})();
