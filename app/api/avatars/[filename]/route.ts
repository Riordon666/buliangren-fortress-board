import fs from "node:fs/promises";
import path from "node:path";
import { uploadDirectory } from "@/lib/storage-paths";

const avatarFilename = /^\d+-[a-f0-9]{16}\.webp$/;

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  if (!avatarFilename.test(filename)) {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" }
    });
  }

  try {
    const file = await fs.readFile(path.join(uploadDirectory(), filename));
    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("Failed to read avatar", error);
    }
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" }
    });
  }
}
