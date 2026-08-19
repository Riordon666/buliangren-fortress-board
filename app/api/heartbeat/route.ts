import { NextResponse } from "next/server";
import { touchCurrentSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function POST() {
  const ok = await touchCurrentSession();
  const packageRevision = ok ? getDb().prepare(`
    SELECT CAST(COUNT(*) AS TEXT) || ':' || CAST(COALESCE(MAX(id), 0) AS TEXT) AS revision
    FROM package_day_statuses
  `).get() as { revision: string } : null;
  return NextResponse.json({ ok, packageRevision: packageRevision?.revision }, { status: ok ? 200 : 401 });
}
