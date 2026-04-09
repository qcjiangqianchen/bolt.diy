import { type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { destroyUserSession } from '~/lib/auth/session.server';

export async function action({ request, context }: ActionFunctionArgs) {
  return destroyUserSession(request, context, '/login');
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  return destroyUserSession(request, context, '/login');
}

export default function logoutRoute() {
  return null;
}
