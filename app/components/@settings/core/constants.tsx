import type { TabType } from './types';
import { User, Settings, Bell, Star, Database, Laptop, Github, Wrench, List } from 'lucide-react';

// GitLab icon component
const GitLabIcon = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4">
    <path
      fill="currentColor"
      d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z"
    />
  </svg>
);

export const TAB_ICONS: Record<TabType, React.ComponentType<{ className?: string }>> = {
  profile: User,
  settings: Settings,
  notifications: Bell,
  features: Star,
  data: Database,
  'local-providers': Laptop,
  github: Github,
  gitlab: () => <GitLabIcon />,
  'event-logs': List,
  mcp: Wrench,
};

export const TAB_LABELS: Record<TabType, string> = {
  profile: 'Profile',
  settings: 'Settings',
  notifications: 'Notifications',
  features: 'Features',
  data: 'Data Management',
  'local-providers': 'Local Providers',
  github: 'GitHub',
  gitlab: 'GitLab',
  'event-logs': 'Event Logs',
  mcp: 'MCP Servers',
};

export const TAB_DESCRIPTIONS: Record<TabType, string> = {
  profile: 'Manage your profile and account settings',
  settings: 'Configure application preferences',
  notifications: 'View and manage your notifications',
  features: 'Explore new and upcoming features',
  data: 'Manage your data and storage',
  'local-providers': 'Configure local AI providers and models',
  github: 'Connect and manage GitHub integration',
  gitlab: 'Connect and manage GitLab integration',
  'event-logs': 'View system events and logs',
  mcp: 'Configure MCP (Model Context Protocol) servers',
};

export const DEFAULT_TAB_CONFIG = [
  // User Window Tabs (Always visible by default)
  { id: 'features', visible: true, window: 'user' as const, order: 0 },
  { id: 'data', visible: true, window: 'user' as const, order: 1 },
  { id: 'local-providers', visible: true, window: 'user' as const, order: 2 },
  { id: 'github', visible: true, window: 'user' as const, order: 3 },
  { id: 'gitlab', visible: true, window: 'user' as const, order: 4 },
  { id: 'notifications', visible: true, window: 'user' as const, order: 5 },
  { id: 'event-logs', visible: true, window: 'user' as const, order: 6 },
  { id: 'mcp', visible: true, window: 'user' as const, order: 7 },

  // User Window Tabs (In dropdown, initially hidden)
];
