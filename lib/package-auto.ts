import { getDb } from "@/lib/db";
import { autoConfirmDuePackageDays } from "@/lib/package-delivery";

type PackageAutoGlobals = typeof globalThis & {
  __fortressPackageAutoTimer?: NodeJS.Timeout;
};

const packageAutoGlobals = globalThis as PackageAutoGlobals;

export function runPackageAutoConfirmation(now = new Date()) {
  try {
    return autoConfirmDuePackageDays(getDb(), now);
  } catch (error) {
    console.error("Automatic package confirmation failed", error);
    return 0;
  }
}

export function startPackageAutoConfirmScheduler() {
  if (packageAutoGlobals.__fortressPackageAutoTimer) return;
  runPackageAutoConfirmation();
  packageAutoGlobals.__fortressPackageAutoTimer = setInterval(() => {
    runPackageAutoConfirmation();
  }, 30_000);
  packageAutoGlobals.__fortressPackageAutoTimer.unref();
}
