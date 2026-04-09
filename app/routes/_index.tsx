import { json, redirect, type LoaderFunctionArgs, type MetaFunction } from '@remix-run/cloudflare';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { useStore } from '@nanostores/react';
import { chatStore } from '~/lib/stores/chat';
import { getSessionUser, isAuthRequired } from '~/lib/auth/session.server';

export const meta: MetaFunction = () => {
  return [{ title: 'Bolt' }, { name: 'description', content: 'Talk with Bolt, an AI assistant from StackBlitz' }];
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  if (!isAuthRequired(context)) {
    return json({});
  }

  const user = await getSessionUser(request, context);

  if (user) {
    return json({});
  }

  const url = new URL(request.url);
  const redirectTo = `${url.pathname}${url.search}`;

  return redirect(`/login?redirectTo=${encodeURIComponent(redirectTo)}`);
}

/**
 * Landing page component for Bolt
 * Note: Settings functionality should ONLY be accessed through the sidebar menu.
 * Do not add settings button/panel to this landing page as it was intentionally removed
 * to keep the UI clean and consistent with the design system.
 */
export default function Index() {
  const chat = useStore(chatStore);

  return (
    <ClientOnly
      fallback={
        <div className="flex flex-col h-full w-full bg-bolt-elements-background-depth-1">
          <BackgroundRays />
          <Header />
          <BaseChat />
        </div>
      }
    >
      {() => {
        return (
          <div className="flex flex-col h-full w-full bg-bolt-elements-background-depth-1">
            {!chat.started && <BackgroundRays />}
            <Header />
            <Chat />
          </div>
        );
      }}
    </ClientOnly>
  );
}
