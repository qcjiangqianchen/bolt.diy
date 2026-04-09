import { Form, useActionData, useLoaderData, useNavigation } from '@remix-run/react';
import {
  json,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from '@remix-run/cloudflare';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { getSessionUser } from '~/lib/auth/session.server';
import { requestSignupCode } from '~/lib/auth/user-store.server';
import { sendSignupCodeEmail } from '~/lib/auth/email.server';

export const meta: MetaFunction = () => {
  return [{ title: 'Create Account | Bolt' }, { name: 'description', content: 'Create a Bolt account' }];
};

type LoaderData = {
  redirectTo: string;
};

type ActionData = {
  error?: string;
  success?: string;
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  const existingUser = await getSessionUser(request, context);

  if (existingUser) {
    return redirect('/');
  }

  const url = new URL(request.url);
  const redirectTo = url.searchParams.get('redirectTo') || '/';

  return json<LoaderData>({ redirectTo });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');
  const confirmPassword = String(formData.get('confirmPassword') || '');
  const redirectTo = String(formData.get('redirectTo') || '/');

  if (!email || !password || !confirmPassword) {
    return json<ActionData>({ error: 'All fields are required.' }, { status: 400 });
  }

  if (password.length < 8) {
    return json<ActionData>({ error: 'Password must be at least 8 characters long.' }, { status: 400 });
  }

  if (password !== confirmPassword) {
    return json<ActionData>({ error: 'Passwords do not match.' }, { status: 400 });
  }

  const { code, existingVerifiedUser } = await requestSignupCode(context, email, password);

  if (existingVerifiedUser) {
    return json<ActionData>({ error: 'An account with this email already exists. Please sign in.' }, { status: 409 });
  }

  await sendSignupCodeEmail(context, email, code);

  return redirect(`/verify-account?email=${encodeURIComponent(email)}&redirectTo=${encodeURIComponent(redirectTo)}`);
}

export default function SignupRoute() {
  const { redirectTo } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-bolt-elements-background-depth-1">
      <BackgroundRays />

      <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-md items-center px-6 py-10">
        <section className="w-full rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2/85 p-6 backdrop-blur">
          <div className="mb-6 space-y-2">
            <h1 className="text-2xl font-semibold text-bolt-elements-textPrimary">Create your account</h1>
            <p className="text-sm text-bolt-elements-textSecondary">
              We will email you a verification code to activate your account.
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
                autoComplete="email"
                required
                placeholder="you@company.com"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm text-bolt-elements-textSecondary">Password</span>
              <input
                className="w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-3 px-3 py-2 text-bolt-elements-textPrimary outline-none ring-0 transition focus:border-bolt-elements-borderColorActive"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                placeholder="At least 8 characters"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm text-bolt-elements-textSecondary">Confirm Password</span>
              <input
                className="w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-3 px-3 py-2 text-bolt-elements-textPrimary outline-none ring-0 transition focus:border-bolt-elements-borderColorActive"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                placeholder="Repeat your password"
              />
            </label>

            <button
              className="w-full rounded-lg bg-bolt-elements-button-primary-background px-4 py-2 text-sm font-medium text-bolt-elements-button-primary-text transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Sending code...' : 'Create account'}
            </button>

            <div className="text-xs text-bolt-elements-textSecondary">
              Already have an account?{' '}
              <a href="/login" className="hover:underline">
                Sign in
              </a>
            </div>
          </Form>
        </section>
      </main>
    </div>
  );
}
