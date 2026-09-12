import * as https from "node:https";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { Readable } from "node:stream";
import { SocksProxyAgent } from "socks-proxy-agent";

// This adapter intentionally supports only the bounded string requests used by
// the mail provider. It never changes Next's fetch or another service's proxy.
export function createMailFetcher(proxyUrl?: string): typeof fetch {
  if (!proxyUrl) return (input, init) => globalThis.fetch(input, init);
  let proxy: URL;
  try {
    proxy = new URL(proxyUrl);
    if (proxy.protocol !== "socks5h:" || !proxy.hostname || proxy.search || proxy.hash || (proxy.pathname && proxy.pathname !== "/")) throw new Error();
    decodeURIComponent(proxy.username);
    decodeURIComponent(proxy.password);
  } catch { throw new TypeError("invalid-mail-proxy"); }

  return async (input, init) => {
    if (input instanceof Request) throw new TypeError("unsupported-mail-request");
    const target = new URL(String(input));
    if (target.protocol !== "https:" || target.username || target.password) throw new TypeError("invalid-mail-target");
    if (init?.body != null && typeof init.body !== "string") throw new TypeError("unsupported-mail-body");
    if (init?.redirect && init.redirect !== "error") throw new TypeError("unsupported-mail-redirect");
    init?.signal?.throwIfAborted();
    const body = init?.body as string | null | undefined;
    const headers = new Headers(init?.headers);
    // Native https does not decompress response bodies. The hostname stays the
    // provider's hostname for both HTTP Host and TLS SNI/certificate validation.
    headers.set("Accept-Encoding", "identity");
    headers.set("Host", target.host);
    headers.set("Connection", "close");
    headers.delete("Transfer-Encoding");
    if (body != null) headers.set("Content-Length", String(Buffer.byteLength(body)));
    const agent = new SocksProxyAgent(proxy, { keepAlive: false, timeout: 15_000 });

    return new Promise<Response>((resolve, reject) => {
      let response: IncomingMessage | undefined;
      let proxySocket: Socket | undefined;
      let done = false;
      const controller = new AbortController();
      const abort = () => controller.abort(init?.signal?.reason);
      const timer = setTimeout(() => controller.abort(new DOMException("Mail request timed out", "TimeoutError")), 45_000);
      timer.unref();
      const cleanup = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        init?.signal?.removeEventListener("abort", abort);
        agent.destroy();
      };
      const request = https.request(target, {
        method: init?.method || "GET",
        headers: Object.fromEntries(headers),
        agent,
        rejectUnauthorized: true,
        signal: controller.signal,
      });
      request.on("proxy", (event: { socket: Socket }) => {
        proxySocket = event.socket;
        // agent-base awaits SOCKS authentication before it exposes this socket.
        // If cancelled during that wait, close it as soon as it is available.
        if (request.destroyed) proxySocket.destroy();
      });
      request.on("error", error => {
        response?.destroy(error);
        proxySocket?.destroy();
        cleanup();
        reject(controller.signal.aborted ? controller.signal.reason : error);
      });
      request.on("response", incoming => {
        response = incoming;
        incoming.once("close", cleanup);
        try {
          const status = incoming.statusCode || 500;
          if ([301, 302, 303, 307, 308].includes(status)) {
            incoming.destroy();
            request.destroy();
            cleanup();
            reject(new TypeError("unexpected redirect"));
            return;
          }
          const responseHeaders = new Headers();
          for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
            responseHeaders.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
          }
          // toWeb propagates aborted/truncated streams and cancels the Node stream
          // when the provider's existing response-size guard calls reader.cancel().
          const stream = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
          if ([204, 205, 304].includes(status) || init?.method === "HEAD") {
            incoming.resume();
            resolve(new Response(null, { status, headers: responseHeaders }));
          } else {
            resolve(new Response(stream, { status, headers: responseHeaders }));
          }
        } catch (error) {
          incoming.destroy();
          request.destroy();
          cleanup();
          reject(error);
        }
      });
      init?.signal?.addEventListener("abort", abort, { once: true });
      if (init?.signal?.aborted) abort();
      request.end(body ?? undefined);
    });
  };
}
