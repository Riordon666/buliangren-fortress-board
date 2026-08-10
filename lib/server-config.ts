export function getSeedInitialPassword() {
  const configured = process.env.INITIAL_PASSWORD?.trim();
  if (configured && configured.length >= 8) return configured;
  throw new Error("数据库为空，必须设置至少8位的 INITIAL_PASSWORD 后才能初始化。");
}
