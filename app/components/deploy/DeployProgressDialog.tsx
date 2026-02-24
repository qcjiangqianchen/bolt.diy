import * as Dialog from '@radix-ui/react-dialog';
import { motion } from 'framer-motion';

interface DeployProgressDialogProps {
  isOpen: boolean;
  onClose: () => void;
  status: 'deploying' | 'success' | 'error';
  log: string;
  appUrl: string | null;
}

/**
 * A minimal, user-facing deploy progress dialog.
 * Shows a streaming log while deploying, then the final app URL on success.
 * All infrastructure details are abstracted away from the user.
 */
export function DeployProgressDialog({ isOpen, onClose, status, log, appUrl }: DeployProgressDialogProps) {
  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && status !== 'deploying' && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[998]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-bolt-elements-background-depth-1 rounded-xl shadow-2xl border border-bolt-elements-borderColor z-[999] w-[90vw] max-w-[560px] max-h-[80vh] overflow-hidden">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-bolt-elements-borderColor">
              <div className="flex items-center gap-3">
                {status === 'deploying' && <div className="i-ph:spinner animate-spin text-xl text-purple-500" />}
                {status === 'success' && <div className="i-ph:check-circle-fill text-xl text-green-500" />}
                {status === 'error' && <div className="i-ph:warning-circle-fill text-xl text-red-500" />}
                <div>
                  <Dialog.Title className="text-base font-semibold text-bolt-elements-textPrimary">
                    {status === 'deploying' && 'Deploying your application...'}
                    {status === 'success' && 'Deployment complete!'}
                    {status === 'error' && 'Deployment failed'}
                  </Dialog.Title>
                  <Dialog.Description className="text-xs text-bolt-elements-textSecondary mt-0.5">
                    {status === 'deploying' && 'Building and deploying — this may take a minute.'}
                    {status === 'success' && 'Your application is live and ready to use.'}
                    {status === 'error' && 'Something went wrong. Check the log below for details.'}
                  </Dialog.Description>
                </div>
              </div>
              {status !== 'deploying' && (
                <Dialog.Close asChild>
                  <button className="text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-colors p-1 rounded-lg hover:bg-bolt-elements-background-depth-3">
                    <div className="i-ph:x text-lg" />
                  </button>
                </Dialog.Close>
              )}
            </div>

            {/* Success URL card */}
            {status === 'success' && appUrl && (
              <div className="mx-4 mt-4 p-4 rounded-lg bg-green-500/10 border border-green-500/20">
                <div className="text-xs text-bolt-elements-textSecondary mb-1">Your app is live at:</div>
                <a
                  href={appUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-purple-500 hover:text-purple-400 underline break-all"
                >
                  {appUrl}
                </a>
              </div>
            )}

            {/* Log output */}
            <div className="p-4">
              <pre className="w-full h-56 px-3 py-2 rounded-lg border border-bolt-elements-borderColor bg-black text-green-400 text-[11px] font-mono overflow-auto whitespace-pre-wrap leading-relaxed">
                {log || 'Preparing deployment...'}
              </pre>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end p-4 border-t border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 gap-2">
              {status === 'success' && appUrl && (
                <a
                  href={appUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition-colors"
                >
                  <div className="i-ph:arrow-square-out text-base" />
                  Open App
                </a>
              )}
              {status !== 'deploying' && (
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-colors"
                >
                  Close
                </button>
              )}
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
