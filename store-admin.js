(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
  const MIME_TYPES = {
    "application/zip": "zip",
    "application/x-zip-compressed": "zip",
    "application/pdf": "pdf",
    "application/epub+zip": "epub",
  };
  let client = null;
  let products = [];
  let current = null;

  function setStatus(message) {
    $("[data-store-admin-status]").textContent = message;
  }

  function setProduct(product) {
    const form = $("[data-store-product-form]");
    current = product || null;
    form.reset();
    form.elements.productId.value = product ? product.id : crypto.randomUUID();
    form.elements.slug.value = product ? product.slug : "";
    form.elements.name.value = product ? product.name : "";
    form.elements.category.value = product ? product.category : "software";
    form.elements.description.value = product ? product.description : "";
    form.elements.price.value = product ? (product.amount_cents / 100).toFixed(2) : "";
    form.elements.stripePriceId.value = product ? product.stripe_price_id || "" : "";
    form.elements.published.checked = Boolean(product && product.published);
    $("[data-store-product-title]").textContent = product ? `Edit ${product.name}` : "Add a digital product";
    $("[data-store-product-file-status]").textContent = product && product.storage_path
      ? "A private delivery file is attached. Choose a replacement only if needed."
      : "No private delivery file is attached.";
  }

  function renderProducts() {
    const list = $("[data-store-admin-list]");
    list.innerHTML = products.length ? products.map((product) => `
      <article class="store-admin-item">
        <div><strong>${escapeHTML(product.name)}</strong><span>${escapeHTML(product.category)} · ${(product.amount_cents / 100).toFixed(2)} USD · ${product.published ? "Published" : "Draft"}</span></div>
        <button class="button button-outline button-small" type="button" data-edit-store-product="${escapeHTML(product.id)}">Edit</button>
      </article>`).join("") : `<p class="admin-empty">No digital products are configured yet.</p>`;
  }

  async function loadProducts() {
    const [{ data: publicRows, error: publicError }, { data: privateRows, error: privateError }] = await Promise.all([
      client.from("digital_products").select("id,slug,name,category,description,amount_cents,currency,published").order("name"),
      client.from("digital_product_private").select("product_id,stripe_price_id,storage_path"),
    ]);
    if (publicError) throw publicError;
    if (privateError) throw privateError;
    const privateById = new Map((privateRows || []).map((row) => [row.product_id, row]));
    products = (publicRows || []).map((product) => ({
      ...product,
      ...(privateById.get(product.id) || {}),
      stripe_price_id: privateById.get(product.id)?.stripe_price_id || "",
      storage_path: privateById.get(product.id)?.storage_path || "",
    }));
    renderProducts();
  }

  async function uploadProductFile(file, productId) {
    if (!file) return "";
    const extension = MIME_TYPES[file.type];
    if (!extension) throw new Error("Choose a ZIP, PDF, or EPUB delivery file.");
    if (file.size < 1 || file.size > 104857600) throw new Error("Digital files must be between 1 byte and 100 MB.");
    const path = `products/${productId}/${crypto.randomUUID()}.${extension}`;
    const { error } = await client.storage.from("digital-products").upload(path, file, {
      upsert: false,
      contentType: file.type,
      cacheControl: "3600",
    });
    if (error) throw error;
    return path;
  }

  async function saveProduct(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const button = $("[data-save-store-product]");
    button.disabled = true;
    setStatus("Saving product metadata and private delivery details…");
    let uploadedPath = "";
    let saved = false;
    try {
      const productId = form.elements.productId.value;
      const file = form.elements.file.files[0];
      uploadedPath = await uploadProductFile(file, productId);
      const storagePath = uploadedPath || (current && current.storage_path) || "";
      const amountCents = Math.round(Number(form.elements.price.value) * 100);
      const { error } = await client.rpc("save_digital_product", {
        p_product_id: productId,
        p_slug: form.elements.slug.value.trim(),
        p_name: form.elements.name.value.trim(),
        p_category: form.elements.category.value,
        p_description: form.elements.description.value.trim(),
        p_amount_cents: amountCents,
        p_stripe_price_id: form.elements.stripePriceId.value.trim(),
        p_storage_path: storagePath,
        p_published: form.elements.published.checked,
      });
      if (error) throw error;
      saved = true;
      await loadProducts();
      setProduct(null);
      setStatus("Product saved. It is available for checkout only after Stripe and webhook setup is completed.");
    } catch (error) {
      if (saved) {
        setStatus(`Product was saved, but the list could not refresh: ${error.message}`);
      } else if (uploadedPath) {
        const { error: cleanupError } = await client.storage.from("digital-products").remove([uploadedPath]);
        if (cleanupError) {
          console.error("Cywrld could not remove an unlinked product upload:", cleanupError);
          setStatus(`Product save failed: ${error.message}. The new private file could not be cleaned up; note its generated path in the Supabase Storage dashboard.`);
        } else {
          setStatus(`Product save failed: ${error.message}. The unlinked private upload was removed.`);
        }
      } else {
        setStatus(`Product save failed: ${error.message}`);
      }
    } finally {
      button.disabled = false;
    }
  }

  async function initialize() {
    if (!$("[data-store-admin]")) return;
    const config = window.CINEJOY_SUPABASE;
    if (!config || !config.url || !config.anonKey || !window.supabase) {
      setStatus("Connect Supabase Auth and apply supabase-setup.sql before managing store products.");
      return;
    }
    try {
      const url = new URL(config.url);
      const localHost = ["localhost", "127.0.0.1"].includes(url.hostname);
      if (url.username || url.password ||
          (url.protocol !== "https:" && !(localHost && url.protocol === "http:"))) {
        throw new Error("Use HTTPS for the Supabase project URL.");
      }
      client = window.supabase.createClient(url.origin, config.anonKey.trim());
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (!data.session) {
        setStatus("Sign in to the separate admin page to manage digital products.");
        return;
      }
      await loadProducts();
      setProduct(null);
      setStatus("Digital catalog connected. Products publish only with a matching Stripe price and private delivery file.");
    } catch (error) {
      console.error("Cywrld could not initialize digital product administration:", error);
      setStatus(`Digital product management unavailable: ${error.message}`);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const form = $("[data-store-product-form]");
    if (!form) return;
    form.addEventListener("submit", saveProduct);
    $("[data-new-store-product]").addEventListener("click", () => setProduct(null));
    $("[data-store-admin-list]").addEventListener("click", (event) => {
      const button = event.target.closest("[data-edit-store-product]");
      if (button) setProduct(products.find((product) => product.id === button.dataset.editStoreProduct));
    });
    initialize();
  });
})();
