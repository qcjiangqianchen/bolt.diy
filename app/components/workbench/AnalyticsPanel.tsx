import { memo, useEffect, useState, useCallback } from 'react';
import { useStore } from '@nanostores/react';
import { chatMetadata } from '~/lib/persistence/useChatHistory';

interface AnalyticsData {
  totalViews: number;
  uniqueSessions: number;
  topPages: { path: string; views: number }[];
  viewsByHour: { hour: string; views: number }[];
  viewsByDay: { day: string; views: number }[];
}

export const AnalyticsPanel = memo(() => {
  const metadata = useStore(chatMetadata);
  const deployedUrl = metadata?.deployedUrl;

  // Extract app name from URL like https://my-app.fly.dev
  const appName = deployedUrl ? new URL(deployedUrl).hostname.split('.')[0] : null;

  const [data, setData] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = useCallback(async () => {
    if (!appName) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const resp = await fetch(`/api/analytics?app=${encodeURIComponent(appName)}`);

      if (!resp.ok) {
        throw new Error(`Failed to load analytics (${resp.status})`);
      }

      const json = (await resp.json()) as AnalyticsData;
      setData(json);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setIsLoading(false);
    }
  }, [appName]);

  useEffect(() => {
    fetchAnalytics();

    // Auto-refresh every 30 seconds
    const timer = setInterval(fetchAnalytics, 30000);

    return () => clearInterval(timer);
  }, [fetchAnalytics]);

  if (!deployedUrl) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center">
        <div className="i-ph:chart-bar-duotone text-6xl text-bolt-elements-textTertiary mb-4" />
        <h3 className="text-lg font-semibold text-bolt-elements-textPrimary mb-2">No Deployed App</h3>
        <p className="text-sm text-bolt-elements-textSecondary max-w-xs">
          Deploy your application to Fly.io using the <strong>Deploy</strong> button at the top right to start tracking
          analytics.
        </p>
      </div>
    );
  }

  const maxViews = Math.max(...(data?.topPages.map((p) => p.views) || [1]), 1);
  const maxDayViews = Math.max(...(data?.viewsByDay.map((d) => d.views) || [1]), 1);

  return (
    <div className="w-full h-full flex flex-col overflow-auto bg-bolt-elements-background-depth-1">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 shrink-0">
        <div className="flex items-center gap-2">
          <div className="i-ph:chart-bar text-lg text-purple-500" />
          <span className="text-sm font-semibold text-bolt-elements-textPrimary">App Analytics</span>
          <a
            href={deployedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-purple-500 hover:text-purple-400 truncate max-w-[200px] transition-colors"
            title={deployedUrl}
          >
            {deployedUrl.replace('https://', '')}
          </a>
        </div>
        <div className="flex items-center gap-2">
          {lastRefresh && (
            <span className="text-xs text-bolt-elements-textTertiary">
              Updated {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={fetchAnalytics}
            disabled={isLoading}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-bolt-elements-background-depth-3 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-colors disabled:opacity-50"
          >
            <span className={`i-ph:arrow-clockwise text-sm ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-500 flex items-center gap-2 shrink-0">
          <span className="i-ph:warning-circle" />
          {error}
        </div>
      )}

      <div className="flex-1 p-4 space-y-4">
        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard icon="i-ph:eye" label="Total Views" value={data?.totalViews ?? 0} color="purple" />
          <StatCard icon="i-ph:users" label="Unique Sessions" value={data?.uniqueSessions ?? 0} color="blue" />
          <StatCard icon="i-ph:star" label="Top Page" value={data?.topPages[0]?.path ?? '—'} color="green" isString />
        </div>

        {/* Daily Sparkline (last 7 days) */}
        <div className="bg-bolt-elements-background-depth-2 rounded-xl p-4 border border-bolt-elements-borderColor">
          <h4 className="text-xs font-semibold text-bolt-elements-textSecondary uppercase tracking-wide mb-3">
            Views Last 7 Days
          </h4>
          <div className="flex items-end gap-1.5 h-20">
            {(data?.viewsByDay ?? Array(7).fill({ day: '', views: 0 })).map((d, i) => {
              const pct = maxDayViews > 0 ? (d.views / maxDayViews) * 100 : 0;
              const label = d.day ? new Date(d.day + 'T00:00:00').toLocaleDateString([], { weekday: 'short' }) : '';

              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex flex-col-reverse" style={{ height: '56px' }}>
                    <div
                      className="w-full rounded-t bg-purple-500/70 hover:bg-purple-500 transition-all duration-200"
                      style={{ height: `${Math.max(pct, d.views > 0 ? 5 : 0)}%` }}
                      title={`${d.day}: ${d.views} views`}
                    />
                  </div>
                  <span className="text-[10px] text-bolt-elements-textTertiary">{label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top Pages */}
        <div className="bg-bolt-elements-background-depth-2 rounded-xl p-4 border border-bolt-elements-borderColor">
          <h4 className="text-xs font-semibold text-bolt-elements-textSecondary uppercase tracking-wide mb-3">
            Top Pages
          </h4>
          {!data || data.topPages.length === 0 ? (
            <EmptyState message="No page views recorded yet." />
          ) : (
            <div className="space-y-2">
              {data.topPages.map((page, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-bolt-elements-textTertiary w-4 text-right shrink-0">{i + 1}</span>
                  <span
                    className="text-xs font-mono text-bolt-elements-textPrimary truncate flex-1 min-w-0"
                    title={page.path}
                  >
                    {page.path}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="w-24 h-1.5 rounded-full bg-bolt-elements-background-depth-3 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-purple-500 transition-all duration-300"
                        style={{ width: `${(page.views / maxViews) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-bolt-elements-textSecondary w-8 text-right">{page.views}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Hourly Activity (last 24h) */}
        <div className="bg-bolt-elements-background-depth-2 rounded-xl p-4 border border-bolt-elements-borderColor">
          <h4 className="text-xs font-semibold text-bolt-elements-textSecondary uppercase tracking-wide mb-3">
            Hourly Activity (Last 24 Hours)
          </h4>
          <div className="flex items-end gap-px h-10">
            {(data?.viewsByHour ?? Array(24).fill({ hour: '', views: 0 })).map((h, i) => {
              const maxH = Math.max(...(data?.viewsByHour.map((x) => x.views) || [1]), 1);
              const pct = maxH > 0 ? (h.views / maxH) * 100 : 0;

              return (
                <div
                  key={i}
                  className="flex-1 flex flex-col-reverse"
                  style={{ height: '40px' }}
                  title={`${h.hour ? new Date(h.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}: ${h.views} views`}
                >
                  <div
                    className="w-full rounded-t bg-blue-500/60 hover:bg-blue-500 transition-colors"
                    style={{ height: `${Math.max(pct, h.views > 0 ? 8 : 0)}%` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-bolt-elements-textTertiary">24h ago</span>
            <span className="text-[10px] text-bolt-elements-textTertiary">Now</span>
          </div>
        </div>

        {/* No data yet notice */}
        {data?.totalViews === 0 && (
          <div className="px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600 dark:text-amber-400">
            <div className="flex items-start gap-2">
              <span className="i-ph:info mt-0.5 shrink-0" />
              <div>
                <strong>No page views recorded yet.</strong>
                <br />
                Analytics tracking is collected when users visit{' '}
                <a href={deployedUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  {deployedUrl.replace('https://', '')}
                </a>
                . Make sure <code className="bg-amber-500/20 px-1 rounded">PUBLIC_BOLT_URL</code> is set in your
                bolt.diy environment so the tracker script can reach this server.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

function StatCard({
  icon,
  label,
  value,
  color,
  isString = false,
}: {
  icon: string;
  label: string;
  value: number | string;
  color: 'purple' | 'blue' | 'green';
  isString?: boolean;
}) {
  const colorClass = {
    purple: 'text-purple-500 bg-purple-500/10',
    blue: 'text-blue-500 bg-blue-500/10',
    green: 'text-green-500 bg-green-500/10',
  }[color];

  return (
    <div className="bg-bolt-elements-background-depth-2 rounded-xl p-3 border border-bolt-elements-borderColor">
      <div className={`inline-flex p-1.5 rounded-lg ${colorClass} mb-2`}>
        <span className={`${icon} text-base`} />
      </div>
      <div className={`text-lg font-bold text-bolt-elements-textPrimary truncate ${isString ? 'text-sm' : ''}`}>
        {isString ? value : value.toLocaleString()}
      </div>
      <div className="text-xs text-bolt-elements-textTertiary mt-0.5">{label}</div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-4 text-xs text-bolt-elements-textTertiary">
      <span className="i-ph:chart-bar-duotone text-2xl block mx-auto mb-1 opacity-40" />
      {message}
    </div>
  );
}
