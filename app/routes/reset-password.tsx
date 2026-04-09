import { Form, useActionData, useLoaderData, useNavigation } from '@remix-run/react';
import {
  json,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from '@remix-run/cloudflare';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { resetPasswordWithCode } from '~/lib/auth/user-store.server';

export const meta: MetaFunction = () => {
  return [{ title: 'Set New Password | Bolt' }, { name: 'description', content: 'Reset your Bolt password' }];
};

type LoaderData = {
  email: string;
};

type ActionData = {
  error?: string;
  success?: string;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const email = url.searchParams.get('email') || '';

  return json<LoaderData>({ email });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email = String(formData.get('email') || '').trim();
  const code = String(formData.get('code') || '').trim();
  const newPassword = String(formData.get('newPassword') || '');
  const confirmPassword = String(formData.get('confirmPassword') || '');

  if (!email || !code || !newPassword || !confirmPassword) {
    return json<ActionData>({ error: 'All fields are required.' }, { status: 400 });
  }

  if (newPassword.length < 8) {
    return json<ActionData>({ error: 'Password must be at least 8 characters long.' }, { status: 400 });
  }

  if (newPassword !== confirmPassword) {
    return json<ActionData>({ error: 'Passwords do not match.' }, { status: 400 });
  }

  const updated = await resetPasswordWithCode(context, email, code, newPassword);

  if (!updated) {
    return json<ActionData>({ error: 'Invalid or expired reset code.' }, { status: 400 });
  }

  return redirect('/login');
}

export default function ResetPasswordRoute() {
  const { email } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-bolt-elements-background-depth-1">
      <BackgroundRays />

      <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-md items-center px-6 py-10">
        <section className="w-full rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2/85 p-6 backdrop-blur">
          <div className="mb-6 space-y-2">
            <h1 className="text-2xl font-semibold text-bolt-elements-textPrimary">Set a new password</h1>
            <p className="text-sm text-bolt-elements-textSecondary">
              Enter the reset code from your email and choose a new password.
            </p>
          </div>

          {actionData?.error && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
              {actionData.error}
            </div>
          )}

          <Form method="post" className="space-y-4">
            <label className="block space-y-2">
              <span className="text-sm text-bolt-elements-textSecondary">Email</span>
              <input
                className="w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-3 px-3 py-2 text-bolt-elements-textPrimary outline-none ring-0 transition focus:border-bolt-elements-borderColorActive"
                name="email"
                type="email"
                defaultValue={email}
                required
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm text-bolt-elements-textSecondary">Reset Code</span>
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

            <label className="block space-y-2">
              <span className="text-sm text-bolt-elements-textSecondary">New Password</span>
              <input
                className="w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-3 px-3 py-2 text-bolt-elements-textPrimary outline-none ring-0 transition focus:border-bolt-elements-borderColorActive"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm text-bolt-elements-textSecondary">Confirm New Password</span>
              <input
                className="w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-3 px-3 py-2 text-bolt-elements-textPrimary outline-none ring-0 transition focus:border-bolt-elements-borderColorActive"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>

            <button
              className="w-full rounded-lg bg-bolt-elements-button-primary-background px-4 py-2 text-sm font-medium text-bolt-elements-button-primary-text transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Updating password...' : 'Reset password'}
            </button>

            <div className="text-xs text-bolt-elements-textSecondary">
              Back to{' '}
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
