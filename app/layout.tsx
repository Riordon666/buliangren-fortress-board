import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "不良人要塞战报",
    template: "%s · 不良人要塞战报"
  },
  description: "3767区2组不良人要塞分数统计与组织管理"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
