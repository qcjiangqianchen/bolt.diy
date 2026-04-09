import { json, redirect, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { default as IndexRoute } from './_index';
import { getSessionUser, isAuthRequired } from '~/lib/auth/session.server';

export async function loader(args: LoaderFunctionArgs) {
  if (isAuthRequired(args.context)) {
    const user = await getSessionUser(args.request, args.context);

    if (!user) {
      const url = new URL(args.request.url);
      const redirectTo = `${url.pathname}${url.search}`;

      return redirect(`/login?redirectTo=${encodeURIComponent(redirectTo)}`);
    }
  }

  return json({ id: args.params.id });
}

export default IndexRoute;
