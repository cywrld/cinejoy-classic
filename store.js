(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
  const icons = { software: "⌘", apps: "▣", games: "✳", ebooks: "▤" };
  const labels = { software: "Software", apps: "Apps", games: "Games", ebooks: "Ebooks" };
  let client = null;
  let products = [];
  let category = "all";

  function validProjectUrl(value) {
    try {
      const url = new URL(value);
      const localHost = ["localhost", "127.0.0.1"].includes(url.hostname);
      return !url.username && !url.password &&
        (url.protocol === "https:" || (localHost && url.protocol === "http:")) ? url : null;
    } catch (error) {
      return null;
    }
  }

  function loadSdk() {
    if (window.supabase && typeof window.supabase.createClient === "function") {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error("The Supabase browser client could not be loaded."));
      document.head.append(script);
    });
  }

  function formatPrice(product) {
    if (!Number.isInteger(product.amount_cents)) return "Preview listing";
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: String(product.currency || "usd").toUpperCase(),
    }).format(product.amount_cents / 100);
  }

  function card(product, checkoutEnabled) {
    const preview = product.preview === true;
    const canCheckout = checkoutEnabled && !preview;
    const icon = icons[product.category] || "✦";
    return `<article class="store-card">
      <div class="store-card-art category-${escapeHTML(product.category)}" aria-hidden="true"><span>${icon}</span><small>${escapeHTML(labels[product.category] || "Digital")}</small></div>
      <div class="store-card-copy"><p class="eyebrow">${escapeHTML(labels[product.category] || "Digital product")}</p><h3>${escapeHTML(product.name)}</h3><p>${escapeHTML(product.description)}</p>
        <div class="store-card-footer"><strong>${escapeHTML(formatPrice(product))}</strong><button class="button ${canCheckout ? "button-gold" : "button-outline"} button-small" type="button" data-buy-product="${escapeHTML(product.id || "")}" ${canCheckout ? "" : "disabled"}>${canCheckout ? "Buy securely" : preview ? "Preview only" : "Checkout unavailable"}</button></div>
      </div>
    </article>`;
  }

  function render() {
    const query = $("[data-store-query]").value.trim().toLocaleLowerCase();
    const filtered = products.filter((product) => (category === "all" || product.category === category) &&
      (!query || `${product.name} ${product.description} ${product.category}`.toLocaleLowerCase().includes(query)));
    const checkoutEnabled = Boolean(window.CINEJOY_SUPABASE?.payments?.checkoutEnabled === true && client);
    $("[data-store-grid]").innerHTML = filtered.length
      ? filtered.map((product) => card(product, checkoutEnabled)).join("")
      : `<div class="empty-state"><span aria-hidden="true">✦</span><h3>No products found</h3><p>Try a different category or search.</p></div>`;
    if (!checkoutEnabled) {
      $("[data-store-status]").textContent = "Checkout is disabled. Sample listings are previews only; live purchases need configured Stripe prices, server secrets, and verified webhooks.";
    }
  }

  async function loadProducts() {
    const config = window.CINEJOY_SUPABASE;
    const projectUrl = config && validProjectUrl(config.url || "");
    if (projectUrl && config.anonKey) {
      try {
        await loadSdk();
        client = window.supabase.createClient(projectUrl.origin, config.anonKey.trim());
        const { data, error } = await client.from("digital_products")
          .select("id,slug,name,category,description,amount_cents,currency")
          .eq("published", true).order("name");
        if (error) throw error;
        products = Array.isArray(data) ? data : [];
        if (!products.length) {
          $("[data-store-status]").textContent = "The shared catalog is connected; no products are published yet.";
          render();
          return;
        }
        $("[data-store-status]").textContent = "Showing published digital products from the shared catalog.";
        render();
        return;
      } catch (error) {
        console.warn("Cywrld could not load the shared digital catalog:", error);
      }
    }
    try {
      const response = await fetch("products.json");
      if (!response.ok) throw new Error(`Catalog request failed (${response.status}).`);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error("The bundled product preview is invalid.");
      products = data;
      render();
    } catch (error) {
      console.error("Cywrld could not load digital product previews:", error);
      $("[data-store-status]").textContent = "The digital catalog could not be loaded. Serve this folder over HTTP to read the bundled preview.";
      $("[data-store-grid]").replaceChildren();
    }
  }

  async function beginCheckout(productId, button) {
    const status = $("[data-store-status]");
    const config = window.CINEJOY_SUPABASE;
    if (!client || config.payments?.checkoutEnabled !== true) {
      status.textContent = "Checkout is not configured. No payment was started.";
      return;
    }
    button.disabled = true;
    status.textContent = "Checking your account…";
    try {
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session) {
        status.textContent = "Sign in before checkout. No payment was started.";
        window.location.href = "account.html";
        return;
      }
      status.textContent = "Creating a secure Stripe Checkout session…";
      const projectUrl = validProjectUrl(config.url);
      const response = await fetch(`${projectUrl.origin}/functions/v1/create-checkout`, {
        method: "POST",
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${sessionData.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ product_id: productId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Checkout setup failed (${response.status}).`);
      const checkoutUrl = new URL(result.checkout_url);
      if (checkoutUrl.origin !== "https://checkout.stripe.com") throw new Error("Stripe returned an unexpected checkout destination.");
      status.textContent = "Opening Stripe-hosted checkout…";
      window.location.assign(checkoutUrl.href);
    } catch (error) {
      console.error("Cywrld could not start Stripe Checkout:", error);
      status.textContent = `Checkout could not start: ${error.message}. No purchase access was granted.`;
      button.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const requestedCategory = window.location.hash.slice(1);
    if (["software", "games", "ebooks", "apps"].includes(requestedCategory)) {
      category = requestedCategory;
      const activeButton = $(`[data-store-category="${category}"]`);
      document.querySelectorAll("[data-store-category]").forEach((button) => {
        button.setAttribute("aria-pressed", String(button === activeButton));
      });
    }
    $("[data-store-search]").addEventListener("submit", (event) => {
      event.preventDefault();
      render();
    });
    $("[data-store-query]").addEventListener("input", render);
    document.querySelectorAll("[data-store-category]").forEach((button) => {
      button.addEventListener("click", () => {
        category = button.dataset.storeCategory;
        document.querySelectorAll("[data-store-category]").forEach((item) => {
          item.setAttribute("aria-pressed", String(item === button));
        });
        const hash = category === "all" ? "" : `#${category}`;
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
        render();
      });
    });
    $("[data-store-grid]").addEventListener("click", (event) => {
      const button = event.target.closest("[data-buy-product]");
      if (button && !button.disabled) beginCheckout(button.dataset.buyProduct, button);
    });
    loadProducts();
  });
})();
