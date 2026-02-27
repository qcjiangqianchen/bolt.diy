import { useStore } from '@nanostores/react';
import { isGitLabConnected } from '~/lib/stores/gitlabConnection';
import { workbenchStore } from '~/lib/stores/workbench';
import { streamingState } from '~/lib/stores/streaming';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useGitLabDeploy } from '~/components/deploy/GitLabDeploy.client';
import { GitLabDeploymentDialog } from '~/components/deploy/GitLabDeploymentDialog';
import { useDockerDeploy } from '~/components/deploy/DockerDeploy.client';
import { DeployProgressDialog } from '~/components/deploy/DeployProgressDialog';
import { toast } from 'react-toastify';
import { useChatHistory, chatMetadata } from '~/lib/persistence/useChatHistory';
import { usePreviewStore } from '~/lib/stores/previews';

interface DeployButtonProps {
  onGitLabDeploy?: () => Promise<void>;
}

export const DeployButton = ({ onGitLabDeploy }: DeployButtonProps) => {
  const gitlabIsConnected = useStore(isGitLabConnected);
  const [activePreviewIndex] = useState(0);
  const previews = useStore(workbenchStore.previews);
  const activePreview = previews[activePreviewIndex];
  const [isDeploying, setIsDeploying] = useState(false);
  const isStreaming = useStore(streamingState);
  const { handleGitLabDeploy } = useGitLabDeploy();
  const [showGitLabDeploymentDialog, setShowGitLabDeploymentDialog] = useState(false);
  const [gitlabDeploymentFiles, setGitlabDeploymentFiles] = useState<Record<string, string> | null>(null);
  const [gitlabProjectName, setGitlabProjectName] = useState('');
  const { updateChatMestaData } = useChatHistory();
  const currentMetadata = useStore(chatMetadata);

  // One-click deploy state
  const { handleDockerDeploy, isDeploying: isPackaging } = useDockerDeploy();
  const [showDeployProgress, setShowDeployProgress] = useState(false);
  const [deployStatus, setDeployStatus] = useState<'deploying' | 'success' | 'error'>('deploying');
  const [deployLog, setDeployLog] = useState('');
  const [deployedAppUrl, setDeployedAppUrl] = useState<string | null>(null);

  // Track preview refresh signal to detect new changes since last deploy
  const previewsStore = usePreviewStore();
  const refreshSignal = useStore(previewsStore.refreshSignal);

  // -1 means no deploy has happened yet this session (button enabled)
  const [deployedAtSignal, setDeployedAtSignal] = useState(-1);

  // Keep a ref so the deploy callback always reads the latest signal value
  const refreshSignalRef = useRef(refreshSignal);

  useEffect(() => {
    refreshSignalRef.current = refreshSignal;
  }, [refreshSignal]);

  // When switching to a chat that has never been deployed, reset the guard
  useEffect(() => {
    if (!currentMetadata?.deployedUrl) {
      setDeployedAtSignal(-1);
    }
  }, [currentMetadata?.deployedUrl]);

  const handleGitLabDeployClick = async () => {
    setIsDeploying(true);

    try {
      if (onGitLabDeploy) {
        await onGitLabDeploy();
      } else {
        const result = await handleGitLabDeploy();

        if (result && result.success && result.files) {
          setGitlabDeploymentFiles(result.files);
          setGitlabProjectName(result.projectName);
          setShowGitLabDeploymentDialog(true);
        }
      }
    } finally {
      setIsDeploying(false);
    }
  };

  /**
   * One-click deploy: collect files → generate Dockerfile → deploy to Fly.io.
   * No user configuration needed. App name is auto-derived from the project.
   */
  const handleOneClickDeploy = useCallback(async () => {
    // Step 1: Show progress dialog immediately
    setDeployLog('Preparing your application for deployment...\n');
    setDeployStatus('deploying');
    setDeployedAppUrl(null);
    setShowDeployProgress(true);

    try {
      // Step 2: Collect files and generate Docker artifacts
      setDeployLog((prev) => prev + 'Building project and collecting files...\n');

      const result = await handleDockerDeploy();

      if (!result || !result.success || !result.files) {
        throw new Error('Failed to prepare project files. Check the terminal for build errors.');
      }

      /*
       * Step 3: Determine the Fly.io app name
       * - FIRST deploy: auto-generate a unique name (project name + short id suffix)
       * - REDEPLOY:     reuse the name stored in metadata so flyctl updates the SAME app
       *   in-place — zero-downtime rolling deploy, URL unchanged, analytics history preserved.
       */
      const existingUrl = currentMetadata?.deployedUrl;
      let flyAppName: string;

      if (existingUrl) {
        try {
          flyAppName = new URL(existingUrl).hostname.split('.')[0];
          setDeployLog((prev) => prev + `Redeploying "${flyAppName}" in-place (same URL, zero downtime)...\n\n`);
        } catch {
          // URL parse failed — fall back to a fresh name
          flyAppName = `${result.projectName.replace(/[^a-z0-9-]/g, '').slice(0, 24)}-${Date.now().toString(36).slice(-4)}`;
          setDeployLog((prev) => prev + `Deploying as "${flyAppName}"...\n\n`);
        }
      } else {
        // First deploy — generate a stable unique name
        flyAppName = `${result.projectName.replace(/[^a-z0-9-]/g, '').slice(0, 24)}-${Date.now().toString(36).slice(-4)}`;
        setDeployLog((prev) => prev + `Deploying as "${flyAppName}"...\n\n`);
      }

      // Step 4: Send to server for Fly.io deployment
      const response = await fetch('/api/deploy-docker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'fly-deploy',
          imageName: `${result.projectName}:latest`,
          files: result.files,
          flyAppName,
          flyRegion: 'iad',
          boltUrl: window.location.origin, // automatically determined — no config needed
        }),
      });

      if (!response.ok && response.headers.get('content-type')?.includes('application/json')) {
        const errorData = (await response.json().catch(() => ({ error: 'Unknown error' }))) as { error?: string };
        throw new Error(errorData.error || `Deployment failed (${response.status})`);
      }

      // Step 5: Stream deployment logs and accumulate for success detection
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullLog = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          const text = decoder.decode(value, { stream: true });
          fullLog += text;
          setDeployLog((prev) => prev + text);
        }
      }

      // Step 6: Check if the stream contained a failure marker
      if (fullLog.includes('✗ Deployment failed') || fullLog.includes('deployment did not complete')) {
        throw new Error('Deployment failed — check the log for details');
      }

      // Step 7: Done — show the URL and persist to chat metadata
      const appUrl = `https://${flyAppName}.fly.dev`;
      setDeployedAppUrl(appUrl);
      setDeployStatus('success');
      toast.success('Application deployed successfully!');

      // Lock the deploy button until the preview refreshes again (new changes)
      setDeployedAtSignal(refreshSignalRef.current);

      // Persist the deployed URL in chat metadata so sidebar and analytics panel can read it
      try {
        await updateChatMestaData({
          ...currentMetadata,
          gitUrl: currentMetadata?.gitUrl || '',
          deployedUrl: appUrl,
          deployedAt: new Date().toISOString(),
        });
      } catch (metaErr) {
        console.warn('Failed to persist deployed URL to metadata:', metaErr);
      }
    } catch (error) {
      console.error('Deploy failed:', error);
      setDeployStatus('error');
      setDeployLog((prev) => prev + `\nERROR: ${error instanceof Error ? error.message : 'Deployment failed'}\n`);
      toast.error('Deployment failed');
    }
  }, [handleDockerDeploy, updateChatMestaData, currentMetadata]);

  return (
    <>
      <button
        onClick={handleGitLabDeployClick}
        disabled={isDeploying || !activePreview || !gitlabIsConnected || isStreaming}
        className="rounded-md items-center justify-center [&:is(:disabled,.disabled)]:cursor-not-allowed [&:is(:disabled,.disabled)]:opacity-60 px-3 py-1.5 text-xs bg-accent-500 text-white hover:text-bolt-elements-item-contentAccent [&:not(:disabled,.disabled)]:hover:bg-bolt-elements-button-primary-backgroundHover outline-accent-500 flex gap-1.5 border border-bolt-elements-borderColor"
        title={!gitlabIsConnected ? 'No GitLab Account Connected' : 'Deploy to GitLab'}
      >
        <img
          className="w-4 h-4"
          height="16"
          width="16"
          crossOrigin="anonymous"
          src="https://cdn.simpleicons.org/gitlab"
          alt="gitlab"
        />
        <span>{isDeploying ? 'Deploying...' : 'Deploy to GitLab'}</span>
      </button>

      <button
        onClick={handleOneClickDeploy}
        disabled={
          isPackaging ||
          (deployStatus === 'deploying' && showDeployProgress) ||
          !activePreview ||
          isStreaming ||
          (deployedAtSignal !== -1 && refreshSignal === deployedAtSignal)
        }
        className="rounded-md items-center justify-center [&:is(:disabled,.disabled)]:cursor-not-allowed [&:is(:disabled,.disabled)]:opacity-60 px-3 py-1.5 text-xs bg-purple-600 text-white hover:bg-purple-700 outline-purple-600 flex gap-1.5 border border-bolt-elements-borderColor"
        title={
          deployedAtSignal !== -1 && refreshSignal === deployedAtSignal
            ? 'No changes since last deploy'
            : 'Deploy your application'
        }
      >
        <div className="i-ph:rocket-launch text-base" />
        <span>{isPackaging || (deployStatus === 'deploying' && showDeployProgress) ? 'Deploying...' : 'Deploy'}</span>
      </button>

      {/* GitLab Deployment Dialog */}
      {showGitLabDeploymentDialog && gitlabDeploymentFiles && (
        <GitLabDeploymentDialog
          isOpen={showGitLabDeploymentDialog}
          onClose={() => setShowGitLabDeploymentDialog(false)}
          projectName={gitlabProjectName}
          files={gitlabDeploymentFiles}
        />
      )}

      {/* One-click Deploy Progress Dialog */}
      {showDeployProgress && (
        <DeployProgressDialog
          isOpen={showDeployProgress}
          onClose={() => setShowDeployProgress(false)}
          status={deployStatus}
          log={deployLog}
          appUrl={deployedAppUrl}
        />
      )}
    </>
  );
};
