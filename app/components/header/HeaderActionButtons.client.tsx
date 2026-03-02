import { useStore } from '@nanostores/react';
import { workbenchStore } from '~/lib/stores/workbench';

interface HeaderActionButtonsProps {
  chatStarted: boolean;
}

export function HeaderActionButtons({ chatStarted: _chatStarted }: HeaderActionButtonsProps) {
  const showWorkbench = useStore(workbenchStore.showWorkbench);

  return (
    <div className="flex items-center gap-1">
      {/* Preview toggle — visible only when the workbench is closed.
          When the workbench is open, the Deploy button lives inside the workbench header. */}
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
