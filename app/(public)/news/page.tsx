import { NewsReader } from "@/components/news-reader";
import { getNewsService } from "@/lib/news/runtime";

export const metadata = {
  title: "木叶快报",
  description: "火影忍者手游每周活动前瞻，自动核对腾讯源站发布内容，支持电脑与手机阅读。"
};
export const dynamic = "force-dynamic";

export default async function NewsPage() {
  return <NewsReader initial={await getNewsService().read()} />;
}
