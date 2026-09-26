import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const configuredSiteUrl = Deno.env.get("CINEJOY_SITE_URL") || "";
let allowedOrigin = "";
try {
  const parsedSiteUrl = new URL(configuredSiteUrl);
  const localHost = ["localhost", "127.0.0.1"].includes(parsedSiteUrl.hostname);
  if ((parsedSiteUrl.protocol === "https:" || (localHost && parsedSiteUrl.protocol === "http:")) &&
      !parsedSiteUrl.username && !parsedSiteUrl.password &&
      parsedSiteUrl.pathname === "/" && !parsedSiteUrl.search && !parsedSiteUrl.hash) {
    allowedOrigin = parsedSiteUrl.origin;
  }
} catch {
  allowedOrigin = "";
}
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin || "null",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  if (!allowedOrigin || (origin && origin !== allowedOrigin)) {
    return jsonResponse(403, { error: "origin_not_allowed" });
  }
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse(405, { error: "method_not_allowed" });

  const projectUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const recipient = Deno.env.get("CINEJOY_NOTIFY_EMAIL");
  const sender = Deno.env.get("CINEJOY_FROM_EMAIL");
  const siteUrl = configuredSiteUrl;
  if (!projectUrl || !anonKey || !serviceRoleKey || !resendApiKey || !recipient || !sender || !siteUrl) {
    return jsonResponse(503, { error: "email_notification_not_configured" });
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization) return jsonResponse(401, { error: "authentication_required" });

  const userClient = createClient(projectUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return jsonResponse(401, { error: "invalid_session" });

  let threadId = "";
  try {
    const payload = await request.json();
    if (typeof payload.thread_id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.thread_id)) {
      return jsonResponse(400, { error: "invalid_thread_id" });
    }
    threadId = payload.thread_id;
  } catch {
    return jsonResponse(400, { error: "invalid_request_body" });
  }

  const { data: thread, error: threadError } = await userClient.from("message_threads")
    .select("id,subject,owner_email,user_id")
    .eq("id", threadId)
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (threadError || !thread) return jsonResponse(404, { error: "thread_not_found" });

  const { data: latestMessage, error: messageError } = await userClient.from("thread_messages")
    .select("id,body,sender_id,sender_role")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (messageError || !latestMessage ||
      latestMessage.sender_id !== userData.user.id || latestMessage.sender_role !== "client") {
    return jsonResponse(403, { error: "latest_message_not_from_client" });
  }

  const adminClient = createClient(projectUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: existing, error: existingError } = await adminClient.from("contact_notification_events")
    .select("status,attempted_at")
    .eq("message_id", latestMessage.id)
    .maybeSingle();
  if (existingError) return jsonResponse(500, { error: "notification_status_unavailable" });
  if (existing && existing.status === "sent") return jsonResponse(200, { sent: false, duplicate: true });
  if (existing && existing.status === "pending" &&
      Date.now() - new Date(existing.attempted_at).getTime() < 120000) {
    return jsonResponse(409, { error: "notification_in_progress" });
  }

  const rateLimitSince = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: rateError } = await adminClient.from("contact_notification_events")
    .select("message_id", { count: "exact", head: true })
    .eq("user_id", userData.user.id)
    .gte("attempted_at", rateLimitSince);
  if (rateError) return jsonResponse(500, { error: "notification_rate_check_failed" });
  if ((count || 0) >= 5) return jsonResponse(429, { error: "notification_rate_limit" });

  const event = {
    message_id: latestMessage.id,
    user_id: userData.user.id,
    status: "pending",
    attempted_at: new Date().toISOString(),
    sent_at: null,
    error_code: null,
  };
  const { error: eventError } = existing
    ? await adminClient.from("contact_notification_events").update(event).eq("message_id", latestMessage.id)
    : await adminClient.from("contact_notification_events").insert(event);
  if (eventError) {
    if (eventError.code === "23505") return jsonResponse(409, { error: "notification_in_progress" });
    return jsonResponse(500, { error: "notification_event_write_failed" });
  }

  const messageUrl = `${siteUrl.replace(/\/+$/, "")}/messages.html?id=${encodeURIComponent(thread.id)}`;
  const emailText = [
    "A new client message is available in the Cywrld admin inbox.",
    "",
    `From: ${thread.owner_email}`,
    `Topic: ${thread.subject}`,
    `Thread: ${thread.id}`,
    "",
    latestMessage.body,
    "",
    `Open the private thread: ${messageUrl}`,
    "",
    "Reply inside the website admin panel. This notification does not reply to the client.",
  ].join("\n");

  let resendResponse: Response;
  try {
    resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: sender,
        to: [recipient],
        subject: `New Cywrld message: ${thread.subject}`,
        text: emailText,
      }),
    });
  } catch {
    await adminClient.from("contact_notification_events").update({
      status: "failed",
      error_code: "provider_unreachable",
    }).eq("message_id", latestMessage.id);
    return jsonResponse(502, { error: "email_provider_unreachable" });
  }

  if (!resendResponse.ok) {
    await adminClient.from("contact_notification_events").update({
      status: "failed",
      error_code: `resend_http_${resendResponse.status}`,
    }).eq("message_id", latestMessage.id);
    return jsonResponse(502, { error: "email_provider_rejected_notification" });
  }

  await adminClient.from("contact_notification_events").update({
    status: "sent",
    sent_at: new Date().toISOString(),
    error_code: null,
  }).eq("message_id", latestMessage.id);
  return jsonResponse(200, { sent: true });
});
