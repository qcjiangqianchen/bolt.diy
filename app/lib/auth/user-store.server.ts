import type { AppLoadContext } from '@remix-run/cloudflare';
import { isPostgresConfigured, queryPostgres, withPostgresTransaction } from '~/lib/.server/db/postgres';
import { createScopedLogger } from '~/utils/logger';
import { generateSixDigitCode, hashPassword, verifyPassword } from './password.server';
import { getAuthEnv } from './env.server';

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

interface DbUserRecordRow {
  email: string;
  password_hash: string;
  password_salt: string;
  verified_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface DbUserIdentityRow {
  id: string;
  email: string;
  verified_at: Date | string | null;
}

interface DbChallengeRow {
  id: string;
  user_id: string | null;
  email: string;
  code_hash: string;
  expires_at: Date | string;
}

const inMemoryUsers = new Map<string, AuthUserRecord>();

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isFuture(dateValue?: string | Date): boolean {
  if (!dateValue) {
    return false;
  }

  return new Date(dateValue).getTime() > Date.now();
}

async function createCodeHash(code: string): Promise<string> {
  const { hash, salt } = await hashPassword(code);
  return `${salt}:${hash}`;
}

async function verifyCodeHash(code: string, codeHash: string): Promise<boolean> {
  const [salt, hash] = codeHash.split(':');

  if (!salt || !hash) {
    return false;
  }

  return verifyPassword(code, hash, salt);
}

function mapDbUserRecord(row: DbUserRecordRow): AuthUserRecord {
  return {
    email: row.email,
    passwordHash: row.password_hash,
    salt: row.password_salt,
    verified: Boolean(row.verified_at),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function getUsersFilePath(context: AppLoadContext): string {
  const env = getAuthEnv(context);
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
    const path = await import('node:path');

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(users, null, 2), 'utf8');
  } catch (error) {
    logger.warn('Falling back to in-memory auth store; disk persistence unavailable', error);
  }
}

async function loadUsersFromFile(context: AppLoadContext): Promise<UserMap> {
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

async function saveUsersToFile(context: AppLoadContext, users: UserMap): Promise<void> {
  inMemoryUsers.clear();

  for (const [email, user] of Object.entries(users)) {
    inMemoryUsers.set(email, user);
  }

  await writeUsersToDisk(context, users);
}

async function getUserByEmailFromFile(context: AppLoadContext, email: string): Promise<AuthUserRecord | null> {
  const users = await loadUsersFromFile(context);
  return users[normalizeEmail(email)] || null;
}

async function authenticateUserFromFile(
  context: AppLoadContext,
  email: string,
  password: string,
): Promise<AuthUserRecord | null> {
  const user = await getUserByEmailFromFile(context, email);

  if (!user || !user.verified) {
    return null;
  }

  const isValid = await verifyPassword(password, user.passwordHash, user.salt);

  return isValid ? user : null;
}

async function requestSignupCodeFromFile(
  context: AppLoadContext,
  email: string,
  password: string,
): Promise<{ code: string; existingVerifiedUser: boolean }> {
  const users = await loadUsersFromFile(context);
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

  await saveUsersToFile(context, users);

  return { code, existingVerifiedUser: false };
}

async function verifySignupCodeFromFile(context: AppLoadContext, email: string, code: string): Promise<boolean> {
  const users = await loadUsersFromFile(context);
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

  await saveUsersToFile(context, users);

  return true;
}

async function requestPasswordResetCodeFromFile(
  context: AppLoadContext,
  email: string,
): Promise<{ code: string | null; userExists: boolean }> {
  const users = await loadUsersFromFile(context);
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

  await saveUsersToFile(context, users);

  return { code, userExists: true };
}

async function resetPasswordWithCodeFromFile(
  context: AppLoadContext,
  email: string,
  code: string,
  newPassword: string,
): Promise<boolean> {
  const users = await loadUsersFromFile(context);
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

  await saveUsersToFile(context, users);

  return true;
}

async function getUserByEmailFromPostgres(context: AppLoadContext, email: string): Promise<AuthUserRecord | null> {
  const result = await queryPostgres<DbUserRecordRow>(
    context,
    `
      select
        u.email,
        c.password_hash,
        c.password_salt,
        u.verified_at,
        u.created_at,
        u.updated_at
      from app_users u
      join user_password_credentials c on c.user_id = u.id
      where u.email = $1
      limit 1
    `,
    [normalizeEmail(email)],
  );

  const row = result.rows[0];

  return row ? mapDbUserRecord(row) : null;
}

async function authenticateUserFromPostgres(
  context: AppLoadContext,
  email: string,
  password: string,
): Promise<AuthUserRecord | null> {
  const user = await getUserByEmailFromPostgres(context, email);

  if (!user || !user.verified) {
    return null;
  }

  const isValid = await verifyPassword(password, user.passwordHash, user.salt);

  return isValid ? user : null;
}

async function migrateFileUserToPostgres(context: AppLoadContext, user: AuthUserRecord): Promise<void> {
  const verifiedAt = user.verified ? user.updatedAt || new Date().toISOString() : null;

  await withPostgresTransaction(context, async (client) => {
    const userResult = await client.query<DbUserIdentityRow>(
      `
        insert into app_users (email, verified_at, created_at, updated_at)
        values ($1, $2, $3, $4)
        on conflict (email) do update
          set verified_at = coalesce(app_users.verified_at, excluded.verified_at),
              updated_at = now()
        returning id, email, verified_at
      `,
      [normalizeEmail(user.email), verifiedAt, user.createdAt, user.updatedAt],
    );
    const dbUser = userResult.rows[0];

    await client.query(
      `
        insert into user_password_credentials (user_id, password_hash, password_salt, created_at, updated_at)
        values ($1, $2, $3, $4, $5)
        on conflict (user_id) do update
          set password_hash = excluded.password_hash,
              password_salt = excluded.password_salt,
              updated_at = now()
      `,
      [dbUser.id, user.passwordHash, user.salt, user.createdAt, user.updatedAt],
    );
  });
}

async function requestSignupCodeFromPostgres(
  context: AppLoadContext,
  email: string,
  password: string,
): Promise<{ code: string; existingVerifiedUser: boolean }> {
  const normalizedEmail = normalizeEmail(email);
  const { hash, salt } = await hashPassword(password);
  const code = generateSixDigitCode();
  const codeHash = await createCodeHash(code);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  const existingUser = await queryPostgres<DbUserIdentityRow>(
    context,
    'select id, email, verified_at from app_users where email = $1 limit 1',
    [normalizedEmail],
  );

  if (existingUser.rows[0]?.verified_at) {
    return { code: '', existingVerifiedUser: true };
  }

  await withPostgresTransaction(context, async (client) => {
    const userResult = await client.query<DbUserIdentityRow>(
      `
        insert into app_users (email)
        values ($1)
        on conflict (email) do update
          set updated_at = now(),
              disabled_at = null
        returning id, email, verified_at
      `,
      [normalizedEmail],
    );
    const user = userResult.rows[0];

    await client.query(
      `
        insert into user_password_credentials (user_id, password_hash, password_salt)
        values ($1, $2, $3)
        on conflict (user_id) do update
          set password_hash = excluded.password_hash,
              password_salt = excluded.password_salt,
              updated_at = now()
      `,
      [user.id, hash, salt],
    );

    await client.query(
      `
        update auth_challenges
        set consumed_at = now()
        where email = $1
          and type = 'signup_verification'
          and consumed_at is null
      `,
      [normalizedEmail],
    );

    await client.query(
      `
        insert into auth_challenges (user_id, email, type, code_hash, expires_at)
        values ($1, $2, 'signup_verification', $3, $4)
      `,
      [user.id, normalizedEmail, codeHash, expiresAt],
    );
  });

  return { code, existingVerifiedUser: false };
}

async function getActiveChallenge(
  context: AppLoadContext,
  email: string,
  type: 'signup_verification' | 'password_reset',
): Promise<DbChallengeRow | undefined> {
  const result = await queryPostgres<DbChallengeRow>(
    context,
    `
      select id, user_id, email, code_hash, expires_at
      from auth_challenges
      where email = $1
        and type = $2
        and consumed_at is null
      order by created_at desc
      limit 1
    `,
    [normalizeEmail(email), type],
  );

  return result.rows[0];
}

async function verifySignupCodeFromPostgres(context: AppLoadContext, email: string, code: string): Promise<boolean> {
  const normalizedEmail = normalizeEmail(email);
  const challenge = await getActiveChallenge(context, normalizedEmail, 'signup_verification');

  if (!challenge || !isFuture(challenge.expires_at)) {
    return false;
  }

  const isValid = await verifyCodeHash(code.trim(), challenge.code_hash);

  if (!isValid) {
    return false;
  }

  await withPostgresTransaction(context, async (client) => {
    await client.query(
      `
        update app_users
        set verified_at = coalesce(verified_at, now()),
            updated_at = now()
        where email = $1
      `,
      [normalizedEmail],
    );

    await client.query('update auth_challenges set consumed_at = now() where id = $1', [challenge.id]);
  });

  return true;
}

async function requestPasswordResetCodeFromPostgres(
  context: AppLoadContext,
  email: string,
): Promise<{ code: string | null; userExists: boolean }> {
  const normalizedEmail = normalizeEmail(email);
  const userResult = await queryPostgres<DbUserIdentityRow>(
    context,
    'select id, email, verified_at from app_users where email = $1 limit 1',
    [normalizedEmail],
  );
  const user = userResult.rows[0];

  if (!user?.verified_at) {
    return { code: null, userExists: false };
  }

  const code = generateSixDigitCode();
  const codeHash = await createCodeHash(code);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await withPostgresTransaction(context, async (client) => {
    await client.query(
      `
        update auth_challenges
        set consumed_at = now()
        where email = $1
          and type = 'password_reset'
          and consumed_at is null
      `,
      [normalizedEmail],
    );

    await client.query(
      `
        insert into auth_challenges (user_id, email, type, code_hash, expires_at)
        values ($1, $2, 'password_reset', $3, $4)
      `,
      [user.id, normalizedEmail, codeHash, expiresAt],
    );
  });

  return { code, userExists: true };
}

async function resetPasswordWithCodeFromPostgres(
  context: AppLoadContext,
  email: string,
  code: string,
  newPassword: string,
): Promise<boolean> {
  const normalizedEmail = normalizeEmail(email);
  const challenge = await getActiveChallenge(context, normalizedEmail, 'password_reset');

  if (!challenge || !challenge.user_id || !isFuture(challenge.expires_at)) {
    return false;
  }

  const isValid = await verifyCodeHash(code.trim(), challenge.code_hash);

  if (!isValid) {
    return false;
  }

  const { hash, salt } = await hashPassword(newPassword);

  await withPostgresTransaction(context, async (client) => {
    await client.query(
      `
        update user_password_credentials
        set password_hash = $2,
            password_salt = $3,
            updated_at = now()
        where user_id = $1
      `,
      [challenge.user_id, hash, salt],
    );

    await client.query('update auth_challenges set consumed_at = now() where id = $1', [challenge.id]);
  });

  return true;
}

export async function getUserByEmail(context: AppLoadContext, email: string): Promise<AuthUserRecord | null> {
  if (isPostgresConfigured(context)) {
    return getUserByEmailFromPostgres(context, email);
  }

  return getUserByEmailFromFile(context, email);
}

export async function authenticateUser(
  context: AppLoadContext,
  email: string,
  password: string,
): Promise<AuthUserRecord | null> {
  if (isPostgresConfigured(context)) {
    const postgresUser = await authenticateUserFromPostgres(context, email, password);

    if (postgresUser) {
      return postgresUser;
    }

    const existingPostgresUser = await getUserByEmailFromPostgres(context, email);

    if (existingPostgresUser) {
      return null;
    }

    const fileUser = await authenticateUserFromFile(context, email, password);

    if (fileUser) {
      await migrateFileUserToPostgres(context, fileUser);
    }

    return fileUser;
  }

  return authenticateUserFromFile(context, email, password);
}

export async function requestSignupCode(
  context: AppLoadContext,
  email: string,
  password: string,
): Promise<{ code: string; existingVerifiedUser: boolean }> {
  if (isPostgresConfigured(context)) {
    return requestSignupCodeFromPostgres(context, email, password);
  }

  return requestSignupCodeFromFile(context, email, password);
}

export async function verifySignupCode(context: AppLoadContext, email: string, code: string): Promise<boolean> {
  if (isPostgresConfigured(context)) {
    return verifySignupCodeFromPostgres(context, email, code);
  }

  return verifySignupCodeFromFile(context, email, code);
}

export async function requestPasswordResetCode(
  context: AppLoadContext,
  email: string,
): Promise<{ code: string | null; userExists: boolean }> {
  if (isPostgresConfigured(context)) {
    return requestPasswordResetCodeFromPostgres(context, email);
  }

  return requestPasswordResetCodeFromFile(context, email);
}

export async function resetPasswordWithCode(
  context: AppLoadContext,
  email: string,
  code: string,
  newPassword: string,
): Promise<boolean> {
  if (isPostgresConfigured(context)) {
    return resetPasswordWithCodeFromPostgres(context, email, code, newPassword);
  }

  return resetPasswordWithCodeFromFile(context, email, code, newPassword);
}
