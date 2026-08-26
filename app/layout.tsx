import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "火影手游资料库 · 不良人要塞战报",
    template: "%s · 木叶资料卷轴"
  },
  description: "火影忍者手游公开饰品资料查询，以及3767区2组不良人内部要塞战报与组织管理。",
  keywords: ["火影忍者手游", "饰品", "抗魔", "不良人", "要塞分数"]
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
