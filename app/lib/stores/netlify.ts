import { map } from 'nanostores';

// Stub netlify store for backward compatibility
export const netlifyConnection = map<{ user: any | null }>({
  user: null,
});
