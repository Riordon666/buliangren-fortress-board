import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "fortress-tests-"));
process.env.DATABASE_PATH = path.join(testDirectory, "naruto-fortress.test.db");
process.env.INITIAL_PASSWORD = "test-only-password";

afterAll(async () => {
  const { closeBotReadDbForTests } = await import("@/lib/bot-api/readonly-db");
  const { closeDbForTests } = await import("@/lib/db");
  closeBotReadDbForTests();
  closeDbForTests();
  fs.rmSync(testDirectory, { recursive: true, force: true });
});
