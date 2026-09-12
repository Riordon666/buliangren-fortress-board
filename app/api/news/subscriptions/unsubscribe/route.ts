import { subscriptionRequest } from "@/lib/news-mail/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return subscriptionRequest(request, "unsubscribe"); }
