import type { MailConfig } from "@/lib/news-mail/config";
import { signSubscriptionToken } from "@/lib/news-mail/config";
import type { Subscriber } from "@/lib/news-mail/store";
import type { MailPayload, InlineAttachment } from "@/lib/news-mail/provider";
import type { NewsEdition } from "@/lib/news/types";
const escape = (value: string) => value.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
const frame = (title: string, content: string) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body style="margin:0;background:#f4efdf;font-family:Arial,'Microsoft YaHei',sans-serif;color:#203c30"><div style="max-width:700px;margin:24px auto;padding:24px;background:#fffdf5;border-top:5px solid #c16030"><p style="font-size:14px;letter-spacing:2px;color:#9b542d">木叶资料卷轴 · KONOHA WEEKLY</p><h1 style="font-size:26px;line-height:1.5">${title}</h1>${content}</div></body></html>`;
function link(config: MailConfig, subscriber: Subscriber, purpose: "confirm" | "unsubscribe") {
  const token = signSubscriptionToken(config, { id: subscriber.id, generation: subscriber.generation, purpose });
  return `${config.publicUrl}/news/subscription/${purpose}?token=${encodeURIComponent(token)}`;
}
export function confirmationMail(config: MailConfig, subscriber: Subscriber): MailPayload {
  const confirm = link(config, subscriber, "confirm");
  const stop = link(config, subscriber, "unsubscribe");
  return { to: subscriber.email, subject: "确认订阅木叶快报更新提醒", text: `你申请了木叶快报更新提醒。请在24小时内打开以下链接并点击确认：\n${confirm}\n\n确认后，我们仅在收录新的快报内容时向你发送通知与图片。若不是你本人申请，无需操作，也可以取消：\n${stop}`,
    html: frame("确认订阅木叶快报", `<p style="font-size:17px;line-height:1.8">确认后，本站收录新快报时会向这个邮箱发送提醒和活动图片。</p><p><a href="${escape(confirm)}" style="display:inline-block;padding:14px 22px;background:#bf5f2f;color:white;text-decoration:none;border-radius:6px">确认订阅</a></p><p style="line-height:1.8">链接24小时内有效。若不是你本人申请，无需操作，或<a href="${escape(stop)}">取消订阅申请</a>。</p>`) };
}
export function editionMail(config: MailConfig, subscriber: Subscriber, edition: NewsEdition, attachments: InlineAttachment[], preview: boolean): MailPayload {
  const url = `${config.publicUrl}/news`;
  const stop = link(config, subscriber, "unsubscribe");
  const time = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }).format(new Date(edition.syncedAt));
  const note = preview ? "邮件展示快报预览，完整清晰长图请打开网站查看。" : "本期活动图片如下，完整长图也可在网站查看。";
  return { to: subscriber.email, subject: "木叶快报已经更新", text: `木叶快报已经更新！\n收录时间：${time}（北京时间）\n${note}\n查看本期快报：${url}\n\n内容来自腾讯木叶快报，活动安排以游戏内正式公告为准。\n你因确认订阅而收到此邮件。退订：${stop}`,
    html: frame("木叶快报已经更新", `<p style="font-size:17px;line-height:1.8">本周活动情报已收录，快来看看吧。<br>收录时间：${escape(time)}（北京时间）</p><p><a href="${escape(url)}" style="display:inline-block;padding:14px 22px;background:#bf5f2f;color:white;text-decoration:none;border-radius:6px">打开完整快报</a></p><p style="line-height:1.8">${note}</p>${attachments.map((attachment, index) => `<img src="cid:${attachment.contentId}" alt="木叶快报活动图片，第${index + 1}部分" style="display:block;width:100%;max-width:100%;height:auto;margin:0;border:0">`).join("")}<p style="font-size:14px;line-height:1.8;color:#6f776c">内容来自腾讯木叶快报，活动安排以游戏内正式公告为准。<br>你因确认订阅而收到此邮件。<a href="${escape(stop)}">取消后续邮件提醒</a></p>`), attachments };
}
