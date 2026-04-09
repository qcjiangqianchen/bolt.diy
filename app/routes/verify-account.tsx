import { Form, useActionData, useLoaderData, useNavigation } from '@remix-run/react';
import {
  json,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from '@remix-run/cloudflare';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { createUserSession, getSessionUser } from '~/lib/auth/session.server';
import { verifySignupCode } from '~/lib/auth/user-store.server';

export const meta: MetaFunction = () => {
  return [
    { title: 'Verify Account | Bolt' },
    { name: 'description', content: 'Verify your Bolt account with email code' },
  ];
};

type LoaderData = {
  email: string;
  redirectTo: string;
};

type ActionData = {
  error?: string;
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  const existingUser = await getSessionUser(request, context);

  if (existingUser) {
    return redirect('/');
  }

  const url = new URL(request.url);
  const email = url.searchParams.get('email') || '';
  const redirectTo = url.searchParams.get('redirectTo') || '/';

  return json<LoaderData>({ email, redirectTo });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email = String(formData.get('email') || '').trim();
  const code = String(formData.get('code') || '').trim();
  const redirectTo = String(formData.get('redirectTo') || '/');

  if (!email || !code) {
    return json<ActionData>({ error: 'Email and verification code are required.' }, { status: 400 });
  }

  const isVerified = await verifySignupCode(context, email, code);

  if (!isVerified) {
    return json<ActionData>({ error: 'Invalid or expired code.' }, { status: 400 });
  }

  return createUserSession(
    request,
    context,
    {
      id: email.toLowerCase(),
      email: email.toLowerCase(),
      role: 'user',
    },
    redirectTo.startsWith('/') ? redirectTo : '/',
  );
}

export default function VerifyAccountRoute() {
  const { email, redirectTo } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-bolt-elements-background-depth-1">
      <BackgroundRays />

      <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-md items-center px-6 py-10">
        <section className="w-full rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2/85 p-6 backdrop-blur">
          <div className="mb-6 space-y-2">
            <h1 className="text-2xl font-semibold text-bolt-elements-textPrimary">Verify your account</h1>
            <p className="text-sm text-bolt-elements-textSecondary">Enter the 6-digit code sent to your email.</p>
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
                defaultValue={email}
                autoComplete="email"
                required
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm text-bolt-elements-textSecondary">Verification Code</span>
              <input
                className="w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-3 px-3 py-2 text-bolt-elements-textPrimary outline-none ring-0 transition focus:border-bolt-elements-borderColorActive"
                name="code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                placeholder="123456"
              />
            </label>

            <button
              className="w-full rounded-lg bg-bolt-elements-button-primary-background px-4 py-2 text-sm font-medium text-bolt-elements-button-primary-text transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Verifying...' : 'Verify account'}
            </button>

            <div className="text-xs text-bolt-elements-textSecondary">
              Need a new code?{' '}
              <a href="/signup" className="hover:underline">
                Create account again
              </a>
            </div>
          </Form>
        </section>
      </main>
    </div>
  );
}
