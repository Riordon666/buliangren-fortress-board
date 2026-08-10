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
  packageDeductions: number;
  packageDeductionTotal: number;
  packageDeductionPending: number;
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

export type PackageDayStatus = {
  weekId: number;
  dayIndex: number;
  markedBy: number | null;
  markedByName: string | null;
  sentAt: string;
};

export type ScoreChangeEvent = {
  id: number;
  weekId: number;
  weekTitle: string;
  previousScore: number;
  newScore: number;
  delta: number;
  source: "manual" | "import";
  actorName: string | null;
  createdAt: string;
};
