(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
  let client = null;
  let projectOrigin = "";

  function loadSdk() {
    if (window.supabase && typeof window.supabase.createClient === "function") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error("The Supabase browser client could not be loaded."));
      document.head.append(script);
    });
  }

  function downloadCard(item) {
    const product = item.digital_products;
    if (!product) return "";
    const date = new Date(item.granted_at);
    const granted = Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
    return `<article class="purchase-card"><div><p class="eyebrow">${escapeHTML(product.category)}</p><h3>${escapeHTML(product.name)}</h3><p>${escapeHTML(product.description)}</p><small>Purchased ${escapeHTML(granted)}</small></div><button class="button button-gold button-small" type="button" data-download-product="${escapeHTML(product.id)}">Get download</button></article>`;
  }

  async function downloadProduct(productId, button) {
    const status = $("[data-purchases-status]");
    button.disabled = true;
    status.textContent = "Checking your purchase and creating a short-lived download link…";
    try {
      const { data, error } = await client.functions.invoke("get-product-download", {
        body: { product_id: productId },
      });
      if (error) throw error;
      const url = new URL(data.download_url);
      if (url.origin !== projectOrigin || !url.pathname.startsWith("/storage/v1/object/sign/digital-products/")) {
        throw new Error("The server returned an unexpected download location.");
      }
      status.textContent = "Your private download link is ready and expires in one minute.";
      window.location.assign(url.href);
    } catch (error) {
      console.error("Cywrld could not create a download link:", error);
      status.textContent = `Download unavailable: ${error.message}`;
      button.disabled = false;
    }
  }

  async function initialize() {
    const status = $("[data-purchases-status]");
    const list = $("[data-purchases-list]");
    const config = window.CINEJOY_SUPABASE;
    const successReturn = new URLSearchParams(window.location.search).get("checkout") === "success";
    if (!config || !config.url || !config.anonKey) {
      status.textContent = successReturn
        ? "Checkout returned, but payment confirmation and downloads need Supabase and Stripe setup. No access is granted here."
        : "Purchases are unavailable until Supabase and verified Stripe checkout are configured.";
      return;
    }
    try {
      const projectUrl = new URL(config.url);
      const localHost = ["localhost", "127.0.0.1"].includes(projectUrl.hostname);
      if (projectUrl.username || projectUrl.password ||
          (projectUrl.protocol !== "https:" && !(localHost && projectUrl.protocol === "http:"))) {
        throw new Error("Supabase must use HTTPS (HTTP is allowed only for localhost development).");
      }
      projectOrigin = projectUrl.origin;
      await loadSdk();
      client = window.supabase.createClient(projectOrigin, config.anonKey.trim());
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session) {
        const link = document.createElement("a");
        link.href = "account.html";
        link.textContent = "Sign in to view purchases.";
        status.replaceChildren(link);
        if (successReturn) status.append(document.createTextNode(" Payment is not considered complete until the verified webhook grants access."));
        return;
      }
      const { data, error } = await client.from("product_entitlements")
        .select("id,product_id,granted_at,digital_products(id,name,category,description)")
        .eq("user_id", sessionData.session.user.id)
        .order("granted_at", { ascending: false });
      if (error) throw error;
      const ready = (data || []).filter((item) => item.digital_products);
      list.innerHTML = ready.length
        ? ready.map(downloadCard).join("")
        : `<div class="empty-state"><span aria-hidden="true">✦</span><h3>No downloads yet</h3><p>After a verified payment webhook confirms a purchase, your private download appears here.</p></div>`;
      status.textContent = successReturn && !ready.length
        ? "Stripe returned you here. Payment confirmation is still pending; downloads are added only after the verified webhook succeeds. Refresh this page in a moment."
        : `${ready.length} purchased ${ready.length === 1 ? "product" : "products"} available.`;
    } catch (error) {
      console.error("Cywrld could not load purchases:", error);
      status.textContent = `Could not load purchases: ${error.message}`;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("[data-purchases-list]").addEventListener("click", (event) => {
      const button = event.target.closest("[data-download-product]");
      if (button) downloadProduct(button.dataset.downloadProduct, button);
    });
    initialize();
  });
})();
