import Link from "next/link";
import { ShinobiMark } from "@/components/shinobi-mark";
import { ArrowLeft, Database, Leaf, LockKeyhole, ScrollText } from "lucide-react";
import { getSessionUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "组员登录" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getSessionUser();
  const authenticatedDestination = user
    ? user.accountType !== "guest" && user.mustChangePassword
      ? "/profile?required=1"
      : "/home"
    : undefined;

  return (
    <main className="login-page">
      <nav className="login-public-links" aria-label="公开页面入口">
        <Link href="/" className="login-public-link"><ArrowLeft size={18} />返回公开首页</Link>
        <Link href="/accessories" className="login-public-link"><Database size={18} />饰品资料</Link>
      </nav>
      <div className="login-ambient" />
      <section className="login-story">
        <div className="story-kicker"><Leaf size={16} /> 3767区 · 2组 · 不良人内部</div>
        <h1><span>让每一分战绩</span><em>都有迹可循</em></h1>
        <p>记录每周要塞争夺，凝聚每一位组员的贡献。这里是不良人的内部战绩卷轴，公开游戏资料无需登录即可查看。</p>
        <div className="story-points">
          <span><ScrollText size={17} /> 历史战绩完整留存</span>
          <span><LockKeyhole size={17} /> 组员数据安全守护</span>
        </div>
      </section>

      <section className="login-card-wrap">
        <div className="login-card">
          <div className="card-seal"><ShinobiMark size={34} /></div>
          <div className="login-heading">
            <span>忍者身份核验</span>
            <h2>欢迎归队</h2>
            <p>使用组织账号或共享游客账号和密码登录</p>
          </div>
          <LoginForm authenticatedDestination={authenticatedDestination} />
        </div>
        <p className="login-footer">不良人要塞战报 · 授权账号内部入口</p>
      </section>
    </main>
  );
}
