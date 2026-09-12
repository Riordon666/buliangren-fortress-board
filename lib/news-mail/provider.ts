export type InlineAttachment = { filename: string; content: string; contentId: string; contentType: string };
export type MailPayload = { to: string; subject: string; text: string; html: string; attachments?: InlineAttachment[] };
export type SendResult = { status: "sent"; id: string } | { status: "retry"; delayMs: number; reason: string } | { status: "unknown"; reason: string };
class InvalidProviderResponse extends Error {}
async function boundedResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new InvalidProviderResponse("empty-response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 32_768) { await reader.cancel(); throw new InvalidProviderResponse("large-response"); }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { reader.releaseLock(); }
}
export async function sendMail(apiUrl: string, token: string, key: string, payload: MailPayload, fetcher: typeof fetch = fetch): Promise<SendResult> {
  try {
    const response = await fetcher(apiUrl, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(45_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "Idempotency-Key": key }, body: JSON.stringify(payload)
    });
    if (response.status === 429) {
      const delay = Number(response.headers.get("retry-after"));
      return { status: "retry", delayMs: Number.isFinite(delay) && delay > 0 ? Math.min(delay * 1000, 86_400_000) : 300_000, reason: "provider-rate-limit" };
    }
    if (response.status >= 500) return { status: "retry", delayMs: 60_000, reason: "provider-unavailable" };
    if (response.status === 401 || response.status === 403) return { status: "retry", delayMs: 3_600_000, reason: "provider-authorization" };
    if (response.status === 409) return { status: "unknown", reason: "provider-uncertain-or-conflict" };
    let raw: string;
    try { raw = await boundedResponse(response); }
    catch (error) {
      if (error instanceof InvalidProviderResponse) return { status: "unknown", reason: "provider-invalid-response" };
      throw error; // A response-body transport failure is retried with the same idempotency key.
    }
    let body: { status?: string; id?: string };
    try {
      body = JSON.parse(raw);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid-response");
    } catch { return { status: "unknown", reason: "provider-invalid-response" }; }
    if (response.status === 200 && body.status === "sent" && typeof body.id === "string" && body.id.length > 0 && body.id.length < 500) return { status: "sent", id: body.id };
    if (response.status === 202 && body.status === "processing") return { status: "retry", delayMs: 30_000, reason: "provider-processing" };
    return { status: "unknown", reason: "provider-rejected-or-invalid-response" };
  } catch {
    // Retrying the same durable idempotency key is safe even if the response was lost after acceptance.
    return { status: "retry", delayMs: 60_000, reason: "provider-network" };
  }
}
