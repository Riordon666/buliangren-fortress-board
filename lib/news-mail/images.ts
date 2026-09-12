import sharp from "sharp";
import type { NewsEdition } from "@/lib/news/types";
import type { InlineAttachment } from "@/lib/news-mail/provider";

export async function makeMailImages(edition: NewsEdition, readImage: (key: string) => Promise<Buffer | null>) {
  const attachments: InlineAttachment[] = [];
  let remaining = 4 * 1024 * 1024; // Leave room for HTML and MIME framing under the mail service 5 MiB limit.
  let preview = false;
  for (let pageIndex = 0; pageIndex < edition.pages.length; pageIndex++) {
    const page = edition.pages[pageIndex];
    const bytes = await readImage(page.key);
    if (!bytes) { preview = true; continue; }
    const width = Math.min(1000, page.width);
    const segmentHeight = Math.max(1, Math.floor(1800 * page.width / width));
    for (let top = 0; top < page.height; top += segmentHeight) {
      if (attachments.length >= 8) { preview = true; break; }
      try {
        const height = Math.min(segmentHeight, page.height - top);
        const pipeline = () => sharp(bytes, { limitInputPixels: 30_000_000 }).extract({ left: 0, top, width: page.width, height }).resize({ width, withoutEnlargement: true });
        let image = await pipeline().jpeg({ quality: 82, mozjpeg: true }).toBuffer();
        if (Math.ceil(image.length / 3) * 4 > remaining) image = await pipeline().jpeg({ quality: 65, mozjpeg: true }).toBuffer();
        const content = image.toString("base64");
        if (content.length > remaining) { preview = true; break; }
        const number = attachments.length + 1;
        attachments.push({ filename: `konoha-${number}.jpg`, contentId: `konoha-${number}`, contentType: "image/jpeg", content });
        remaining -= content.length;
      } catch { preview = true; break; }
    }
    if (attachments.length >= 8 && pageIndex < edition.pages.length - 1) preview = true;
  }
  return { attachments, preview };
}
