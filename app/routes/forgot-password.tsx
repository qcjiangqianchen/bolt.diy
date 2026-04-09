import { Form, useActionData, useNavigation } from '@remix-run/react';
import { json, type ActionFunctionArgs, type MetaFunction } from '@remix-run/cloudflare';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { requestPasswordResetCode } from '~/lib/auth/user-store.server';
import { sendPasswordResetCodeEmail } from '~/lib/auth/email.server';

export const meta: MetaFunction = () => {
  return [{ title: 'Forgot Password | Bolt' }, { name: 'description', content: 'Request a Bolt password reset code' }];
};

type ActionData = {
  error?: string;
  success?: string;
  email?: string;
};

export async function action({ request, context }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email = String(formData.get('email') || '').trim();

  if (!email) {
    return json<ActionData>({ error: 'Email is required.' }, { status: 400 });
  }

  const { code, userExists } = await requestPasswordResetCode(context, email);

  if (userExists && code) {
    await sendPasswordResetCodeEmail(context, email, code);
  }

  return json<ActionData>({
    success: 'If that account exists, a reset code has been sent to the email address.',
    email,
  });
}

export default function ForgotPasswordRoute() {
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-bolt-elements-background-depth-1">
      <BackgroundRays />

      <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-md items-center px-6 py-10">
        <section className="w-full rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2/85 p-6 backdrop-blur">
          <div className="mb-6 space-y-2">
            <h1 className="text-2xl font-semibold text-bolt-elements-textPrimary">Reset your password</h1>
            <p className="text-sm text-bolt-elements-textSecondary">We will send a 6-digit reset code to your email.</p>
          </div>

          {actionData?.error && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
              {actionData.error}
            </div>
          )}

          {actionData?.success && (
            <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
              {actionData.success}{' '}
              {actionData.email && (
                <a
                  href={`/reset-password?email=${encodeURIComponent(actionData.email)}`}
                  className="underline decoration-dotted underline-offset-2"
                >
                  Continue to reset
                </a>
              )}
            </div>
          )}

          <Form method="post" className="space-y-4">
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

            <button
              className="w-full rounded-lg bg-bolt-elements-button-primary-background px-4 py-2 text-sm font-medium text-bolt-elements-button-primary-text transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Sending code...' : 'Send reset code'}
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
