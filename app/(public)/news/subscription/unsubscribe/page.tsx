import type { Metadata } from "next";
import { NewsSubscriptionAction } from "@/components/news-subscription-action";

export const metadata: Metadata = {
  title: "退订木叶快报",
  robots: { index: false, follow: false },
  referrer: "no-referrer"
};
export const dynamic = "force-dynamic";

export default async function UnsubscribeNewsPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const params = await searchParams;
  const token = typeof params.token === "string" && params.token.length <= 2048 ? params.token.trim() : "";
  return <div className="news-subscription-action-page"><NewsSubscriptionAction action="unsubscribe" token={token} /></div>;
}
