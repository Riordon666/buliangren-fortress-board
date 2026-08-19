export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.npm_lifecycle_event && process.env.npm_lifecycle_event !== "start") return;
  const { startPackageAutoConfirmScheduler } = await import("@/lib/package-auto");
  startPackageAutoConfirmScheduler();
}
