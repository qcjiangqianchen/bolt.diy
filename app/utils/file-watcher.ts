import type { WebContainer } from '@webcontainer/api';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('FileWatcher');

export interface FileWatcherOptions {
  /** Paths to watch for changes (relative to workdir) */
  watchPaths?: string[];

  /** Paths/patterns to ignore (e.g., node_modules, .git) */
  ignorePaths?: string[];

  /** Debounce delay in ms before triggering restart */
  debounceMs?: number;

  /** Callback when files change and restart should happen */
  onRestart: () => void | Promise<void>;
}

export class FileWatcher {
  private _webcontainer: WebContainer;
  private _options: Required<FileWatcherOptions>;
  private _isWatching = false;
  private _debounceTimer: NodeJS.Timeout | null = null;
  private _abortController: AbortController | null = null;

  constructor(webcontainer: WebContainer, options: FileWatcherOptions) {
    this._webcontainer = webcontainer;
    this._options = {
      watchPaths: options.watchPaths || ['src', 'public', 'index.html', 'package.json'],
      ignorePaths: options.ignorePaths || ['node_modules', '.git', 'dist', 'build', '.next', '.cache'],
      debounceMs: options.debounceMs || 500,
      onRestart: options.onRestart,
    };
  }

  async start() {
    if (this._isWatching) {
      logger.debug('File watcher already running');
      return;
    }

    this._isWatching = true;
    this._abortController = new AbortController();

    logger.info('Starting file watcher for paths:', this._options.watchPaths);

    /*
     * Watch for file changes using a simple polling mechanism
     * WebContainer doesn't expose native fs.watch, so we'll poll the file tree
     */
    this._pollForChanges();
  }

  private async _pollForChanges() {
    const checkInterval = 1000; // Check every second
    let lastFileSnapshot: Record<string, number> = {};

    const poll = async () => {
      if (!this._isWatching || this._abortController?.signal.aborted) {
        return;
      }

      try {
        const currentSnapshot = await this._getFileSnapshot();

        // Compare snapshots to detect changes
        const hasChanges = this._detectChanges(lastFileSnapshot, currentSnapshot);

        if (hasChanges) {
          logger.info('File changes detected, triggering restart...');
          this._triggerRestart();
        }

        lastFileSnapshot = currentSnapshot;
      } catch {
        logger.error('Error polling for file changes');
      }

      // Schedule next poll
      if (this._isWatching) {
        setTimeout(poll, checkInterval);
      }
    };

    // Start polling
    poll();
  }

  private async _getFileSnapshot(): Promise<Record<string, number>> {
    const snapshot: Record<string, number> = {};

    for (const watchPath of this._options.watchPaths) {
      try {
        await this._scanDirectory(watchPath, snapshot);
      } catch {
        // Path might not exist yet, skip
        logger.debug(`Skipping non-existent path: ${watchPath}`);
      }
    }

    return snapshot;
  }

  private async _scanDirectory(dirPath: string, snapshot: Record<string, number>, _baseDir: string = dirPath) {
    try {
      const entries = await this._webcontainer.fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = `${dirPath}/${entry.name}`;

        // Skip ignored paths
        if (this._shouldIgnore(fullPath)) {
          continue;
        }

        if (entry.isDirectory()) {
          await this._scanDirectory(fullPath, snapshot, _baseDir);
        } else if (entry.isFile()) {
          try {
            /*
             * Use file content hash or timestamp as change detector
             * Since WebContainer fs doesn't have stat, we'll use a simple file read
             */
            const content = await this._webcontainer.fs.readFile(fullPath, 'utf-8');

            // Simple hash: use content length + first/last chars as a lightweight fingerprint
            const fingerprint = content.length + (content.substring(0, 100) + content.substring(-100));
            snapshot[fullPath] = fingerprint.length;
          } catch {
            logger.debug(`Could not read file: ${fullPath}`);
          }
        }
      }
    } catch {
      // Directory might not exist or not be readable
      logger.debug(`Could not scan directory: ${dirPath}`);
    }
  }

  private _shouldIgnore(path: string): boolean {
    return this._options.ignorePaths.some((ignorePath) => path.includes(ignorePath));
  }

  private _detectChanges(oldSnapshot: Record<string, number>, newSnapshot: Record<string, number>): boolean {
    // Check for new or modified files
    for (const [path, mtime] of Object.entries(newSnapshot)) {
      if (oldSnapshot[path] !== mtime) {
        logger.debug(`Change detected in: ${path}`);
        return true;
      }
    }

    // Check for deleted files
    for (const path of Object.keys(oldSnapshot)) {
      if (!(path in newSnapshot)) {
        logger.debug(`File deleted: ${path}`);
        return true;
      }
    }

    return false;
  }

  private _triggerRestart() {
    // Clear existing debounce timer
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }

    // Debounce the restart to avoid multiple rapid restarts
    this._debounceTimer = setTimeout(async () => {
      try {
        await this._options.onRestart();
        logger.info('Restart triggered successfully');
      } catch (error) {
        logger.error('Error during restart:', error);
      }
    }, this._options.debounceMs);
  }

  stop() {
    logger.info('Stopping file watcher');
    this._isWatching = false;

    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }

    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  }
}
