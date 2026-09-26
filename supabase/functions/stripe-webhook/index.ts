import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRecord, readTextBody } from "../_shared/http.ts";

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return jsonResponse(405, { error: "method_not_allowed" });
  const projectUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!projectUrl || !serviceRoleKey || !webhookSecret) {
    return jsonResponse(503, { error: "webhook_not_configured" });
  }
  if (Number(request.headers.get("Content-Length") || "0") > 1048576) {
    return jsonResponse(413, { error: "request_too_large" });
  }

  let rawBody: string;
  try {
    rawBody = await readTextBody(request, 1048576);
  } catch (error) {
    if (error instanceof RangeError) return jsonResponse(413, { error: "request_too_large" });
    throw error;
  }
  const signatureHeader = request.headers.get("Stripe-Signature") || "";
  const signatureParts = signatureHeader.split(",").map((part) => part.split("=", 2));
  const timestamp = signatureParts.find(([key]) => key === "t")?.[1] || "";
  const signatures = signatureParts.filter(([key]) => key === "v1").map(([, value]) => value || "");
  const timestampNumber = Number(timestamp);
  if (!Number.isInteger(timestampNumber) || Math.abs(Date.now() / 1000 - timestampNumber) > 300 || !signatures.length) {
    return jsonResponse(400, { error: "invalid_signature" });
  }
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  const expectedSignature = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (!signatures.some((signature) => constantTimeEqual(signature, expectedSignature))) {
    return jsonResponse(400, { error: "invalid_signature" });
  }

  let event: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!isRecord(parsed)) return jsonResponse(400, { error: "invalid_event_shape" });
    event = parsed;
  } catch {
    return jsonResponse(400, { error: "invalid_event_body" });
  }
  if (typeof event.id !== "string" || typeof event.type !== "string" ||
      !isRecord(event.data) || !isRecord(event.data.object)) {
    return jsonResponse(400, { error: "invalid_event_shape" });
  }
  const supportedEvents = new Set([
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
  ]);
  if (!supportedEvents.has(event.type)) return jsonResponse(200, { received: true, ignored: true });
  const session = event.data.object;
  if (session.payment_status !== "paid") return jsonResponse(200, { received: true, pending_payment: true });

  const metadata = isRecord(session.metadata) ? session.metadata : {};
  const orderId = metadata.order_id;
  const productId = metadata.product_id;
  const userId = metadata.user_id;
  if (typeof orderId !== "string" || typeof productId !== "string" || typeof userId !== "string" ||
      typeof session.id !== "string" || session.mode !== "payment" ||
      session.client_reference_id !== userId || !Number.isInteger(session.amount_total) ||
      typeof session.currency !== "string") {
    return jsonResponse(400, { error: "checkout_metadata_invalid" });
  }

  const admin = createClient(projectUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: order, error: orderError } = await admin.from("checkout_orders")
    .select("id,user_id,product_id,stripe_session_id,amount_cents,currency,status")
    .eq("id", orderId).maybeSingle();
  if (orderError) return jsonResponse(500, { error: "order_lookup_failed" });
  if (!order || order.user_id !== userId || order.product_id !== productId ||
      order.stripe_session_id !== session.id || order.amount_cents !== session.amount_total ||
      order.currency !== session.currency) {
    return jsonResponse(400, { error: "checkout_does_not_match_order" });
  }

  const { error: entitlementError } = await admin.from("product_entitlements").upsert({
    order_id: order.id,
    user_id: order.user_id,
    product_id: order.product_id,
  }, { onConflict: "order_id", ignoreDuplicates: true });
  if (entitlementError) return jsonResponse(500, { error: "entitlement_grant_failed" });
  const { error: updateError } = await admin.from("checkout_orders").update({
    status: "paid",
    paid_at: new Date().toISOString(),
  }).eq("id", order.id);
  if (updateError) return jsonResponse(500, { error: "order_update_failed" });
  const { error: eventError } = await admin.from("stripe_webhook_events").upsert({
    event_id: event.id,
    event_type: event.type,
  }, { onConflict: "event_id", ignoreDuplicates: true });
  if (eventError) return jsonResponse(500, { error: "webhook_audit_write_failed" });
  return jsonResponse(200, { received: true, fulfilled: true });
});
