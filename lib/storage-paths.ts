import path from "node:path";

function resolveConfiguredPath(value: string | undefined, fallback: string) {
  return path.resolve(value?.trim() || fallback);
}

function requireDedicatedDirectory(directory: string, label: string) {
  const root = path.parse(directory).root;
  if (directory === root || directory === path.resolve(process.cwd())) {
    throw new Error(`${label} 必须指向专用子目录，不能使用磁盘根目录或项目根目录。`);
  }
  return directory;
}

export function databaseFilePath() {
  return resolveConfiguredPath(process.env.DATABASE_PATH, path.join(process.cwd(), "data", "naruto-fortress.db"));
}

export function uploadDirectory() {
  return requireDedicatedDirectory(
    resolveConfiguredPath(process.env.UPLOAD_DIR, path.join(process.cwd(), "public", "uploads")),
    "UPLOAD_DIR"
  );
}

export function backupDirectory() {
  return requireDedicatedDirectory(
    resolveConfiguredPath(process.env.BACKUP_DIR, path.join(process.cwd(), "data", "backups")),
    "BACKUP_DIR"
  );
}

export function reportCacheDirectory() {
  return requireDedicatedDirectory(
    resolveConfiguredPath(process.env.REPORT_CACHE_DIR, path.join(process.cwd(), "data", "report-cache")),
    "REPORT_CACHE_DIR"
  );
}
