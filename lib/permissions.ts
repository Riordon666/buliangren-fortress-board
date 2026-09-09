import type { SessionUser } from "@/lib/types";

export function canConfirmPackageDelivery(user: Pick<SessionUser, "role" | "accountType" | "note">) {
  // The leadership label is maintained by administrators, never by members themselves.
  return user.accountType === "member" && (user.role === "admin" || user.note?.trim() === "高层");
}
