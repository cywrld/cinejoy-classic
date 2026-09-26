import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { configuredSiteOrigin, corsHeaders, isRecord, jsonResponse, originIsAllowed, readTextBody } from "../_shared/http.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (request: Request) => {
  let siteOrigin: string;
  try {
    siteOrigin = configuredSiteOrigin();
  } catch {
    return jsonResponse(503, { error: "site_origin_not_configured" });
  }
  const origin = request.headers.get("Origin");
  const headers = corsHeaders(origin, siteOrigin);
  const respond = (status: number, body: Record<string, unknown>) => jsonResponse(status, body, headers);
  if (!originIsAllowed(origin, siteOrigin)) return respond(403, { error: "origin_not_allowed" });
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return respond(405, { error: "method_not_allowed" });
  if (Number(request.headers.get("Content-Length") || "0") > 4096) return respond(413, { error: "request_too_large" });
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    return respond(415, { error: "json_required" });
  }

  const enabled = Deno.env.get("STRIPE_CHECKOUT_ENABLED") === "true";
  const projectUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  if (!enabled || !projectUrl || !anonKey || !serviceRoleKey || !stripeSecret) {
    return respond(503, { error: "checkout_not_configured" });
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization) return respond(401, { error: "authentication_required" });
  const userClient = createClient(projectUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return respond(401, { error: "invalid_session" });

  let productId = "";
  try {
    const body: unknown = JSON.parse(await readTextBody(request, 4096));
    if (!isRecord(body) || typeof body.product_id !== "string" || !UUID_PATTERN.test(body.product_id)) {
      return respond(400, { error: "invalid_product_id" });
    }
    productId = body.product_id;
  } catch (error) {
    if (error instanceof RangeError) return respond(413, { error: "request_too_large" });
    return respond(400, { error: "invalid_request_body" });
  }

  const admin = createClient(projectUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: product, error: productError } = await admin.from("digital_products")
    .select("id,name,amount_cents,currency,published")
    .eq("id", productId).eq("published", true).maybeSingle();
  if (productError) return respond(500, { error: "product_lookup_failed" });
  if (!product) return respond(404, { error: "product_unavailable" });

  const { data: privateProduct, error: privateError } = await admin.from("digital_product_private")
    .select("stripe_price_id,storage_path")
    .eq("product_id", product.id).maybeSingle();
  if (privateError) return respond(500, { error: "product_configuration_lookup_failed" });
  if (!privateProduct?.stripe_price_id || !privateProduct.storage_path) {
    return respond(503, { error: "product_fulfillment_not_configured" });
  }
  if (!/^price_[A-Za-z0-9]+$/.test(privateProduct.stripe_price_id)) {
    return respond(503, { error: "product_price_invalid" });
  }

  const priceResponse = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(privateProduct.stripe_price_id)}`, {
    headers: { Authorization: `Bearer ${stripeSecret}` },
  });
  if (!priceResponse.ok) return respond(503, { error: "stripe_price_unavailable" });
  const price: unknown = await priceResponse.json();
  if (!isRecord(price) || price.active !== true || price.type !== "one_time" ||
      price.unit_amount !== product.amount_cents || price.currency !== product.currency) {
    return respond(409, { error: "stripe_price_does_not_match_catalog" });
  }

  const orderId = crypto.randomUUID();
  const { error: orderError } = await admin.from("checkout_orders").insert({
    id: orderId,
    user_id: authData.user.id,
    product_id: product.id,
    amount_cents: product.amount_cents,
    currency: product.currency,
    status: "pending",
  });
  if (orderError) return respond(500, { error: "order_initialization_failed" });

  const checkoutBody = new URLSearchParams({
    mode: "payment",
    "line_items[0][price]": privateProduct.stripe_price_id,
    "line_items[0][quantity]": "1",
    "client_reference_id": authData.user.id,
    "metadata[order_id]": orderId,
    "metadata[product_id]": product.id,
    "metadata[user_id]": authData.user.id,
    "success_url": `${siteOrigin}/purchases.html?checkout=success`,
    "cancel_url": `${siteOrigin}/store.html?checkout=cancelled`,
  });
  if (authData.user.email) checkoutBody.set("customer_email", authData.user.email);
  const sessionResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecret}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": orderId,
    },
    body: checkoutBody,
  });
  const session: unknown = await sessionResponse.json();
  if (!sessionResponse.ok || !isRecord(session) || typeof session.id !== "string" ||
      typeof session.url !== "string" || !session.url.startsWith("https://checkout.stripe.com/")) {
    await admin.from("checkout_orders").update({ status: "failed" }).eq("id", orderId);
    return respond(502, { error: "stripe_checkout_creation_failed" });
  }

  const { error: sessionWriteError } = await admin.from("checkout_orders")
    .update({ stripe_session_id: session.id }).eq("id", orderId);
  if (sessionWriteError) {
    await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(session.id)}/expire`, {
      method: "POST",
      headers: { Authorization: `Bearer ${stripeSecret}` },
    });
    await admin.from("checkout_orders").update({ status: "failed" }).eq("id", orderId);
    return respond(500, { error: "checkout_order_link_failed" });
  }
  return respond(200, { checkout_url: session.url });
});
