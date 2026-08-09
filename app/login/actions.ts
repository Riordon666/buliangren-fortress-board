"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticate } from "@/lib/auth";

export type LoginState = { error?: string };

const loginSchema = z.object({
  username: z.string().trim().min(1, "请输入账号。").max(40),
  password: z.string().min(1, "请输入密码。").max(128)
});

export async function loginAction(_state: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password")
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message || "请检查登录信息。" };
  }

  const result = await authenticate(parsed.data.username, parsed.data.password);
  if (!result.ok) return { error: result.reason };
  redirect(result.user.mustChangePassword ? "/profile?required=1" : "/scores");
}

