import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { db, getAll, deleteById, updateChatDescription, type ChatHistoryItem } from '~/lib/persistence';

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

interface TaskRowMenuProps {
  task: ChatHistoryItem;
  onRename: (task: ChatHistoryItem) => void;
  onDelete: (task: ChatHistoryItem) => void;
}

function TaskRowMenu({ task, onRename, onDelete }: TaskRowMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return () => {
        /* no-op */
      };
    }

    function handleClickOutside(e: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        !buttonRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);

    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="relative flex items-center justify-end" style={{ minWidth: '32px' }}>
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="p-1 rounded hover:bg-bolt-elements-item-backgroundActive text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
        title="More options"
        aria-label="More options"
      >
        <span className="i-ph:dots-three-bold text-base" />
      </button>

      {open && (
        <div
          ref={menuRef}
          className="absolute right-0 top-8 z-50 min-w-[140px] rounded-xl bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor shadow-xl py-1"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive transition-colors text-left"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              onRename(task);
            }}
          >
            <span className="i-ph:pencil text-sm text-bolt-elements-textSecondary" />
            Rename
          </button>
          <button
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-500 hover:bg-red-500/10 transition-colors text-left"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              onDelete(task);
            }}
          >
            <span className="i-ph:trash text-sm" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

export function RecentTasks() {
  const [allTasks, setAllTasks] = useState<ChatHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);

  // Rename state
  const [renamingTask, setRenamingTask] = useState<ChatHistoryItem | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Delete confirmation state
  const [deletingTask, setDeletingTask] = useState<ChatHistoryItem | null>(null);

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

  // Focus rename input when it opens
  useEffect(() => {
    if (renamingTask) {
      setTimeout(() => renameInputRef.current?.focus(), 50);
    }
  }, [renamingTask]);

  const handleRenameStart = useCallback((task: ChatHistoryItem) => {
    setRenamingTask(task);
    setRenameInput(task.description || '');
  }, []);

  const handleRenameSubmit = useCallback(async () => {
    if (!renamingTask || !db) {
      return;
    }

    const trimmed = renameInput.trim();

    if (!trimmed || trimmed === renamingTask.description) {
      setRenamingTask(null);
      return;
    }

    try {
      await updateChatDescription(db, renamingTask.id, trimmed);
      loadTasks();
    } catch (err) {
      console.error('Failed to rename task:', err);
    }

    setRenamingTask(null);
  }, [renamingTask, renameInput, loadTasks]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deletingTask || !db) {
      return;
    }

    try {
      // Remove snapshot from localStorage
      try {
        localStorage.removeItem(`snapshot:${deletingTask.id}`);
      } catch {
        // ignore
      }

      await deleteById(db, deletingTask.id);
      loadTasks();
    } catch (err) {
      console.error('Failed to delete task:', err);
    }

    setDeletingTask(null);
  }, [deletingTask, loadTasks]);

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
        <div className="grid grid-cols-[80px_1fr_120px_180px_40px] gap-4 px-4 py-2.5 text-xs font-medium text-bolt-elements-textTertiary uppercase tracking-wider border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-3">
          <span>ID</span>
          <span>Task</span>
          <span>Last Modified</span>
          <span>Status</span>
          <span />
        </div>

        {/* Fixed-height rows container — always fits exactly 5 rows */}
        <div style={{ minHeight: `${TASKS_PER_PAGE * 48}px` }}>
          {pageTasks.map((task, index) => (
            <a
              key={task.id}
              href={`/chat/${task.urlId}`}
              className={`grid grid-cols-[80px_1fr_120px_180px_40px] gap-4 px-4 items-center hover:bg-bolt-elements-item-backgroundActive transition-colors group ${
                index < pageTasks.length - 1 ? 'border-b border-bolt-elements-borderColor' : ''
              }`}
              style={{ height: '48px' }}
            >
              <span className="text-xs text-bolt-elements-textTertiary font-mono truncate">
                {truncateId(task.urlId || task.id)}
              </span>
              <div className="min-w-0">
                {renamingTask?.id === task.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleRenameSubmit();
                    }}
                    onClick={(e) => e.preventDefault()}
                  >
                    <input
                      ref={renameInputRef}
                      value={renameInput}
                      onChange={(e) => setRenameInput(e.target.value)}
                      onBlur={handleRenameSubmit}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setRenamingTask(null);
                        }
                      }}
                      className="text-sm text-bolt-elements-textPrimary bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor rounded px-2 py-0.5 w-full focus:outline-none focus:ring-1 focus:ring-purple-500/50"
                      onClick={(e) => e.preventDefault()}
                    />
                  </form>
                ) : (
                  <p className="text-sm text-bolt-elements-textPrimary truncate group-hover:text-bolt-elements-textPrimary font-medium">
                    {task.description}
                  </p>
                )}
              </div>
              <span className="text-xs text-bolt-elements-textTertiary whitespace-nowrap">
                {formatRelativeDate(task.timestamp)}
              </span>
              {/* Status column */}
              <div className="flex items-center gap-2" onClick={(e) => e.preventDefault()}>
                {task.metadata?.deployedUrl ? (
                  <>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20 whitespace-nowrap">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                      Deployed
                    </span>
                    <a
                      href={task.metadata.deployedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 border border-purple-500/20 transition-colors whitespace-nowrap"
                    >
                      <span className="i-ph:globe text-sm" />
                      Visit App
                    </a>
                  </>
                ) : (
                  <span className="text-xs text-bolt-elements-textTertiary">—</span>
                )}
              </div>
              {/* ⋯ Menu */}
              <div onClick={(e) => e.preventDefault()}>
                <TaskRowMenu task={task} onRename={handleRenameStart} onDelete={(t) => setDeletingTask(t)} />
              </div>
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

      {/* Delete confirmation dialog */}
      {deletingTask && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40"
          onClick={() => setDeletingTask(null)}
        >
          <div
            className="bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-bolt-elements-textPrimary mb-2">Delete Chat?</h3>
            <p className="text-sm text-bolt-elements-textSecondary mb-4">
              Are you sure you want to delete{' '}
              <span className="font-medium text-bolt-elements-textPrimary">{deletingTask.description}</span>? This
              cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeletingTask(null)}
                className="px-4 py-1.5 rounded-lg text-sm border border-bolt-elements-borderColor hover:bg-bolt-elements-item-backgroundActive text-bolt-elements-textSecondary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="px-4 py-1.5 rounded-lg text-sm bg-red-500 hover:bg-red-600 text-white font-medium transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
