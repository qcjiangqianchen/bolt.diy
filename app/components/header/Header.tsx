import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { chatStore } from '~/lib/stores/chat';
import { HeaderActionButtons } from './HeaderActionButtons.client';

export function Header() {
  const chat = useStore(chatStore);

  // When chat has started, hide the header entirely — the vertical side nav in BaseChat takes over
  if (chat.started) {
    return null;
  }

  return (
    <header
      className="flex items-center px-4 border-b h-[var(--header-height)]"
      style={{ background: 'transparent', borderColor: 'transparent' }}
    >
      <div className="flex items-center gap-2 z-logo text-bolt-elements-textPrimary cursor-pointer">
        <div className="i-ph:sidebar-simple-duotone text-xl" />
        <a href="/" className="text-2xl font-semibold text-accent flex items-center">
          <img src="/HTX_logo.jpg" alt="logo" className="h-[38px] w-[38px] object-contain inline-block dark:hidden" />
          <img
            src="/logo-dark-styled.png"
            alt="logo"
            className="h-[38px] w-[38px] object-contain inline-block hidden dark:block"
          />
        </a>
      </div>
      {/* Action buttons only shown on landing page if needed */}
      <ClientOnly>
        {() => (
          <div className="ml-auto">
            <HeaderActionButtons chatStarted={false} />
          </div>
        )}
      </ClientOnly>
    </header>
  );
}
