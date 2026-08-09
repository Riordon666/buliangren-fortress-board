import { redirect } from "next/navigation";
import { Leaf, LockKeyhole, ScrollText } from "lucide-react";
import { getSessionUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "组员登录" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect(user.mustChangePassword ? "/profile?required=1" : "/scores");

  return (
    <main className="login-page">
      <div className="login-ambient" />
      <section className="login-story">
        <div className="story-kicker"><Leaf size={16} /> 3767区 · 2组 · 不良人</div>
        <h1><span>让每一分战绩</span><em>都有迹可循</em></h1>
        <p>记录每周要塞争夺，凝聚每一位组员的贡献。这里是不良人的战绩卷轴。</p>
        <div className="story-points">
          <span><ScrollText size={17} /> 历史战绩完整留存</span>
          <span><LockKeyhole size={17} /> 组员数据安全守护</span>
        </div>
      </section>

      <section className="login-card-wrap">
        <div className="login-card">
          <div className="card-seal"><span className="seal-leaf" /></div>
          <div className="login-heading">
            <span>忍者身份核验</span>
            <h2>欢迎归队</h2>
            <p>使用你的游戏昵称和密码登录</p>
          </div>
          <LoginForm />
        </div>
        <p className="login-footer">不良人要塞战报 · 内部组织管理系统</p>
      </section>
    </main>
  );
}
