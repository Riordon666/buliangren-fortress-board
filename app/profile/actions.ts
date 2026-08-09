"use server";

import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { destroyCurrentSession, requireUser, writeAuditLog } from "@/lib/auth";
import { FORCE_PASSWORD_COOKIE } from "@/lib/constants";
import { getDb } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";

export type FormState = { error?: string; success?: string };

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "请输入当前密码。"),
  newPassword: z.string().min(8, "新密码至少需要8位。\n").max(128),
  confirmPassword: z.string()
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "两次输入的新密码不一致。",
  path: ["confirmPassword"]
});

export async function changePasswordAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = passwordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword")
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message.trim() || "密码格式不正确。" };
  if (parsed.data.currentPassword === parsed.data.newPassword) {
    return { error: "新密码不能与当前密码相同。" };
  }

  const record = getDb().prepare("SELECT password_hash AS passwordHash FROM users WHERE id = ?")
    .get(user.id) as { passwordHash: string };
  if (!(await verifyPassword(record.passwordHash, parsed.data.currentPassword))) {
    return { error: "当前密码不正确。" };
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  getDb().prepare(`
    UPDATE users SET password_hash = ?, must_change_password = 0,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(passwordHash, user.id);
  writeAuditLog(user.id, "修改本人密码", user.id);

  const cookieStore = await cookies();
  cookieStore.delete(FORCE_PASSWORD_COOKIE);
  await destroyCurrentSession();
  return { success: "密码已修改。为确保安全，请使用新密码重新登录。" };
}

export async function updateAvatarAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) return { error: "请选择头像图片。" };
  if (file.size > 2 * 1024 * 1024) return { error: "头像不能超过 2MB。" };
  if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type)) {
    return { error: "仅支持 JPG、PNG 或 WebP 图片。" };
  }

  try {
    const filename = `${user.id}-${randomBytes(8).toString("hex")}.webp`;
    const uploadDir = path.join(process.cwd(), "public", "uploads");
    await fs.mkdir(uploadDir, { recursive: true });
    const buffer = Buffer.from(await file.arrayBuffer());
    await sharp(buffer)
      .rotate()
      .resize(512, 512, { fit: "cover", position: "attention" })
      .webp({ quality: 86 })
      .toFile(path.join(uploadDir, filename));

    const avatarUrl = `/uploads/${filename}`;
    getDb().prepare("UPDATE users SET avatar_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(avatarUrl, user.id);
    writeAuditLog(user.id, "更新头像", user.id);
    revalidatePath("/profile");
    revalidatePath("/scores");
    return { success: "头像已更新。" };
  } catch {
    return { error: "图片处理失败，请换一张图片重试。" };
  }
}
