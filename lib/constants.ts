export const INITIAL_PASSWORD = "7891666";
export const ONLINE_WINDOW_MS = 90_000;
export const SESSION_TTL_DAYS = 7;
export const FORCE_PASSWORD_COOKIE = "force_password_change";

export const ARGON_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  outputLen: 32,
  parallelism: 1
} as const;
