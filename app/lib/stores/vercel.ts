import { map } from 'nanostores';

// Stub vercel store for backward compatibility
export const vercelConnection = map<{ user: any | null }>({
  user: null,
});
