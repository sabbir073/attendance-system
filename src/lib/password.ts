import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id parameters — OWASP Password Storage Cheat Sheet (second recommended
 * configuration): 19 MiB memory, 2 iterations, 1 degree of parallelism.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(
  digest: string,
  plain: string,
): Promise<boolean> {
  try {
    return await verify(digest, plain, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

/**
 * Constant-ish-time dummy verification. Called when an account does not exist
 * so that "unknown email" and "wrong password" take a comparable amount of
 * time, removing a user-enumeration side channel.
 */
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$Yx7l9y1hZq0G3xg1n2mQfQ3g3fJ8t1YyQ4kFq8xW9pE";

export async function fakeVerify(plain: string): Promise<void> {
  try {
    await verify(DUMMY_HASH, plain, ARGON2_OPTIONS);
  } catch {
    /* intentionally ignored */
  }
}

export interface PasswordCheck {
  ok: boolean;
  errors: string[];
  score: number; // 0..4
}

const COMMON = new Set([
  "password", "12345678", "qwertyuiop", "letmein123", "admin@123",
  "welcome123", "desco@123", "password123", "iloveyou1", "abcd1234",
]);

export function checkPasswordStrength(
  password: string,
  minLength = 10,
): PasswordCheck {
  const errors: string[] = [];

  if (password.length < minLength) {
    errors.push(`Must be at least ${minLength} characters.`);
  }
  if (!/[a-z]/.test(password)) errors.push("Must contain a lowercase letter.");
  if (!/[A-Z]/.test(password)) errors.push("Must contain an uppercase letter.");
  if (!/[0-9]/.test(password)) errors.push("Must contain a digit.");
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push("Must contain a special character.");
  }
  if (COMMON.has(password.toLowerCase())) {
    errors.push("This password is too common.");
  }
  if (/(.)\1{3,}/.test(password)) {
    errors.push("Avoid repeating the same character four or more times.");
  }

  let score = 0;
  if (password.length >= minLength) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  return { ok: errors.length === 0, errors, score };
}
