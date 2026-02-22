import { atom } from 'nanostores';
import type { GitHubConnection } from '~/types/GitHub';
import { logStore } from './logs';

// Initialize with stored connection or defaults
const storedConnection = typeof window !== 'undefined' ? localStorage.getItem('github_connection') : null;
const initialConnection: GitHubConnection = storedConnection
  ? JSON.parse(storedConnection)
  : {
      user: null,
      token: '',
      tokenType: 'classic',
    };

export const githubConnection = atom<GitHubConnection>(initialConnection);
export const isConnecting = atom<boolean>(false);
export const isFetchingStats = atom<boolean>(false);

// Function to initialize GitHub connection via server-side API
export async function initializeGitHubConnection() {
  const currentState = githubConnection.get();

  // If we already have a connection, don't override it
  if (currentState.user) {
    return;
  }

  try {
    isConnecting.set(true);

    /*
     * Stub - GitHub API disabled for settings
     * Only basic connection without server-side validation
     */
    logStore.logSystem('GitHub API integration is disabled');
  } catch (error) {
    console.error('Error initializing GitHub connection:', error);
    logStore.logError('Failed to initialize GitHub connection', { error });
  } finally {
    isConnecting.set(false);
  }
}

// Function to fetch GitHub stats via server-side API
export async function fetchGitHubStatsViaAPI() {
  // Stub - GitHub stats API disabled
  return null;
}

export const updateGitHubConnection = (updates: Partial<GitHubConnection>) => {
  const currentState = githubConnection.get();
  const newState = { ...currentState, ...updates };
  githubConnection.set(newState);

  // Persist to localStorage
  if (typeof window !== 'undefined') {
    localStorage.setItem('github_connection', JSON.stringify(newState));
  }
};
