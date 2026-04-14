import { createCookieSessionStorage, redirect, type AppLoadContext } from '@remix-run/cloudflare';
import type { AuthenticatedUser } from './request-user.server';
import { authenticateUser } from './user-store.server';
import { getAuthEnv } from './env.server';

const USER_SESSION_KEY = 'authUser';
const USER_NAMESPACE_COOKIE = 'bolt_user_key';

function parseBooleanFlag(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  return value === '1' || value.toLowerCase() === 'true';
}

export function isAuthRequired(context: AppLoadContext): boolean {
  const env = getAuthEnv(context);
  return parseBooleanFlag(env.BOLT_AUTH_REQUIRED, false);
}

function getSessionSecret(context: AppLoadContext): string {
  const env = getAuthEnv(context);

  if (env.BOLT_SESSION_SECRET) {
    return env.BOLT_SESSION_SECRET;
  }

  if (env.AUTH_SECRET) {
    return env.AUTH_SECRET;
  }

  return 'bolt-dev-insecure-session-secret-change-me';
}

function getSessionStorage(context: AppLoadContext) {
  const env = getAuthEnv(context);
  const secure = env.NODE_ENV === 'production';

  return createCookieSessionStorage({
    cookie: {
      name: '__bolt_session',
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure,
      secrets: [getSessionSecret(context)],
      maxAge: 60 * 60 * 24 * 7,
    },
  });
}

function getNamespaceCookieValue(userId: string): string {
  return encodeURIComponent(userId.trim().toLowerCase());
}

function buildNamespaceCookie(context: AppLoadContext, userId: string): string {
  const env = getAuthEnv(context);
  const secure = env.NODE_ENV === 'production';
  const secureFlag = secure ? '; Secure' : '';
  const value = getNamespaceCookieValue(userId);

  return `${USER_NAMESPACE_COOKIE}=${value}; Path=/; Max-Age=${60 * 60 * 24 * 7}; SameSite=Lax${secureFlag}`;
}

function buildClearNamespaceCookie(context: AppLoadContext): string {
  const env = getAuthEnv(context);
  const secure = env.NODE_ENV === 'production';
  const secureFlag = secure ? '; Secure' : '';

  return `${USER_NAMESPACE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secureFlag}`;
}

export async function getSessionUser(request: Request, context: AppLoadContext): Promise<AuthenticatedUser | null> {
  const cookie = request.headers.get('Cookie');
  const storage = getSessionStorage(context);
  const session = await storage.getSession(cookie);
  const user = session.get(USER_SESSION_KEY) as AuthenticatedUser | undefined;

  if (!user?.id) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    role: user.role === 'admin' ? 'admin' : 'user',
  };
}

export async function createUserSession(
  request: Request,
  context: AppLoadContext,
  user: AuthenticatedUser,
  redirectTo = '/',
) {
  const cookie = request.headers.get('Cookie');
  const storage = getSessionStorage(context);
  const session = await storage.getSession(cookie);

  session.set(USER_SESSION_KEY, user);

  const headers = new Headers();
  headers.append('Set-Cookie', await storage.commitSession(session));
  headers.append('Set-Cookie', buildNamespaceCookie(context, user.id));

  return redirect(redirectTo, { headers });
}

export async function destroyUserSession(request: Request, context: AppLoadContext, redirectTo = '/login') {
  const cookie = request.headers.get('Cookie');
  const storage = getSessionStorage(context);
  const session = await storage.getSession(cookie);

  const headers = new Headers();
  headers.append('Set-Cookie', await storage.destroySession(session));
  headers.append('Set-Cookie', buildClearNamespaceCookie(context));

  return redirect(redirectTo, { headers });
}

export function getConfiguredAdmin(context: AppLoadContext): { email: string; password: string } | null {
  const env = getAuthEnv(context);
  const email = env.BOLT_ADMIN_EMAIL?.trim();
  const password = env.BOLT_ADMIN_PASSWORD;

  if (!email || !password) {
    return null;
  }

  return { email, password };
}

export async function validateCredentials(
  context: AppLoadContext,
  email: string,
  password: string,
): Promise<AuthenticatedUser | null> {
  const existingUser = await authenticateUser(context, email, password);

  if (existingUser) {
    return {
      id: existingUser.email,
      email: existingUser.email,
      role: 'user',
    };
  }

  const configuredAdmin = getConfiguredAdmin(context);

  if (!configuredAdmin) {
    return null;
  }

  if (email.trim().toLowerCase() !== configuredAdmin.email.toLowerCase()) {
    return null;
  }

  if (password !== configuredAdmin.password) {
    return null;
  }

  return {
    id: configuredAdmin.email.toLowerCase(),
    email: configuredAdmin.email,
    role: 'admin',
  };
}
