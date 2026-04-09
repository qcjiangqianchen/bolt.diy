import type { AppLoadContext } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('auth.email');

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  return value === '1' || value.toLowerCase() === 'true';
}

function getEmailConfig(context: AppLoadContext) {
  const env = (context.cloudflare?.env as unknown as Record<string, string | undefined> | undefined) ?? {};

  return {
    host: env.BOLT_SMTP_HOST,
    port: Number(env.BOLT_SMTP_PORT || 587),
    secure: parseBoolean(env.BOLT_SMTP_SECURE, false),
    user: env.BOLT_SMTP_USER,
    pass: env.BOLT_SMTP_PASS,
    from: env.BOLT_SMTP_FROM || env.BOLT_SMTP_USER || 'no-reply@bolt.local',
  };
}

async function sendEmail(context: AppLoadContext, to: string, subject: string, text: string) {
  const cfg = getEmailConfig(context);

  if (!cfg.host || !cfg.user || !cfg.pass) {
    logger.warn(`SMTP not configured. Email to ${to} with subject "${subject}" not sent. Body: ${text}`);
    return;
  }

  const nodemailer = await import('nodemailer');

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
  });

  await transporter.sendMail({
    from: cfg.from,
    to,
    subject,
    text,
  });
}

export async function sendSignupCodeEmail(context: AppLoadContext, email: string, code: string) {
  await sendEmail(
    context,
    email,
    'Your Bolt account verification code',
    `Use this verification code to activate your account: ${code}\n\nThis code expires in 15 minutes.`,
  );
}

export async function sendPasswordResetCodeEmail(context: AppLoadContext, email: string, code: string) {
  await sendEmail(
    context,
    email,
    'Your Bolt password reset code',
    `Use this code to reset your password: ${code}\n\nThis code expires in 15 minutes.`,
  );
}
