import type { Metadata } from "next";
import { NewsSubscriptionAction } from "@/components/news-subscription-action";

export const metadata: Metadata = {
  title: "确认木叶快报订阅",
  robots: { index: false, follow: false },
  referrer: "no-referrer"
};
export const dynamic = "force-dynamic";

export default async function ConfirmNewsSubscriptionPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const params = await searchParams;
  const token = typeof params.token === "string" && params.token.length <= 2048 ? params.token.trim() : "";
  return <div className="news-subscription-action-page"><NewsSubscriptionAction action="confirm" token={token} /></div>;
}
