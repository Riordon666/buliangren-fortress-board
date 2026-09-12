import { getDb } from "@/lib/db";
import { getNewsService } from "@/lib/news/runtime";
import { getMailConfig } from "@/lib/news-mail/config";
import { NewsMailService } from "@/lib/news-mail/service";
import { MailRequestError } from "@/lib/news-mail/store";
type MailGlobals = typeof globalThis & { __fortressNewsMail?: NewsMailService; __fortressNewsMailTimer?: NodeJS.Timeout; __fortressNewsMailStarted?: boolean };
const runtime = globalThis as MailGlobals;
export function getNewsMailService() {
  const config = getMailConfig();
  if (!config) throw new MailRequestError(503, "邮件提醒暂未开放，请稍后再来。");
  return runtime.__fortressNewsMail ||= new NewsMailService(getDb(), config, getNewsService());
}
export async function startNewsMailScheduler() {
  if (runtime.__fortressNewsMailStarted || !getMailConfig()) return;
  runtime.__fortressNewsMailStarted = true;
  // Initialize the old-edition baseline before allowing the Tencent scheduler to run.
  try { await getNewsMailService().initialize(); }
  catch { console.warn("[news-mail] baseline storage unavailable; will retry locally."); }
  const tick = async () => {
    try { await getNewsMailService().tick(); }
    catch { console.warn("[news-mail] queue worker unavailable; will retry locally."); }
    finally {
      runtime.__fortressNewsMailTimer = setTimeout(() => { void tick(); }, 30_000);
      runtime.__fortressNewsMailTimer.unref();
    }
  };
  void tick();
}
