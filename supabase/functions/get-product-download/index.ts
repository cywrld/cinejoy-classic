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

  const projectUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!projectUrl || !anonKey || !serviceRoleKey) return respond(503, { error: "download_service_not_configured" });
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
  const { data: entitlement, error: entitlementError } = await admin.from("product_entitlements")
    .select("id").eq("user_id", authData.user.id).eq("product_id", productId).limit(1).maybeSingle();
  if (entitlementError) return respond(500, { error: "entitlement_lookup_failed" });
  if (!entitlement) return respond(403, { error: "purchase_required" });

  const { data: privateProduct, error: productError } = await admin.from("digital_product_private")
    .select("storage_path").eq("product_id", productId).maybeSingle();
  if (productError) return respond(500, { error: "product_asset_lookup_failed" });
  if (!privateProduct?.storage_path || !/^products\/[a-f0-9-]+\/[A-Za-z0-9._-]+$/.test(privateProduct.storage_path)) {
    return respond(404, { error: "product_asset_unavailable" });
  }
  const { data: signed, error: signError } = await admin.storage
    .from("digital-products").createSignedUrl(privateProduct.storage_path, 60, { download: true });
  if (signError || !signed?.signedUrl) return respond(500, { error: "download_link_unavailable" });
  return respond(200, { download_url: signed.signedUrl, expires_in: 60 });
});
