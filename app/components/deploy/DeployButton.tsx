import { useStore } from '@nanostores/react';
import { isGitLabConnected } from '~/lib/stores/gitlabConnection';
import { workbenchStore } from '~/lib/stores/workbench';
import { streamingState } from '~/lib/stores/streaming';
import { useState } from 'react';
import { useGitLabDeploy } from '~/components/deploy/GitLabDeploy.client';
import { GitLabDeploymentDialog } from '~/components/deploy/GitLabDeploymentDialog';
import { useDockerDeploy } from '~/components/deploy/DockerDeploy.client';
import { DockerDeploymentDialog } from '~/components/deploy/DockerDeploymentDialog';

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

  // Docker deploy state
  const { handleDockerDeploy, isDeploying: isDockerDeploying } = useDockerDeploy();
  const [showDockerDeploymentDialog, setShowDockerDeploymentDialog] = useState(false);
  const [dockerDeploymentFiles, setDockerDeploymentFiles] = useState<Record<string, string> | null>(null);
  const [dockerProjectName, setDockerProjectName] = useState('');
  const [dockerDockerfile, setDockerDockerfile] = useState('');
  const [dockerCompose, setDockerCompose] = useState('');

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

  const handleDockerDeployClick = async () => {
    const result = await handleDockerDeploy();

    if (result && result.success && result.files) {
      setDockerDeploymentFiles(result.files);
      setDockerProjectName(result.projectName);
      setDockerDockerfile(result.dockerfile);
      setDockerCompose(result.dockerCompose);
      setShowDockerDeploymentDialog(true);
    }
  };

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
        onClick={handleDockerDeployClick}
        disabled={isDockerDeploying || !activePreview || isStreaming}
        className="rounded-md items-center justify-center [&:is(:disabled,.disabled)]:cursor-not-allowed [&:is(:disabled,.disabled)]:opacity-60 px-3 py-1.5 text-xs bg-blue-600 text-white hover:bg-blue-700 outline-blue-600 flex gap-1.5 border border-bolt-elements-borderColor"
        title="Deploy as Docker Image"
      >
        <div className="i-ph:package text-base" />
        <span>{isDockerDeploying ? 'Packaging...' : 'Deploy Docker'}</span>
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

      {/* Docker Deployment Dialog */}
      {showDockerDeploymentDialog && dockerDeploymentFiles && (
        <DockerDeploymentDialog
          isOpen={showDockerDeploymentDialog}
          onClose={() => setShowDockerDeploymentDialog(false)}
          projectName={dockerProjectName}
          files={dockerDeploymentFiles}
          dockerfile={dockerDockerfile}
          dockerCompose={dockerCompose}
        />
      )}
    </>
  );
};
