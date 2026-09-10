export const NEWS_SOURCE_URL = "https://uv.qq.com/2MXYwaKD";
export const NEWS_REFRESH_MS = 30_000;
export const NEWS_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

export type NewsPage = {
  key: string;
  width: number;
  height: number;
};

export type NewsEdition = {
  version: string;
  title: string;
  sourceUrl: string;
  syncedAt: string;
  pages: NewsPage[];
};

export type NewsState = {
  status: "ready" | "stale" | "unavailable";
  edition: NewsEdition | null;
  checkedAt: string | null;
  refreshSeconds: number;
};
