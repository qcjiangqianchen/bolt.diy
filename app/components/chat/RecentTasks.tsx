import { useEffect, useState, useCallback, useMemo } from 'react';
import { db, getAll, type ChatHistoryItem } from '~/lib/persistence';

const TASKS_PER_PAGE = 5;

function formatRelativeDate(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) {
    return 'Just now';
  }

  if (diffMins < 60) {
    return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
  }

  if (diffHours < 24) {
    return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  }

  if (diffDays < 7) {
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  }

  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
  }

  return date.toLocaleDateString();
}

function truncateId(id: string): string {
  if (id.length <= 8) {
    return id;
  }

  return id.substring(0, 7);
}

export function RecentTasks() {
  const [allTasks, setAllTasks] = useState<ChatHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);

  const loadTasks = useCallback(() => {
    if (!db) {
      setLoading(false);
      return;
    }

    getAll(db)
      .then((list) => {
        const filtered = list
          .filter((item) => item.urlId && item.description)
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setAllTasks(filtered);
        setCurrentPage(1);
      })
      .catch((err) => console.error('Failed to load recent tasks:', err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const totalPages = Math.max(1, Math.ceil(allTasks.length / TASKS_PER_PAGE));
  const startIndex = (currentPage - 1) * TASKS_PER_PAGE;
  const endIndex = startIndex + TASKS_PER_PAGE;
  const pageTasks = useMemo(() => allTasks.slice(startIndex, endIndex), [allTasks, startIndex, endIndex]);

  const showingStart = allTasks.length === 0 ? 0 : startIndex + 1;
  const showingEnd = Math.min(endIndex, allTasks.length);

  if (loading) {
    return (
      <div className="w-full max-w-chat mx-auto mt-8 px-4">
        <div className="flex items-center gap-2 mb-4">
          <span className="i-ph:clock-counter-clockwise text-bolt-elements-textSecondary text-lg" />
          <h2 className="text-sm font-medium text-bolt-elements-textSecondary">Recent Tasks</h2>
        </div>
        <div className="animate-pulse space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded-lg bg-bolt-elements-background-depth-3" />
          ))}
        </div>
      </div>
    );
  }

  if (allTasks.length === 0) {
    return null;
  }

  return (
    <div className="w-full max-w-chat mx-auto pb-4 px-4" style={{ marginTop: '80px' }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="i-ph:clock-counter-clockwise text-bolt-elements-textSecondary text-lg" />
          <h2 className="text-xl font-medium text-bolt-elements-textSecondary">Recent Tasks</h2>
        </div>
        <button
          onClick={loadTasks}
          className="text-bolt-elements-textTertiary hover:text-bolt-elements-textSecondary transition-colors"
          title="Refresh"
        >
          <span className="i-ph:arrow-clockwise text-sm" />
        </button>
      </div>

      <div className="rounded-xl border border-bolt-elements-borderColor overflow-hidden bg-bolt-elements-background-depth-2">
        {/* Table header */}
        <div className="grid grid-cols-[1fr_2fr_auto] gap-4 px-4 py-2.5 text-xs font-medium text-bolt-elements-textTertiary uppercase tracking-wider border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-3">
          <span>ID</span>
          <span>Task</span>
          <span>Last Modified</span>
        </div>

        {/* Fixed-height rows container — always fits exactly 5 rows */}
        <div style={{ minHeight: `${TASKS_PER_PAGE * 48}px` }}>
          {pageTasks.map((task, index) => (
            <a
              key={task.id}
              href={`/chat/${task.urlId}`}
              className={`grid grid-cols-[1fr_2fr_auto] gap-4 px-4 items-center hover:bg-bolt-elements-item-backgroundActive transition-colors group ${
                index < pageTasks.length - 1 ? 'border-b border-bolt-elements-borderColor' : ''
              }`}
              style={{ height: '48px' }}
            >
              <span className="text-xs text-bolt-elements-textTertiary font-mono truncate">
                {truncateId(task.urlId || task.id)}
              </span>
              <div className="min-w-0">
                <p className="text-sm text-bolt-elements-textPrimary truncate group-hover:text-bolt-elements-textPrimary font-medium">
                  {task.description}
                </p>
              </div>
              <span className="text-xs text-bolt-elements-textTertiary whitespace-nowrap">
                {formatRelativeDate(task.timestamp)}
              </span>
            </a>
          ))}
        </div>

        {/* Pagination footer */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-bolt-elements-borderColor bg-bolt-elements-background-depth-3 text-xs text-bolt-elements-textTertiary">
          <span>
            Showing {showingStart}-{showingEnd} out of {allTasks.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-1 rounded hover:bg-bolt-elements-item-backgroundActive disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <span className="i-ph:caret-left text-sm" />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                onClick={() => setCurrentPage(page)}
                className={`min-w-[24px] h-6 rounded text-xs transition-colors ${
                  page === currentPage
                    ? 'bg-bolt-elements-button-primary-background text-bolt-elements-button-primary-text'
                    : 'hover:bg-bolt-elements-item-backgroundActive text-bolt-elements-textSecondary'
                }`}
              >
                {page}
              </button>
            ))}
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-1 rounded hover:bg-bolt-elements-item-backgroundActive disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <span className="i-ph:caret-right text-sm" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
