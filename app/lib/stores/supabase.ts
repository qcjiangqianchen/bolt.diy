import { atom, map } from 'nanostores';

/*
 * Stub supabase store for backward compatibility
 * Supabase functionality is disabled but keeping the store prevents breaking changes
 */
export interface SupabaseConnection {
  isConnected: boolean;
  user: any | null;
  token: string;
  selectedProject?: string;
  selectedProjectId?: string;
  project?: { id: string; name: string; region: string };
  projects?: any[];
  stats?: {
    totalProjects?: number;
    projects?: Array<{ id: string; name: string; region: string }>;
  };
  credentials?: {
    anonKey?: string;
    supabaseUrl?: string;
  };
}

export const supabaseConnection = map<SupabaseConnection>({
  isConnected: false,
  user: null,
  token: '',
  selectedProject: undefined,
  selectedProjectId: undefined,
  projects: [],
});

export const isConnecting = atom<boolean>(false);
export const isFetchingStats = atom<boolean>(false);
export const isFetchingApiKeys = atom<boolean>(false);

export const updateSupabaseConnection = (update: Partial<SupabaseConnection>) => {
  supabaseConnection.set({ ...supabaseConnection.get(), ...update });
};

export const initializeSupabaseConnection = async () => {
  // Stub - Supabase disabled
  return false;
};

export const fetchSupabaseStats = async (_token?: string) => {
  // Stub - Supabase disabled
  return null;
};

export const fetchProjectApiKeys = async (_projectId?: string, _token?: string) => {
  // Stub - Supabase disabled
  return [];
};
