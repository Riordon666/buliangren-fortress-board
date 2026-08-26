import fs from "node:fs/promises";
import path from "node:path";
import { getSessionUser } from "@/lib/auth";
import { uploadDirectory } from "@/lib/storage-paths";

const avatarFilename = /^\d+-[a-f0-9]{16}\.webp$/;

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return new Response(null, {
      status: 401,
      headers: { "Cache-Control": "no-store" }
    });
  }

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
        "Cache-Control": "private, max-age=86400, immutable",
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
