(() => {
  "use strict";

  const STORAGE_KEY = "cinejoy-classic-optional-cookie-choice";

  function readChoice() {
    try {
      const choice = window.localStorage.getItem(STORAGE_KEY);
      return choice === "accepted" || choice === "declined" ? choice : "";
    } catch (error) {
      console.warn("Cywrld could not read the privacy preference:", error);
      return "";
    }
  }

  function saveChoice(choice, status) {
    try {
      window.localStorage.setItem(STORAGE_KEY, choice);
      status.textContent = "Your choice is saved on this browser. No optional cookies or trackers are active.";
      return true;
    } catch (error) {
      console.error("Cywrld could not save the privacy preference:", error);
      status.textContent = "This browser could not save your choice. No optional cookies or trackers are active.";
      return false;
    }
  }

  function initialize() {
    const menuButton = document.querySelector(".menu-toggle");
    const nav = document.querySelector(".primary-nav");
    if (menuButton && nav) {
      menuButton.addEventListener("click", () => {
        const expanded = menuButton.getAttribute("aria-expanded") === "true";
        menuButton.setAttribute("aria-expanded", String(!expanded));
        nav.classList.toggle("is-open", !expanded);
      });
      nav.addEventListener("click", (event) => {
        if (event.target.closest("a")) {
          menuButton.setAttribute("aria-expanded", "false");
          nav.classList.remove("is-open");
        }
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") {
          menuButton.setAttribute("aria-expanded", "false");
          nav.classList.remove("is-open");
          menuButton.focus();
        }
      });
    }
    const notice = document.createElement("aside");
    notice.className = "privacy-notice";
    notice.setAttribute("aria-labelledby", "privacy-title");
    notice.setAttribute("aria-describedby", "privacy-description");
    notice.hidden = Boolean(readChoice());
    notice.innerHTML = `<div class="privacy-copy"><p class="eyebrow">Your privacy</p><h2 id="privacy-title">A clear view of cookies.</h2><p id="privacy-description">Cywrld currently uses no analytics, advertising, or marketing cookies and adds no tracking scripts. Your watchlist and Supabase Auth session use browser local storage, not cookies. Choosing either option only saves your preference here; it does not activate optional tracking.</p><p class="privacy-status" data-privacy-status role="status" aria-live="polite"></p></div><div class="privacy-actions"><button class="button button-gold" type="button" data-cookie-choice="accepted">Accept optional cookies</button><button class="button button-outline" type="button" data-cookie-choice="declined">Decline optional cookies</button></div><button class="privacy-close" type="button" aria-label="Dismiss cookie preferences notice" data-cookie-dismiss>×</button>`;
    document.body.append(notice);

    notice.addEventListener("click", (event) => {
      const choiceButton = event.target.closest("[data-cookie-choice]");
      if (choiceButton) {
        const saved = saveChoice(choiceButton.dataset.cookieChoice, notice.querySelector("[data-privacy-status]"));
        notice.hidden = saved;
        return;
      }
      if (event.target.closest("[data-cookie-dismiss]")) notice.hidden = true;
    });
    document.querySelectorAll("[data-cookie-preferences]").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        notice.hidden = false;
        notice.querySelector("[data-cookie-choice]").focus();
      });
    });
  }

  document.addEventListener("DOMContentLoaded", initialize);
})();
