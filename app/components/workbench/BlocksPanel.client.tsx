/**
 * BlocksPanel.client.tsx
 *
 * Left-sidebar blocks palette for the GrapeJS visual editor.
 * Rendered inside BaseChat when the user activates the Blocks tab.
 * Waits for the GrapeJS editor to be ready (from visualEditorAtom),
 * then mounts the GrapeJS block manager UI into this component.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import {
  visualEditorAtom,
  visualEditorHtmlAtom,
  visualEditorCssAtom,
  visualEditorPagesAtom,
  visualEditorCurrentPageAtom,
} from '~/lib/stores/visualEditorStore';
import { toast } from 'react-toastify';

export const BlocksPanel = memo(() => {
  const blocksContainerRef = useRef<HTMLDivElement>(null);
  const editor = useStore(visualEditorAtom);
  const [searchQuery, setSearchQuery] = useState('');
  const [isRendered, setIsRendered] = useState(false);
  const html = useStore(visualEditorHtmlAtom);
  const css = useStore(visualEditorCssAtom);
  const pages = useStore(visualEditorPagesAtom);
  const currentPage = useStore(visualEditorCurrentPageAtom);

  // Mount GrapeJS block manager into our container
  useEffect(() => {
    if (!editor || !blocksContainerRef.current) {
      return;
    }

    try {
      const bm = editor.BlockManager ?? editor.Blocks;

      if (!bm) {
        return;
      }

      /*
       * GrapeJS appendTo trick: set appendTo to our container, then call render()
       * This is the documented approach for embedding blocks in a custom container
       */
      bm.config.appendTo = blocksContainerRef.current;

      const el = bm.render();

      if (el && blocksContainerRef.current) {
        // Clear and re-append in case of re-renders
        blocksContainerRef.current.innerHTML = '';
        blocksContainerRef.current.appendChild(el);
        setIsRendered(true);
      }
    } catch (err) {
      console.error('[BlocksPanel] Failed to render blocks:', err);
    }
  }, [editor]);

  // Reset when editor changes (e.g. destroyed and re-created)
  useEffect(() => {
    setIsRendered(false);
  }, [editor]);

  // Search filter — show/hide matching blocks in the DOM
  useEffect(() => {
    if (!blocksContainerRef.current) {
      return;
    }

    const q = searchQuery.toLowerCase().trim();
    const blockEls = blocksContainerRef.current.querySelectorAll<HTMLElement>('.gjs-block');

    blockEls.forEach((el) => {
      const label = (el.querySelector('.gjs-block-label')?.textContent ?? el.title ?? '').toLowerCase();
      el.style.display = !q || label.includes(q) ? '' : 'none';
    });
  }, [searchQuery, isRendered]);

  const handleUseInChat = () => {
    if (!html || html.trim() === '<body></body>' || html.trim() === '') {
      toast.info('Add some blocks to the canvas first, then click "Use in Chat".');
      return;
    }

    const prompt = [
      'I designed the following page layout in the visual builder. Please use this as a starting point and convert it into a fully polished, styled webpage with proper CSS:',
      '',
      '```html',
      '<!DOCTYPE html>',
      '<html>',
      '<head>',
      '<meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      css ? `<style>\n${css}\n</style>` : '',
      '</head>',
      '<body>',
      html,
      '</body>',
      '</html>',
      '```',
    ]
      .filter((line) => line !== null)
      .join('\n');

    navigator.clipboard
      .writeText(prompt)
      .then(() => {
        toast.success('HTML copied! Switch to Chat tab and paste it.');
      })
      .catch(() => {
        console.log('[VisualEditor Export]', prompt);
        toast.info('Could not copy automatically — check the browser console.');
      });
  };

  const [activeTab, setActiveTab] = useState<'blocks' | 'pages'>('blocks');
  const showPagesTabs = pages.length > 1;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bolt-elements-background-depth-2">
      {/* Tab bar — only show tabs when multiple pages exist */}
      {showPagesTabs && (
        <div className="flex shrink-0 border-b border-bolt-elements-borderColor">
          <button
            onClick={() => setActiveTab('blocks')}
            className={`flex-1 px-3 py-2.5 text-xs font-semibold transition-colors relative ${
              activeTab === 'blocks'
                ? 'text-purple-400'
                : 'text-bolt-elements-textTertiary hover:text-bolt-elements-textSecondary'
            }`}
          >
            Building blocks
            {activeTab === 'blocks' && (
              <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-purple-500 rounded-full" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('pages')}
            className={`flex-1 px-3 py-2.5 text-xs font-semibold transition-colors relative ${
              activeTab === 'pages'
                ? 'text-purple-400'
                : 'text-bolt-elements-textTertiary hover:text-bolt-elements-textSecondary'
            }`}
          >
            Pages
            {activeTab === 'pages' && (
              <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-purple-500 rounded-full" />
            )}
          </button>
        </div>
      )}

      {/* ── Blocks tab content ── */}
      <div
        className="flex flex-col flex-1 overflow-hidden"
        style={{ display: activeTab === 'blocks' || !showPagesTabs ? 'flex' : 'none' }}
      >
        {/* Search header */}
        <div className="px-3 pt-3 pb-2 border-b border-bolt-elements-borderColor shrink-0">
          <p className="text-[11px] font-semibold text-bolt-elements-textTertiary uppercase tracking-wide mb-2">
            Drag blocks onto the canvas →
          </p>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-bolt-elements-textTertiary pointer-events-none">
              <span className="i-ph:magnifying-glass text-sm" />
            </span>
            <input
              type="text"
              placeholder="Search blocks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-7 pr-3 py-1.5 text-xs rounded-lg bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary focus:outline-none focus:ring-1 focus:ring-purple-500/50"
            />
          </div>
        </div>

        {/* Blocks list — GrapeJS renders into this div */}
        <div className="flex-1 overflow-y-auto modern-scrollbar min-h-0">
          {!editor ? (
            <div className="p-3 flex flex-wrap gap-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="w-[80px] h-[70px] rounded-lg bg-bolt-elements-background-depth-3 animate-pulse border border-bolt-elements-borderColor"
                />
              ))}
            </div>
          ) : (
            <div ref={blocksContainerRef} className="gjs-blocks-panel-mount" />
          )}
        </div>

        {/* Footer — Use in Chat */}
        <div className="px-3 py-2 border-t border-bolt-elements-borderColor shrink-0 flex flex-col gap-1.5">
          <button
            onClick={handleUseInChat}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-lg bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30 transition-colors font-medium"
            title="Copy current canvas HTML to clipboard"
          >
            <span className="i-ph:copy text-sm" />
            Use in Chat
          </button>
          <p className="text-[10px] text-bolt-elements-textTertiary text-center">
            Copies HTML to clipboard — paste into chat to refine with AI
          </p>
        </div>
      </div>

      {/* ── Pages tab content ── */}
      {activeTab === 'pages' && showPagesTabs && (
        <div className="flex-1 overflow-y-auto modern-scrollbar px-3 py-3">
          <div className="flex flex-col gap-1">
            {pages.map((pagePath) => {
              const pageName = pagePath.split('/').pop()?.replace('.html', '') || pagePath;
              const isActive = pagePath === currentPage;

              return (
                <button
                  key={pagePath}
                  onClick={() => {
                    visualEditorCurrentPageAtom.set(pagePath);
                    setActiveTab('blocks'); // Switch back to blocks after selecting a page
                  }}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
                    isActive
                      ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                      : 'text-bolt-elements-textSecondary hover:bg-bolt-elements-item-backgroundActive border border-transparent hover:border-bolt-elements-borderColor'
                  }`}
                  title={pagePath}
                >
                  <span
                    className={`i-ph:file-html text-base ${isActive ? 'text-purple-400' : 'text-bolt-elements-textTertiary'}`}
                  />
                  <span className="capitalize truncate">{pageName}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});

BlocksPanel.displayName = 'BlocksPanel';
