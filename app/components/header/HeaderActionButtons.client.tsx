import { useState } from 'react';
import { useStore } from '@nanostores/react';
import { workbenchStore } from '~/lib/stores/workbench';
import { DeployButton } from '~/components/deploy/DeployButton';

interface HeaderActionButtonsProps {
  chatStarted: boolean;
}

export function HeaderActionButtons({ chatStarted: _chatStarted }: HeaderActionButtonsProps) {
  const [activePreviewIndex] = useState(0);
  const previews = useStore(workbenchStore.previews);
  const activePreview = previews[activePreviewIndex];
  const showWorkbench = useStore(workbenchStore.showWorkbench);

  const shouldShowButtons = activePreview;

  return (
    <div className="flex items-center gap-1">
      {/* Deploy Button */}
      {shouldShowButtons && <DeployButton />}

      {/* Preview toggle — visible when the workbench is closed */}
      {!showWorkbench && (
        <button
          onClick={() => workbenchStore.showWorkbench.set(true)}
          className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#6D28D9] text-white text-sm font-medium shadow-lg hover:bg-[#5B21B6] transition-colors duration-200"
        >
          <span className="i-ph:eye text-lg" />
          Preview
        </button>
      )}
    </div>
  );
}
