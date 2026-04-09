import { type PlatformProxy } from 'wrangler';
import type { AuthenticatedUser } from '~/lib/auth/request-user.server';

type Cloudflare = Omit<PlatformProxy<Env>, 'dispose'>;

declare module '@remix-run/cloudflare' {
  interface AppLoadContext {
    cloudflare: Cloudflare;
    authUser?: AuthenticatedUser;
  }
}
