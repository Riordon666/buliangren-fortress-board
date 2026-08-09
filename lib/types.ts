export type Role = "admin" | "member";

export type SessionUser = {
  id: number;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  role: Role;
  note: string | null;
  mustChangePassword: boolean;
  lastSeenAt: string | null;
};

export type ScoreWeek = {
  id: number;
  title: string;
  eventDate: string;
  status: "draft" | "published" | "locked";
};

export type ScoreRow = {
  userId: number;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  note: string | null;
  score: number;
  packageRound: number | null;
  rank: number;
};

export type MemberRow = SessionUser & {
  isActive: boolean;
  createdAt: string;
};

export type TrendPoint = {
  weekId: number;
  weekTitle: string;
  eventDate: string;
  score: number;
  rank: number;
};

