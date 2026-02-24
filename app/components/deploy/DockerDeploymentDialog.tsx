import * as Dialog from '@radix-ui/react-dialog';
import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { motion } from 'framer-motion';
import { classNames } from '~/utils/classNames';

interface DockerDeploymentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projectName: string;
  files: Record<string, string>;
  dockerfile: string;
  dockerCompose: string;
}

type TabId = 'configure' | 'dockerfile' | 'compose' | 'build' | 'flyio';

export function DockerDeploymentDialog({
  isOpen,
  onClose,
  projectName,
  files,
  dockerfile,
  dockerCompose,
}: DockerDeploymentDialogProps) {
  const [imageName, setImageName] = useState('');
  const [imageTag, setImageTag] = useState('latest');
  const [activeTab, setActiveTab] = useState<TabId>('configure');
  const [editedDockerfile, setEditedDockerfile] = useState(dockerfile);
  const [editedDockerCompose, setEditedDockerCompose] = useState(dockerCompose);
  const [isBuildingOnServer, setIsBuildingOnServer] = useState(false);
  const [buildLog, setBuildLog] = useState('');
  const [buildStatus, setBuildStatus] = useState<'idle' | 'building' | 'success' | 'error'>('idle');

  // Fly.io state
  const [flyAppName, setFlyAppName] = useState('');
  const [flyRegion, setFlyRegion] = useState('iad');
  const [isDeployingToFly, setIsDeployingToFly] = useState(false);
  const [flyDeployLog, setFlyDeployLog] = useState('');
  const [flyDeployStatus, setFlyDeployStatus] = useState<'idle' | 'deploying' | 'success' | 'error'>('idle');
  const [flyAppUrl, setFlyAppUrl] = useState('');

  useEffect(() => {
    if (isOpen) {
      setImageName(projectName);
      setFlyAppName(projectName);
      setEditedDockerfile(dockerfile);
      setEditedDockerCompose(dockerCompose);
      setBuildLog('');
      setBuildStatus('idle');
      setFlyDeployLog('');
      setFlyDeployStatus('idle');
      setFlyAppUrl('');
    }
  }, [isOpen, projectName, dockerfile, dockerCompose]);

  // Update docker-compose when image name changes
  useEffect(() => {
    if (imageName) {
      const fullName = `${imageName}:${imageTag}`;
      setEditedDockerCompose((prev) => prev.replace(/image:\s*.+/, `image: ${fullName}`));
    }
  }, [imageName, imageTag]);

  const fileCount = Object.keys(files).length;

  const totalSize = Object.values(files).reduce((acc, content) => acc + new Blob([content]).size, 0);

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) {
      return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  /**
   * Downloads the entire project as a .tar.gz package including Dockerfile & docker-compose.yml,
   * ready to be fed into a CI/CD pipeline.
   */
  const handleDownloadPackage = useCallback(async () => {
    try {
      // Update the Dockerfile and compose in files
      const packageFiles = { ...files };
      packageFiles.Dockerfile = editedDockerfile;
      packageFiles['docker-compose.yml'] = editedDockerCompose;

      // Send to server to create tar.gz
      const response = await fetch('/api/deploy-docker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'package',
          imageName: `${imageName}:${imageTag}`,
          files: packageFiles,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }

      // Download the tar.gz file
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${imageName}-docker-package.tar.gz`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success('Docker package downloaded successfully!');
    } catch (error) {
      console.error('Download failed:', error);
      toast.error('Failed to download Docker package');
    }
  }, [files, editedDockerfile, editedDockerCompose, imageName, imageTag]);

  /**
   * Triggers a server-side Docker image build.
   * Requires Docker to be installed on the bolt.diy server.
   */
  const handleBuildImage = useCallback(async () => {
    setIsBuildingOnServer(true);
    setBuildStatus('building');
    setBuildLog('Starting Docker image build...\n');
    setActiveTab('build');

    try {
      const packageFiles = { ...files };
      packageFiles.Dockerfile = editedDockerfile;
      packageFiles['docker-compose.yml'] = editedDockerCompose;

      const response = await fetch('/api/deploy-docker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'build',
          imageName: `${imageName}:${imageTag}`,
          files: packageFiles,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({ error: 'Unknown error' }))) as { error?: string };
        throw new Error(errorData.error || `Build failed with status ${response.status}`);
      }

      // Stream the build logs
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          const text = decoder.decode(value, { stream: true });
          setBuildLog((prev) => prev + text);
        }
      }

      setBuildStatus('success');
      toast.success(`Docker image ${imageName}:${imageTag} built successfully!`);
    } catch (error) {
      console.error('Build failed:', error);
      setBuildStatus('error');
      setBuildLog((prev) => prev + `\nERROR: ${error instanceof Error ? error.message : 'Build failed'}\n`);
      toast.error('Docker image build failed');
    } finally {
      setIsBuildingOnServer(false);
    }
  }, [files, editedDockerfile, editedDockerCompose, imageName, imageTag]);

  /**
   * Deploys the Docker application directly to Fly.io.
   * Uses flyctl on the server — no Docker needed locally, Fly builds remotely.
   */
  const handleDeployToFly = useCallback(async () => {
    setIsDeployingToFly(true);
    setFlyDeployStatus('deploying');
    setFlyDeployLog('Starting Fly.io deployment...\n');
    setActiveTab('flyio');

    try {
      const packageFiles = { ...files };
      packageFiles.Dockerfile = editedDockerfile;
      packageFiles['docker-compose.yml'] = editedDockerCompose;

      const response = await fetch('/api/deploy-docker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'fly-deploy',
          imageName: `${imageName}:${imageTag}`,
          files: packageFiles,
          flyAppName: flyAppName || imageName,
          flyRegion,
        }),
      });

      if (!response.ok && response.headers.get('content-type')?.includes('application/json')) {
        const errorData = (await response.json().catch(() => ({ error: 'Unknown error' }))) as { error?: string };
        throw new Error(errorData.error || `Deployment failed with status ${response.status}`);
      }

      // Stream the deploy logs
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          const text = decoder.decode(value, { stream: true });
          setFlyDeployLog((prev) => prev + text);
        }
      }

      setFlyDeployStatus('success');
      setFlyAppUrl(`https://${flyAppName || imageName}.fly.dev`);
      toast.success(`Deployed to Fly.io! URL: https://${flyAppName || imageName}.fly.dev`);
    } catch (error) {
      console.error('Fly.io deploy failed:', error);
      setFlyDeployStatus('error');
      setFlyDeployLog((prev) => prev + `\nERROR: ${error instanceof Error ? error.message : 'Deployment failed'}\n`);
      toast.error('Fly.io deployment failed');
    } finally {
      setIsDeployingToFly(false);
    }
  }, [files, editedDockerfile, editedDockerCompose, imageName, imageTag, flyAppName, flyRegion]);

  const FLY_REGIONS = [
    { value: 'iad', label: 'Ashburn, Virginia (US)' },
    { value: 'ord', label: 'Chicago, Illinois (US)' },
    { value: 'lax', label: 'Los Angeles, California (US)' },
    { value: 'sea', label: 'Seattle, Washington (US)' },
    { value: 'yyz', label: 'Toronto, Canada' },
    { value: 'lhr', label: 'London, United Kingdom' },
    { value: 'ams', label: 'Amsterdam, Netherlands' },
    { value: 'fra', label: 'Frankfurt, Germany' },
    { value: 'cdg', label: 'Paris, France' },
    { value: 'nrt', label: 'Tokyo, Japan' },
    { value: 'sin', label: 'Singapore' },
    { value: 'syd', label: 'Sydney, Australia' },
    { value: 'hkg', label: 'Hong Kong' },
    { value: 'bom', label: 'Mumbai, India' },
    { value: 'gru', label: 'São Paulo, Brazil' },
  ];

  const tabs: { id: TabId; label: string; icon: string }[] = [
    { id: 'configure', label: 'Configure', icon: 'i-ph:gear' },
    { id: 'dockerfile', label: 'Dockerfile', icon: 'i-ph:file-code' },
    { id: 'compose', label: 'Compose', icon: 'i-ph:stack' },
    { id: 'flyio', label: 'Fly.io', icon: 'i-ph:cloud-arrow-up' },
    { id: 'build', label: 'Build Log', icon: 'i-ph:terminal' },
  ];

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[998]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-bolt-elements-background-depth-1 rounded-xl shadow-2xl border border-bolt-elements-borderColor z-[999] w-[90vw] max-w-[700px] max-h-[85vh] overflow-hidden">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-bolt-elements-borderColor">
              <div className="flex items-center gap-3">
                <div className="i-ph:docker-logo text-2xl text-blue-500" />
                <div>
                  <Dialog.Title className="text-lg font-semibold text-bolt-elements-textPrimary">
                    Deploy as Docker Image
                  </Dialog.Title>
                  <Dialog.Description className="text-sm text-bolt-elements-textSecondary">
                    Package your application into a Docker image for CI/CD deployment
                  </Dialog.Description>
                </div>
              </div>
              <Dialog.Close asChild>
                <button className="text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-colors p-1 rounded-lg hover:bg-bolt-elements-background-depth-3">
                  <div className="i-ph:x text-xl" />
                </button>
              </Dialog.Close>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-bolt-elements-borderColor px-4">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={classNames(
                    'flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors',
                    activeTab === tab.id
                      ? 'border-accent-500 text-accent-500'
                      : 'border-transparent text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary',
                  )}
                >
                  <div className={classNames(tab.icon, 'text-base')} />
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="p-4 overflow-y-auto max-h-[calc(85vh-200px)]">
              {/* Configure Tab */}
              {activeTab === 'configure' && (
                <div className="space-y-4">
                  {/* Project Summary */}
                  <div className="bg-bolt-elements-background-depth-2 rounded-lg p-3 flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-1.5 text-bolt-elements-textSecondary">
                      <div className="i-ph:files text-base" />
                      <span>{fileCount} files</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-bolt-elements-textSecondary">
                      <div className="i-ph:database text-base" />
                      <span>{formatSize(totalSize)}</span>
                    </div>
                  </div>

                  {/* Image Name */}
                  <div>
                    <label className="block text-sm font-medium text-bolt-elements-textPrimary mb-1.5">
                      Image Name
                    </label>
                    <input
                      type="text"
                      value={imageName}
                      onChange={(e) => setImageName(e.target.value.replace(/[^a-z0-9._/-]/g, ''))}
                      placeholder="my-app"
                      className="w-full px-3 py-2 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
                    />
                    <p className="mt-1 text-xs text-bolt-elements-textSecondary">
                      Lowercase letters, numbers, dots, hyphens, and slashes only
                    </p>
                  </div>

                  {/* Image Tag */}
                  <div>
                    <label className="block text-sm font-medium text-bolt-elements-textPrimary mb-1.5">Image Tag</label>
                    <input
                      type="text"
                      value={imageTag}
                      onChange={(e) => setImageTag(e.target.value.replace(/[^a-z0-9._-]/g, ''))}
                      placeholder="latest"
                      className="w-full px-3 py-2 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
                    />
                  </div>

                  {/* Full Image Reference */}
                  <div className="bg-bolt-elements-background-depth-2 rounded-lg p-3">
                    <span className="text-xs text-bolt-elements-textSecondary">Full image reference:</span>
                    <code className="block mt-1 text-sm text-accent-500 font-mono">
                      {imageName || 'my-app'}:{imageTag || 'latest'}
                    </code>
                  </div>
                </div>
              )}

              {/* Dockerfile Tab */}
              {activeTab === 'dockerfile' && (
                <div className="space-y-2">
                  <p className="text-sm text-bolt-elements-textSecondary">
                    Auto-generated Dockerfile. Edit as needed before building.
                  </p>
                  <textarea
                    value={editedDockerfile}
                    onChange={(e) => setEditedDockerfile(e.target.value)}
                    className="w-full h-80 px-3 py-2 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent-500 resize-y"
                    spellCheck={false}
                  />
                </div>
              )}

              {/* Docker Compose Tab */}
              {activeTab === 'compose' && (
                <div className="space-y-2">
                  <p className="text-sm text-bolt-elements-textSecondary">
                    Auto-generated docker-compose.yml. Edit as needed.
                  </p>
                  <textarea
                    value={editedDockerCompose}
                    onChange={(e) => setEditedDockerCompose(e.target.value)}
                    className="w-full h-80 px-3 py-2 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent-500 resize-y"
                    spellCheck={false}
                  />
                </div>
              )}

              {/* Fly.io Tab */}
              {activeTab === 'flyio' && (
                <div className="space-y-4">
                  {flyDeployStatus === 'idle' ? (
                    <>
                      <p className="text-sm text-bolt-elements-textSecondary">
                        Deploy your Docker application directly to Fly.io. The image will be built remotely on
                        Fly&apos;s builders — no local Docker needed.
                      </p>

                      {/* Fly App Name */}
                      <div>
                        <label className="block text-sm font-medium text-bolt-elements-textPrimary mb-1.5">
                          Fly App Name
                        </label>
                        <input
                          type="text"
                          value={flyAppName}
                          onChange={(e) => setFlyAppName(e.target.value.replace(/[^a-z0-9-]/g, ''))}
                          placeholder="my-app"
                          className="w-full px-3 py-2 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                        <p className="mt-1 text-xs text-bolt-elements-textSecondary">
                          Lowercase letters, numbers, and hyphens only. This becomes your URL: {flyAppName || 'my-app'}
                          .fly.dev
                        </p>
                      </div>

                      {/* Fly Region */}
                      <div>
                        <label className="block text-sm font-medium text-bolt-elements-textPrimary mb-1.5">
                          Region
                        </label>
                        <select
                          value={flyRegion}
                          onChange={(e) => setFlyRegion(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                        >
                          {FLY_REGIONS.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label} ({r.value})
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Summary Card */}
                      <div className="bg-bolt-elements-background-depth-2 rounded-lg p-3 space-y-1">
                        <div className="text-xs text-bolt-elements-textSecondary">Deployment summary:</div>
                        <div className="text-sm text-bolt-elements-textPrimary">
                          App: <code className="text-purple-500 font-mono">{flyAppName || imageName}</code>
                        </div>
                        <div className="text-sm text-bolt-elements-textPrimary">
                          Region:{' '}
                          <code className="text-purple-500 font-mono">
                            {FLY_REGIONS.find((r) => r.value === flyRegion)?.label || flyRegion}
                          </code>
                        </div>
                        <div className="text-sm text-bolt-elements-textPrimary">
                          URL:{' '}
                          <code className="text-purple-500 font-mono">https://{flyAppName || imageName}.fly.dev</code>
                        </div>
                      </div>

                      <button
                        onClick={handleDeployToFly}
                        disabled={!flyAppName || isDeployingToFly}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <div className="i-ph:cloud-arrow-up text-base" />
                        Deploy to Fly.io
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Deploy status header */}
                      <div className="flex items-center gap-2 mb-2">
                        {flyDeployStatus === 'deploying' && (
                          <div className="flex items-center gap-1.5 text-purple-500 text-sm">
                            <div className="i-ph:spinner animate-spin" />
                            Deploying to Fly.io...
                          </div>
                        )}
                        {flyDeployStatus === 'success' && (
                          <div className="flex items-center gap-1.5 text-green-500 text-sm">
                            <div className="i-ph:check-circle" />
                            Deployed successfully!
                            {flyAppUrl && (
                              <a
                                href={flyAppUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ml-2 text-purple-500 underline hover:text-purple-400"
                              >
                                Open app &rarr;
                              </a>
                            )}
                          </div>
                        )}
                        {flyDeployStatus === 'error' && (
                          <div className="flex items-center gap-1.5 text-red-500 text-sm">
                            <div className="i-ph:warning-circle" />
                            Deployment failed
                            <button
                              onClick={() => {
                                setFlyDeployStatus('idle');
                                setFlyDeployLog('');
                              }}
                              className="ml-2 text-xs text-bolt-elements-textSecondary underline hover:text-bolt-elements-textPrimary"
                            >
                              Try again
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Deploy log */}
                      <pre className="w-full h-80 px-3 py-2 rounded-lg border border-bolt-elements-borderColor bg-black text-green-400 text-xs font-mono overflow-auto whitespace-pre-wrap">
                        {flyDeployLog || 'Deploy output will appear here...'}
                      </pre>
                    </>
                  )}
                </div>
              )}

              {/* Build Log Tab */}
              {activeTab === 'build' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 mb-2">
                    {buildStatus === 'building' && (
                      <div className="flex items-center gap-1.5 text-blue-500 text-sm">
                        <div className="i-ph:spinner animate-spin" />
                        Building image...
                      </div>
                    )}
                    {buildStatus === 'success' && (
                      <div className="flex items-center gap-1.5 text-green-500 text-sm">
                        <div className="i-ph:check-circle" />
                        Build complete
                      </div>
                    )}
                    {buildStatus === 'error' && (
                      <div className="flex items-center gap-1.5 text-red-500 text-sm">
                        <div className="i-ph:warning-circle" />
                        Build failed
                      </div>
                    )}
                    {buildStatus === 'idle' && (
                      <div className="text-sm text-bolt-elements-textSecondary">
                        No build started yet. Click &quot;Build Image&quot; to start.
                      </div>
                    )}
                  </div>
                  <pre className="w-full h-80 px-3 py-2 rounded-lg border border-bolt-elements-borderColor bg-black text-green-400 text-xs font-mono overflow-auto whitespace-pre-wrap">
                    {buildLog || 'Build output will appear here...'}
                  </pre>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between p-4 border-t border-bolt-elements-borderColor bg-bolt-elements-background-depth-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-colors"
              >
                Cancel
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownloadPackage}
                  disabled={!imageName}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="i-ph:download-simple text-base" />
                  Download Package
                </button>
                <button
                  onClick={handleBuildImage}
                  disabled={!imageName || isBuildingOnServer}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isBuildingOnServer ? (
                    <>
                      <div className="i-ph:spinner animate-spin text-base" />
                      Building...
                    </>
                  ) : (
                    <>
                      <div className="i-ph:play text-base" />
                      Build Image
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
