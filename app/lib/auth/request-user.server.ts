import type { AppLoadContext } from '@remix-run/cloudflare';
import { getSessionUser } from './session.server';
import { getAuthEnv } from './env.server';

export interface AuthenticatedUser {
  id: string;
  email?: string;
  role: 'admin' | 'user';
}

interface AuthConfig {
  required: boolean;
  allowHeaderAuth: boolean;
}

function parseBooleanFlag(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  return value === '1' || value.toLowerCase() === 'true';
}

function getAuthConfig(context: AppLoadContext): AuthConfig {
  const env = getAuthEnv(context);

  return {
    required: parseBooleanFlag(env?.BOLT_AUTH_REQUIRED, false),
    allowHeaderAuth: parseBooleanFlag(env?.BOLT_AUTH_ALLOW_HEADER, true),
  };
}

function getHeaderUser(request: Request): AuthenticatedUser | null {
  const id = request.headers.get('x-bolt-user-id')?.trim();

  if (!id) {
    return null;
  }

  const email = request.headers.get('x-bolt-user-email')?.trim() || undefined;
  const roleHeader = request.headers.get('x-bolt-user-role')?.toLowerCase();
  const role = roleHeader === 'admin' ? 'admin' : 'user';

  return { id, email, role };
}

export async function getRequestUser(request: Request, context: AppLoadContext): Promise<AuthenticatedUser | null> {
  if (context.authUser) {
    return context.authUser;
  }

  const sessionUser = await getSessionUser(request, context);

  if (sessionUser) {
    return sessionUser;
  }

  const config = getAuthConfig(context);

  if (!config.allowHeaderAuth) {
    return null;
  }

  return getHeaderUser(request);
}

export async function requireAuthenticatedUser(
  request: Request,
  context: AppLoadContext,
): Promise<AuthenticatedUser | Response> {
  const user = await getRequestUser(request, context);
  const config = getAuthConfig(context);

  if (user) {
    return user;
  }

  if (!config.required) {
    return {
      id: 'anonymous',
      role: 'admin',
      email: undefined,
    };
  }

  return new Response(
    JSON.stringify({
      error: 'Unauthorized',
      message: 'Authentication is required for this endpoint.',
    }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
      },
    },
  );
}
