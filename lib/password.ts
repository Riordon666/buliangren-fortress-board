import { hash, verify } from "@node-rs/argon2";
import { ARGON_OPTIONS } from "@/lib/constants";

export function hashPassword(password: string) {
  return hash(password, { ...ARGON_OPTIONS });
}

export function verifyPassword(passwordHash: string, password: string) {
  return verify(passwordHash, password);
}
