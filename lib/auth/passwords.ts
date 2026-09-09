import bcrypt from "bcryptjs";

// 12 rounds is bcrypt's own commonly-recommended floor for a server that isn't otherwise
// rate-limiting login attempts — cheap enough to not noticeably slow a real login (well under
// 200ms on typical server hardware) while still making an offline brute-force attempt on a
// leaked hash expensive.
const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
