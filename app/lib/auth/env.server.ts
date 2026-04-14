import type { AppLoadContext } from '@remix-run/cloudflare';

export type AuthEnv = Record<string, string | undefined>;

export function getAuthEnv(context: AppLoadContext): AuthEnv {
  const cloudflareEnv = (context.cloudflare?.env as unknown as AuthEnv | undefined) ?? {};
  const processEnv = typeof process !== 'undefined' ? (process.env as AuthEnv) : {};

  return {
    ...processEnv,
    ...cloudflareEnv,
  };
}
