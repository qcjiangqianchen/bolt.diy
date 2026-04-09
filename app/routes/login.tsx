import { Form, useActionData, useLoaderData, useNavigation } from '@remix-run/react';
import {
  json,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from '@remix-run/cloudflare';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { createUserSession, getSessionUser, isAuthRequired, validateCredentials } from '~/lib/auth/session.server';

export const meta: MetaFunction = () => {
  return [{ title: 'Sign In | Bolt' }, { name: 'description', content: 'Sign in to access Bolt' }];
};

type LoaderData = {
  redirectTo: string;
  authRequired: boolean;
};

type ActionData = {
  error?: string;
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  const authRequired = isAuthRequired(context);

  const existingUser = await getSessionUser(request, context);

  if (existingUser) {
    return redirect('/');
  }

  const url = new URL(request.url);
  const redirectTo = url.searchParams.get('redirectTo') || '/';

  return json<LoaderData>({ redirectTo, authRequired });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email = String(formData.get('email') || '');
  const password = String(formData.get('password') || '');
  const redirectTo = String(formData.get('redirectTo') || '/');

  if (!email || !password) {
    return json<ActionData>({ error: 'Email and password are required.' }, { status: 400 });
  }

  const user = await validateCredentials(context, email, password);

  if (!user) {
    return json<ActionData>(
      { error: 'Invalid credentials. If you are new, create an account first.' },
      { status: 401 },
    );
  }

  return createUserSession(request, context, user, redirectTo.startsWith('/') ? redirectTo : '/');
}

export default function LoginRoute() {
  const { redirectTo, authRequired } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-bolt-elements-background-depth-1">
      <BackgroundRays />

      <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-md items-center px-6 py-10">
        <section className="w-full rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2/85 p-6 backdrop-blur">
          <div className="mb-6 space-y-2">
            <h1 className="text-2xl font-semibold text-bolt-elements-textPrimary">Sign in to Bolt</h1>
            <p className="text-sm text-bolt-elements-textSecondary">
              {authRequired
                ? 'Authentication is enabled for this deployment.'
                : 'Authentication is optional right now, but you can still sign in to test the flow.'}
            </p>
          </div>

          {actionData?.error && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
              {actionData.error}
            </div>
          )}

          <Form method="post" className="space-y-4">
            <input type="hidden" name="redirectTo" value={redirectTo} />

            <label className="block space-y-2">
              <span className="text-sm text-bolt-elements-textSecondary">Email</span>
              <input
                className="w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-3 px-3 py-2 text-bolt-elements-textPrimary outline-none ring-0 transition focus:border-bolt-elements-borderColorActive"
                name="email"
                type="email"
                autoComplete="username"
                required
                placeholder="admin@company.com"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm text-bolt-elements-textSecondary">Password</span>
              <input
                className="w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-3 px-3 py-2 text-bolt-elements-textPrimary outline-none ring-0 transition focus:border-bolt-elements-borderColorActive"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                placeholder="••••••••"
              />
            </label>

            <button
              className="w-full rounded-lg bg-bolt-elements-button-primary-background px-4 py-2 text-sm font-medium text-bolt-elements-button-primary-text transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Signing in...' : 'Sign in'}
            </button>

            <div className="flex items-center justify-between text-xs text-bolt-elements-textSecondary">
              <a href={`/signup?redirectTo=${encodeURIComponent(redirectTo)}`} className="hover:underline">
                Create account
              </a>
              <a href="/forgot-password" className="hover:underline">
                Forgot password?
              </a>
            </div>
          </Form>
        </section>
      </main>
    </div>
  );
}
