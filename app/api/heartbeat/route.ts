import { NextResponse } from "next/server";
import { touchCurrentSession } from "@/lib/auth";

export async function POST() {
  const ok = await touchCurrentSession();
  return NextResponse.json({ ok }, { status: ok ? 200 : 401 });
}

