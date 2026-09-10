import { NEWS_SOURCE_URL } from "@/lib/news/types";

const PAGE_PATH = /^\/supercore\/act\/[a-f0-9]{32,33}\/index\.html$/;
const SCRIPT_PATH = /^\/supercore\/act\/[a-f0-9]{32,33}\/js\/app\.[a-f0-9]+\.js$/;
const IMAGE_PATH = /^\/activity\/supercore\/12854\/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)$/;

export function isAllowedSourceUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    if (url.href === NEWS_SOURCE_URL) return true;
    return url.hostname === "act.supercore.qq.com" && (
      PAGE_PATH.test(url.pathname) || SCRIPT_PATH.test(url.pathname) || IMAGE_PATH.test(url.pathname)
    );
  } catch { return false; }
}

export function parseNewsEntry(html: string, sourceUrl: string) {
  const url = new URL(sourceUrl);
  if (!isAllowedSourceUrl(sourceUrl) || !PAGE_PATH.test(url.pathname)) throw new Error("invalid-source");
  if (!/<title[^>]*>\s*火影忍者手游木叶快报\s*<\/title>/i.test(html)) throw new Error("invalid-title");
  const version = html.match(/\bCEIBA_ACT_VERSION\s*=\s*(\d{1,16})\s*;/)?.[1];
  const script = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)]
    .map((match) => new URL(match[1], sourceUrl))
    .find((item) => SCRIPT_PATH.test(item.pathname));
  if (!version || !script || !isAllowedSourceUrl(script.href)) throw new Error("missing-publication");
  return { version, scriptUrl: script.href, sourceUrl };
}

// Decode a JavaScript string literal without evaluating any source-site JavaScript.
function decodeLiteral(text: string) {
  let decoded = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "\\") { decoded += text[i]; continue; }
    const escape = text[++i];
    if (escape === undefined) throw new Error("invalid-literal");
    const simple: Record<string, string> = { "\\": "\\", "'": "'", '"': '"', "/": "/", n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v" };
    if (escape in simple) decoded += simple[escape];
    else if (escape === "u" || escape === "x") {
      const length = escape === "u" ? 4 : 2;
      const code = text.slice(i + 1, i + 1 + length);
      if (!new RegExp(`^[a-fA-F0-9]{${length}}$`).test(code)) throw new Error("invalid-escape");
      decoded += String.fromCharCode(parseInt(code, 16));
      i += length;
    } else throw new Error("unsupported-escape");
  }
  return decoded;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid-config");
  return value as Record<string, unknown>;
}

export function parseNewsPosters(script: string): string[] {
  for (const match of script.matchAll(/JSON\.parse\(\s*'((?:\\[\s\S]|[^'\\])*)'\s*\)/g)) {
    let parsed: Record<string, unknown>;
    try { parsed = object(JSON.parse(decodeLiteral(match[1]))); } catch { continue; }
    if (parsed.activity_id !== 12854 || parsed.game_code !== "hyrz") continue;
    const config = object(parsed.config);
    const configs = object(config.configs);
    const pages = config.pages;
    if (!Array.isArray(pages) || pages.length < 1 || pages.length > 8) throw new Error("unsupported-pages");
    const posters = pages.map((value) => {
      const id = object(value).id;
      if (typeof id !== "string" || !Object.hasOwn(configs, id)) throw new Error("missing-page");
      const page = object(configs[id]);
      if (!Array.isArray(page.componentConfig) || page.componentConfig.length !== 0) throw new Error("unsupported-layout");
      const image = object(object(page.canvasConfig).backgroundImage).src;
      if (typeof image !== "string" || !isAllowedSourceUrl(image) || !IMAGE_PATH.test(new URL(image).pathname)) throw new Error("invalid-image");
      return image;
    });
    return [...new Set(posters)];
  }
  throw new Error("missing-activity-config");
}
