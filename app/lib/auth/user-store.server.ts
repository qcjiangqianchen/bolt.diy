import type { AppLoadContext } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { generateSixDigitCode, hashPassword, verifyPassword } from './password.server';

const logger = createScopedLogger('auth.user-store');

export interface AuthUserRecord {
  email: string;
  passwordHash: string;
  salt: string;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
  verificationCode?: string;
  verificationExpiresAt?: string;
  resetCode?: string;
  resetExpiresAt?: string;
}

type UserMap = Record<string, AuthUserRecord>;

const inMemoryUsers = new Map<string, AuthUserRecord>();

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isFuture(dateValue?: string): boolean {
  if (!dateValue) {
    return false;
  }

  return Date.parse(dateValue) > Date.now();
}

function getUsersFilePath(context: AppLoadContext): string {
  const env = context.cloudflare?.env as unknown as Record<string, string | undefined> | undefined;
  return env?.BOLT_AUTH_USER_STORE_FILE || '.bolt-auth-users.json';
}

async function readUsersFromDisk(context: AppLoadContext): Promise<UserMap | null> {
  try {
    const fs = await import('node:fs/promises');
    const filePath = getUsersFilePath(context);
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as UserMap;

    return parsed;
  } catch {
    return null;
  }
}

async function writeUsersToDisk(context: AppLoadContext, users: UserMap): Promise<void> {
  try {
    const fs = await import('node:fs/promises');
    const filePath = getUsersFilePath(context);
    await fs.writeFile(filePath, JSON.stringify(users, null, 2), 'utf8');
  } catch (error) {
    logger.warn('Falling back to in-memory auth store; disk persistence unavailable', error);
  }
}

async function loadUsers(context: AppLoadContext): Promise<UserMap> {
  const fromDisk = await readUsersFromDisk(context);

  if (fromDisk) {
    return fromDisk;
  }

  const users: UserMap = {};

  for (const [email, user] of inMemoryUsers.entries()) {
    users[email] = user;
  }

  return users;
}

async function saveUsers(context: AppLoadContext, users: UserMap): Promise<void> {
  inMemoryUsers.clear();

  for (const [email, user] of Object.entries(users)) {
    inMemoryUsers.set(email, user);
  }

  await writeUsersToDisk(context, users);
}

export async function getUserByEmail(context: AppLoadContext, email: string): Promise<AuthUserRecord | null> {
  const users = await loadUsers(context);
  return users[normalizeEmail(email)] || null;
}

export async function authenticateUser(
  context: AppLoadContext,
  email: string,
  password: string,
): Promise<AuthUserRecord | null> {
  const user = await getUserByEmail(context, email);

  if (!user || !user.verified) {
    return null;
  }

  const isValid = await verifyPassword(password, user.passwordHash, user.salt);

  return isValid ? user : null;
}

export async function requestSignupCode(
  context: AppLoadContext,
  email: string,
  password: string,
): Promise<{ code: string; existingVerifiedUser: boolean }> {
  const users = await loadUsers(context);
  const normalizedEmail = normalizeEmail(email);
  const existing = users[normalizedEmail];

  if (existing?.verified) {
    return { code: '', existingVerifiedUser: true };
  }

  const { hash, salt } = await hashPassword(password);
  const code = generateSixDigitCode();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  users[normalizedEmail] = {
    email: normalizedEmail,
    passwordHash: hash,
    salt,
    verified: false,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    verificationCode: code,
    verificationExpiresAt: expiresAt,
    resetCode: undefined,
    resetExpiresAt: undefined,
  };

  await saveUsers(context, users);

  return { code, existingVerifiedUser: false };
}

export async function verifySignupCode(context: AppLoadContext, email: string, code: string): Promise<boolean> {
  const users = await loadUsers(context);
  const normalizedEmail = normalizeEmail(email);
  const user = users[normalizedEmail];

  if (!user || !user.verificationCode || !isFuture(user.verificationExpiresAt)) {
    return false;
  }

  if (user.verificationCode !== code.trim()) {
    return false;
  }

  users[normalizedEmail] = {
    ...user,
    verified: true,
    updatedAt: new Date().toISOString(),
    verificationCode: undefined,
    verificationExpiresAt: undefined,
  };

  await saveUsers(context, users);

  return true;
}

export async function requestPasswordResetCode(
  context: AppLoadContext,
  email: string,
): Promise<{ code: string | null; userExists: boolean }> {
  const users = await loadUsers(context);
  const normalizedEmail = normalizeEmail(email);
  const user = users[normalizedEmail];

  if (!user || !user.verified) {
    return { code: null, userExists: false };
  }

  const code = generateSixDigitCode();
  users[normalizedEmail] = {
    ...user,
    resetCode: code,
    resetExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await saveUsers(context, users);

  return { code, userExists: true };
}

export async function resetPasswordWithCode(
  context: AppLoadContext,
  email: string,
  code: string,
  newPassword: string,
): Promise<boolean> {
  const users = await loadUsers(context);
  const normalizedEmail = normalizeEmail(email);
  const user = users[normalizedEmail];

  if (!user || !user.resetCode || !isFuture(user.resetExpiresAt)) {
    return false;
  }

  if (user.resetCode !== code.trim()) {
    return false;
  }

  const { hash, salt } = await hashPassword(newPassword);

  users[normalizedEmail] = {
    ...user,
    passwordHash: hash,
    salt,
    updatedAt: new Date().toISOString(),
    resetCode: undefined,
    resetExpiresAt: undefined,
  };

  await saveUsers(context, users);

  return true;
}
