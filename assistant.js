(() => {
  "use strict";

  const FAQ = [
    {
      match: /\b(metropolis|watch|stream|video|movie file|film file)\b/i,
      text: "Cywrld is a discovery guide, not a streaming service. The Metropolis page can play only a video file you provide at videos/metropolis.mp4; no film is included. Check the rights for your copy and location.",
      link: ["Open Metropolis", "movie.html?id=metropolis"],
    },
    {
      match: /\b(rights?|copyright|public domain|licensed|legal)\b/i,
      text: "Rights can vary by country, restoration, soundtrack, and edition. Cywrld does not make blanket public-domain claims. Verify the specific copy and its distribution terms before viewing or selling anything.",
      link: ["Read the FAQ", "faq.html"],
    },
    {
      match: /\b(checkout|stripe|payment|buy|purchase|download|store)\b/i,
      text: "The digital store is currently preview-only. Checkout is disabled until Stripe secrets are set server-side, prices are validated, and a verified webhook confirms payment before downloads are granted.",
      link: ["Browse the store", "store.html"],
    },
    {
      match: /\b(show|shows|series|tv)\b/i,
      text: "The shows section is being prepared. No episodes are hosted here; only original or properly licensed show listings will be added.",
      link: ["Visit Shows", "shows.html"],
    },
    {
      match: /\b(account|sign.?in|message|contact|support)\b/i,
      text: "Accounts and private support messages need a configured Supabase project. When active, message threads are limited to their signed-in participant and authorized administrators.",
      link: ["Open your account", "account.html"],
    },
    {
      match: /\b(cookie|privacy|tracking|analytics)\b/i,
      text: "Cywrld adds no analytics or advertising trackers. Watchlist and cookie-preference choices stay in this browser's local storage.",
      link: ["Read the FAQ", "faq.html"],
    },
  ];

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  async function findFilms(query) {
    const response = await fetch("movies.json");
    if (!response.ok) throw new Error("The bundled movie guide is unavailable.");
    const films = await response.json();
    if (!Array.isArray(films)) throw new Error("The movie guide has an unexpected format.");
    const terms = query.toLocaleLowerCase().match(/[a-z0-9]{3,}/g) || [];
    const scored = films.map((film) => {
      const text = `${film.title} ${film.director} ${film.country} ${film.synopsis} ${(film.genres || []).join(" ")}`.toLocaleLowerCase();
      return { film, score: terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0) };
    }).filter((item) => item.score > 0);
    if (!scored.length && /\b(recommend|suggest|pick|choose)\b/i.test(query)) {
      return films.filter((film) => film.featured).slice(0, 3);
    }
    return scored.sort((left, right) => right.score - left.score).slice(0, 3).map((item) => item.film);
  }

  function addMessage(list, text, role, links = []) {
    const message = createElement("div", `assistant-message is-${role}`);
    const paragraph = createElement("p", "", text);
    message.append(paragraph);
    links.forEach(([label, href]) => {
      const link = createElement("a", "assistant-result-link", label);
      link.href = href;
      message.append(link);
    });
    list.append(message);
    list.scrollTop = list.scrollHeight;
  }

  async function answer(question) {
    const known = FAQ.find((entry) => entry.match.test(question));
    if (known) return { text: known.text, links: [known.link] };
    try {
      const films = await findFilms(question);
      if (films.length) {
        return {
          text: "Here are a few matches from the bundled movie catalog. Search is local and keyword-based—not a generative AI response.",
          links: films.map((film) => [ `${film.title} (${film.year})`, `movie.html?id=${encodeURIComponent(film.id)}` ]),
        };
      }
    } catch (error) {
      console.warn("Cywrld assistant could not search the local movie guide:", error);
    }
    return {
      text: "I can help find movies, explain viewing and rights notes, or point you to the store and account pages. This is a deterministic site guide; it does not send your question to an AI service.",
      links: [["Browse movies", "movies.html"], ["Browse digital products", "store.html"]],
    };
  }

  function initialize() {
    if (document.querySelector("[data-site-assistant]")) return;
    const widget = createElement("section", "assistant-widget");
    widget.dataset.siteAssistant = "";
    widget.innerHTML = `
      <section class="assistant-panel" id="assistant-panel" data-assistant-panel role="dialog" aria-modal="false" aria-labelledby="assistant-title" hidden>
        <header class="assistant-panel-header"><div><p class="eyebrow">A little help</p><h2 id="assistant-title">Cywrld guide</h2></div><button type="button" class="assistant-close" data-assistant-close aria-label="Close site assistant">×</button></header>
        <p class="assistant-disclosure">Local answers · not generative AI</p>
        <div class="assistant-transcript" data-assistant-transcript aria-live="polite" aria-relevant="additions"></div>
        <form class="assistant-form" data-assistant-form><label class="visually-hidden" for="assistant-question">Ask about movies, the store, or the site</label><input id="assistant-question" name="question" type="text" maxlength="240" placeholder="Find a film or ask a question…" required><button class="button button-gold button-small" type="submit" aria-label="Send question">Ask</button></form>
      </section>
      <button type="button" class="assistant-launcher" data-assistant-open aria-expanded="false" aria-controls="assistant-panel" aria-label="Open Cywrld site assistant"><span aria-hidden="true">✦</span><span>Ask Cywrld</span></button>`;
    document.body.append(widget);
    const panel = widget.querySelector("[data-assistant-panel]");
    const launcher = widget.querySelector("[data-assistant-open]");
    const close = widget.querySelector("[data-assistant-close]");
    const transcript = widget.querySelector("[data-assistant-transcript]");
    const form = widget.querySelector("[data-assistant-form]");
    const input = widget.querySelector("#assistant-question");
    addMessage(transcript, "I can help you find a film or answer common site questions. Your message stays in this browser.", "assistant");

    function setOpen(open) {
      panel.hidden = !open;
      launcher.setAttribute("aria-expanded", String(open));
      if (open) input.focus();
      else launcher.focus();
    }

    launcher.addEventListener("click", () => setOpen(panel.hidden));
    close.addEventListener("click", () => setOpen(false));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !panel.hidden) setOpen(false);
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const question = input.value.trim();
      if (!question) return;
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      addMessage(transcript, question, "user");
      input.value = "";
      const pending = createElement("div", "assistant-message is-assistant", "Looking through the local guide…");
      transcript.append(pending);
      try {
        const reply = await answer(question);
        pending.remove();
        addMessage(transcript, reply.text, "assistant", reply.links);
      } finally {
        submit.disabled = false;
        input.focus();
      }
    });

    const reposition = () => {
      const notice = document.querySelector(".privacy-notice");
      widget.classList.toggle("has-cookie-notice", Boolean(notice && !notice.hidden));
    };
    new MutationObserver(reposition).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
    window.addEventListener("resize", reposition);
    reposition();
  }

  document.addEventListener("DOMContentLoaded", initialize);
})();
