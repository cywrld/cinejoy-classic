export function configuredSiteOrigin(): string {
  const configured = Deno.env.get("CINEJOY_SITE_URL");
  if (!configured) throw new Error("CINEJOY_SITE_URL is not configured.");
  const url = new URL(configured);
  const localHost = ["localhost", "127.0.0.1"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(localHost && url.protocol === "http:")) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("CINEJOY_SITE_URL must be an HTTPS origin (localhost HTTP is allowed for development).");
  }
  return url.origin;
}

export function corsHeaders(origin: string | null, siteOrigin: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (origin && origin === siteOrigin) headers["Access-Control-Allow-Origin"] = siteOrigin;
  return headers;
}

export function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

export function originIsAllowed(origin: string | null, siteOrigin: string): boolean {
  return !origin || origin === siteOrigin;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readTextBody(request: Request, maximumBytes: number): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new RangeError("request_body_too_large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}
