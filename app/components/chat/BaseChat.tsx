/*
 * @ts-nocheck
 * Preventing TS checks with files presented in the video for a better presentation.
 */
import type { JSONValue, Message } from 'ai';
import React, { type RefCallback, useEffect, useState } from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import { Menu } from '~/components/sidebar/Menu.client';
import { Workbench } from '~/components/workbench/Workbench.client';
import { classNames } from '~/utils/classNames';
import { Messages } from './Messages.client';
import { workbenchStore } from '~/lib/stores/workbench';
import * as Tooltip from '@radix-ui/react-tooltip';
import styles from './BaseChat.module.scss';
import { ImportButtons } from '~/components/chat/chatExportAndImport/ImportButtons';
import { ExamplePrompts } from '~/components/chat/ExamplePrompts';
import { RecentTasks } from '~/components/chat/RecentTasks';
import GitCloneButton from './GitCloneButton';
import type { ActionAlert, SupabaseAlert, DeployAlert, LlmErrorAlertType } from '~/types/actions';
import DeployChatAlert from '~/components/deploy/DeployAlert';
import ChatAlert from './ChatAlert';
import ProgressCompilation from './ProgressCompilation';
import type { ProgressAnnotation } from '~/types/context';
import { SupabaseChatAlert } from '~/components/chat/SupabaseAlert';
import { expoUrlAtom } from '~/lib/stores/qrCodeStore';
import { useStore } from '@nanostores/react';
import { StickToBottom, useStickToBottomContext } from '~/lib/hooks';
import { ChatBox } from './ChatBox';
import type { DesignScheme } from '~/types/design-scheme';
import type { ElementInfo } from '~/components/workbench/Inspector';
import LlmErrorAlert from './LLMApiAlert';
import { HeaderActionButtons } from '~/components/header/HeaderActionButtons.client';
import { BlocksPanel } from '~/components/workbench/BlocksPanel.client';

const TEXTAREA_MIN_HEIGHT = 114;

interface BaseChatProps {
  textareaRef?: React.RefObject<HTMLTextAreaElement> | undefined;
  messageRef?: RefCallback<HTMLDivElement> | undefined;
  scrollRef?: RefCallback<HTMLDivElement> | undefined;
  showChat?: boolean;
  chatStarted?: boolean;
  isStreaming?: boolean;
  onStreamingChange?: (streaming: boolean) => void;
  messages?: Message[];
  description?: string;
  enhancingPrompt?: boolean;
  promptEnhanced?: boolean;
  input?: string;
  handleStop?: () => void;
  sendMessage?: (event: React.UIEvent, messageInput?: string) => void;
  handleInputChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  enhancePrompt?: () => void;
  importChat?: (description: string, messages: Message[]) => Promise<void>;
  exportChat?: () => void;
  uploadedFiles?: File[];
  setUploadedFiles?: (files: File[]) => void;
  imageDataList?: string[];
  setImageDataList?: (dataList: string[]) => void;
  actionAlert?: ActionAlert;
  clearAlert?: () => void;
  supabaseAlert?: SupabaseAlert;
  clearSupabaseAlert?: () => void;
  deployAlert?: DeployAlert;
  clearDeployAlert?: () => void;
  llmErrorAlert?: LlmErrorAlertType;
  clearLlmErrorAlert?: () => void;
  data?: JSONValue[] | undefined;
  chatMode?: 'discuss' | 'build';
  setChatMode?: (mode: 'discuss' | 'build') => void;
  append?: (message: Message) => void;
  designScheme?: DesignScheme;
  setDesignScheme?: (scheme: DesignScheme) => void;
  selectedElement?: ElementInfo | null;
  setSelectedElement?: (element: ElementInfo | null) => void;
  addToolResult?: ({ toolCallId, result }: { toolCallId: string; result: any }) => void;
}

export const BaseChat = React.forwardRef<HTMLDivElement, BaseChatProps>(
  (
    {
      textareaRef,
      showChat = true,
      chatStarted = false,
      isStreaming = false,
      onStreamingChange,
      input = '',
      enhancingPrompt,
      handleInputChange,

      // promptEnhanced,
      enhancePrompt,
      sendMessage,
      handleStop,
      importChat,
      exportChat,
      uploadedFiles = [],
      setUploadedFiles,
      imageDataList = [],
      setImageDataList,
      messages,
      actionAlert,
      clearAlert,
      deployAlert,
      clearDeployAlert,
      supabaseAlert,
      clearSupabaseAlert,
      llmErrorAlert,
      clearLlmErrorAlert,
      data,
      chatMode,
      setChatMode,
      append,
      designScheme,
      setDesignScheme,
      selectedElement,
      setSelectedElement,
      addToolResult = () => {
        throw new Error('addToolResult not implemented');
      },
    },
    ref,
  ) => {
    const TEXTAREA_MAX_HEIGHT = chatStarted ? 600 : 300;
    const [isListening, setIsListening] = useState(false);
    const [recognition, setRecognition] = useState<SpeechRecognition | null>(null);
    const [transcript, setTranscript] = useState('');
    const [progressAnnotations, setProgressAnnotations] = useState<ProgressAnnotation[]>([]);
    const expoUrl = useStore(expoUrlAtom);
    const [qrModalOpen, setQrModalOpen] = useState(false);
    const [chatWidthPercent, setChatWidthPercent] = useState(33.33); // Default 1/3 width
    const [isResizing, setIsResizing] = useState(false);
    const showWorkbench = useStore(workbenchStore.showWorkbench);
    const resizeStartX = React.useRef<number>(0);
    const resizeStartWidth = React.useRef<number>(33.33);

    // Panel toggle: 'chat' shows the AI chat, 'blocks' shows the GrapeJS blocks palette
    const [activeLeftPanel, setActiveLeftPanel] = useState<'chat' | 'blocks'>('chat');

    const switchToBlocks = () => {
      setActiveLeftPanel('blocks');

      // Also switch workbench to visual builder mode
      if (!workbenchStore.showWorkbench.get()) {
        workbenchStore.showWorkbench.set(true);
      }

      workbenchStore.currentView.set('visual');
    };

    const switchToChat = () => {
      setActiveLeftPanel('chat');

      // Return workbench to preview if it was in visual mode
      if (workbenchStore.currentView.get() === 'visual') {
        workbenchStore.currentView.set('preview');
      }
    };

    useEffect(() => {
      if (expoUrl) {
        setQrModalOpen(true);
      }
    }, [expoUrl]);

    useEffect(() => {
      if (data) {
        const progressList = data.filter(
          (x) => typeof x === 'object' && (x as any).type === 'progress',
        ) as ProgressAnnotation[];
        setProgressAnnotations(progressList);
      }
    }, [data]);
    useEffect(() => {
      console.log(transcript);
    }, [transcript]);

    useEffect(() => {
      onStreamingChange?.(isStreaming);
    }, [isStreaming, onStreamingChange]);

    useEffect(() => {
      if (typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onresult = (event) => {
          const transcript = Array.from(event.results)
            .map((result) => result[0])
            .map((result) => result.transcript)
            .join('');

          setTranscript(transcript);

          if (handleInputChange) {
            const syntheticEvent = {
              target: { value: transcript },
            } as React.ChangeEvent<HTMLTextAreaElement>;
            handleInputChange(syntheticEvent);
          }
        };

        recognition.onerror = (event) => {
          console.error('Speech recognition error:', event.error);
          setIsListening(false);
        };

        setRecognition(recognition);
      }
    }, []);

    const startListening = () => {
      if (recognition) {
        recognition.start();
        setIsListening(true);
      }
    };

    const stopListening = () => {
      if (recognition) {
        recognition.stop();
        setIsListening(false);
      }
    };

    const handleSendMessage = (event: React.UIEvent, messageInput?: string) => {
      if (sendMessage) {
        sendMessage(event, messageInput);
        setSelectedElement?.(null);

        if (recognition) {
          recognition.abort(); // Stop current recognition
          setTranscript(''); // Clear transcript
          setIsListening(false);

          // Clear the input by triggering handleInputChange with empty value
          if (handleInputChange) {
            const syntheticEvent = {
              target: { value: '' },
            } as React.ChangeEvent<HTMLTextAreaElement>;
            handleInputChange(syntheticEvent);
          }
        }
      }
    };

    const handleFileUpload = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';

      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];

        if (file) {
          const reader = new FileReader();

          reader.onload = (e) => {
            const base64Image = e.target?.result as string;
            setUploadedFiles?.([...uploadedFiles, file]);
            setImageDataList?.([...imageDataList, base64Image]);
          };
          reader.readAsDataURL(file);
        }
      };

      input.click();
    };

    const handlePaste = async (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;

      if (!items) {
        return;
      }

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();

          const file = item.getAsFile();

          if (file) {
            const reader = new FileReader();

            reader.onload = (e) => {
              const base64Image = e.target?.result as string;
              setUploadedFiles?.([...uploadedFiles, file]);
              setImageDataList?.([...imageDataList, base64Image]);
            };
            reader.readAsDataURL(file);
          }

          break;
        }
      }
    };

    // Resize handler functions
    const startResizing = (e: React.PointerEvent) => {
      if (!chatStarted) {
        return;
      }

      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);

      setIsResizing(true);
      resizeStartX.current = e.clientX;
      resizeStartWidth.current = chatWidthPercent;

      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ew-resize';
    };

    const handleResize = (e: React.PointerEvent) => {
      if (!isResizing) {
        return;
      }

      const deltaX = e.clientX - resizeStartX.current;
      const containerWidth = window.innerWidth;
      const deltaPercent = (deltaX / containerWidth) * 100;

      let newWidth = resizeStartWidth.current + deltaPercent;

      // Constrain between 20% and 80%
      newWidth = Math.max(20, Math.min(80, newWidth));

      setChatWidthPercent(newWidth);
    };

    const stopResizing = (e: React.PointerEvent) => {
      if (!isResizing) {
        return;
      }

      const target = e.currentTarget as HTMLElement;
      target.releasePointerCapture(e.pointerId);

      setIsResizing(false);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    const baseChat = (
      <div
        ref={ref}
        className={classNames(
          styles.BaseChat,
          'relative flex h-full w-full',
          chatStarted ? 'overflow-hidden' : 'overflow-y-auto',
        )}
        data-chat-visible={showChat}
      >
        <ClientOnly>{() => <Menu />}</ClientOnly>

        {/* Vertical side nav — only shown when chat has started (replaces the top header) */}
        {chatStarted && (
          <div
            className="flex flex-col items-center py-3 gap-3 border-r border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 shrink-0"
            style={{ width: '52px', zIndex: 20 }}
          >
            {/* HTX Logo — links home */}
            <a href="/" className="flex items-center justify-center mb-1" title="Home">
              <img src="/HTX_logo.jpg" alt="HTX" className="h-[32px] w-[32px] object-contain rounded dark:hidden" />
              <img
                src="/logo-dark-styled.png"
                alt="HTX"
                className="h-[32px] w-[32px] object-contain rounded hidden dark:block"
              />
            </a>

            {/* Chat icon — AI chat view */}
            <Tooltip.Provider delayDuration={200}>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    className={classNames(
                      'flex items-center justify-center w-9 h-9 rounded-lg transition-colors',
                      activeLeftPanel === 'chat'
                        ? 'bg-purple-500/20 text-purple-500 border border-purple-500/30'
                        : 'text-bolt-elements-textTertiary hover:bg-bolt-elements-item-backgroundActive border border-transparent hover:border-bolt-elements-borderColor',
                    )}
                    title="AI Chat"
                    aria-label="AI Chat"
                    onClick={switchToChat}
                  >
                    <span className="i-ph:chat-circle-dots-fill text-lg" />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    className="bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor rounded-lg px-2 py-1 text-xs text-bolt-elements-textPrimary shadow-lg"
                    side="right"
                    sideOffset={8}
                  >
                    AI Chat
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            </Tooltip.Provider>

            {/* Blocks icon — visual drag-and-drop block editor */}
            <Tooltip.Provider delayDuration={200}>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    className={classNames(
                      'flex items-center justify-center w-9 h-9 rounded-lg transition-colors',
                      activeLeftPanel === 'blocks'
                        ? 'bg-purple-500/20 text-purple-500 border border-purple-500/30'
                        : 'text-bolt-elements-textTertiary hover:bg-bolt-elements-item-backgroundActive border border-transparent hover:border-bolt-elements-borderColor',
                    )}
                    title="Visual Blocks"
                    aria-label="Visual Blocks"
                    onClick={switchToBlocks}
                  >
                    <span className="i-ph:squares-four text-lg" />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    className="bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor rounded-lg px-2 py-1 text-xs text-bolt-elements-textPrimary shadow-lg"
                    side="right"
                    sideOffset={8}
                  >
                    Visual Blocks
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            </Tooltip.Provider>
          </div>
        )}

        <div
          className={classNames(
            'flex flex-col lg:flex-row w-full',
            chatStarted ? 'h-full overflow-hidden' : 'min-h-full',
          )}
        >
          <div
            className={classNames(styles.Chat, 'flex flex-col', chatStarted ? 'h-full overflow-hidden' : 'min-h-full')}
            style={{
              width: chatStarted ? (showWorkbench ? `calc(${chatWidthPercent}% - 80px)` : '100%') : '100%',
              minWidth: chatStarted && showWorkbench ? '300px' : undefined,
              flexShrink: 0,
              transition: isResizing ? 'none' : 'width 0.3s ease',
              position: 'relative',
            }}
          >
            {/* Deploy + Preview buttons — sticky top-right overlay inside the chat column */}
            {chatStarted && (
              <div className="absolute top-3 right-3 z-30 flex items-center gap-1">
                <ClientOnly>{() => <HeaderActionButtons chatStarted={chatStarted} />}</ClientOnly>
              </div>
            )}
            {!chatStarted && (
              <div id="intro" className="mt-[16vh] max-w-4xl mx-auto text-center px-4 lg:px-0">
                <h1 className="text-3xl lg:text-6xl font-bold text-bolt-elements-textPrimary mb-4 animate-fade-in">
                  Create your websites with AI
                </h1>
                <p className="text-md lg:text-xl mb-8 text-bolt-elements-textSecondary animate-fade-in animation-delay-200">
                  Start prompting the chat interface below to build your ideal website
                </p>
              </div>
            )}
            {chatStarted && activeLeftPanel === 'blocks' ? (
              <div className="flex-1 h-full overflow-hidden">
                <BlocksPanel />
              </div>
            ) : (
              <StickToBottom
                className={classNames('pt-6 px-2 sm:px-6 relative', {
                  'h-full flex flex-col modern-scrollbar': chatStarted,
                })}
                resize="smooth"
                initial="smooth"
              >
                <StickToBottom.Content className="flex flex-col gap-4 relative ">
                  <ClientOnly>
                    {() => {
                      return chatStarted ? (
                        <Messages
                          className="flex flex-col w-full flex-1 max-w-chat pb-4 mx-auto z-1"
                          messages={messages}
                          isStreaming={isStreaming}
                          append={append}
                          chatMode={chatMode}
                          setChatMode={setChatMode}
                          addToolResult={addToolResult}
                        />
                      ) : null;
                    }}
                  </ClientOnly>
                  <ScrollToBottom />
                </StickToBottom.Content>
                <div
                  className={classNames('my-auto flex flex-col gap-2 w-full max-w-chat mx-auto z-prompt mb-6', {
                    'sticky bottom-2': chatStarted,
                  })}
                >
                  <div className="flex flex-col gap-2">
                    {deployAlert && (
                      <DeployChatAlert
                        alert={deployAlert}
                        clearAlert={() => clearDeployAlert?.()}
                        postMessage={(message: string | undefined) => {
                          sendMessage?.({} as any, message);
                          clearSupabaseAlert?.();
                        }}
                      />
                    )}
                    {supabaseAlert && (
                      <SupabaseChatAlert
                        alert={supabaseAlert}
                        clearAlert={() => clearSupabaseAlert?.()}
                        postMessage={(message) => {
                          sendMessage?.({} as any, message);
                          clearSupabaseAlert?.();
                        }}
                      />
                    )}
                    {actionAlert && (
                      <ChatAlert
                        alert={actionAlert}
                        clearAlert={() => clearAlert?.()}
                        postMessage={(message) => {
                          sendMessage?.({} as any, message);
                          clearAlert?.();
                        }}
                      />
                    )}
                    {llmErrorAlert && <LlmErrorAlert alert={llmErrorAlert} clearAlert={() => clearLlmErrorAlert?.()} />}
                  </div>
                  {progressAnnotations && <ProgressCompilation data={progressAnnotations} />}
                  <ChatBox
                    uploadedFiles={uploadedFiles}
                    setUploadedFiles={setUploadedFiles}
                    imageDataList={imageDataList}
                    setImageDataList={setImageDataList}
                    textareaRef={textareaRef}
                    input={input}
                    handleInputChange={handleInputChange}
                    handlePaste={handlePaste}
                    TEXTAREA_MIN_HEIGHT={TEXTAREA_MIN_HEIGHT}
                    TEXTAREA_MAX_HEIGHT={TEXTAREA_MAX_HEIGHT}
                    isStreaming={isStreaming}
                    handleStop={handleStop}
                    handleSendMessage={handleSendMessage}
                    enhancingPrompt={enhancingPrompt}
                    enhancePrompt={enhancePrompt}
                    isListening={isListening}
                    startListening={startListening}
                    stopListening={stopListening}
                    chatStarted={chatStarted}
                    exportChat={exportChat}
                    qrModalOpen={qrModalOpen}
                    setQrModalOpen={setQrModalOpen}
                    handleFileUpload={handleFileUpload}
                    chatMode={chatMode}
                    setChatMode={setChatMode}
                    designScheme={designScheme}
                    setDesignScheme={setDesignScheme}
                    selectedElement={selectedElement}
                    setSelectedElement={setSelectedElement}
                  />
                </div>
              </StickToBottom>
            )}

            <div className="flex flex-col justify-center">
              {!chatStarted && (
                <div className="flex justify-center gap-2">
                  {ImportButtons(importChat)}
                  <GitCloneButton importChat={importChat} />
                </div>
              )}
              <div className="flex flex-col gap-5">
                {!chatStarted &&
                  ExamplePrompts((event, messageInput) => {
                    if (isStreaming) {
                      handleStop?.();
                      return;
                    }

                    handleSendMessage?.(event, messageInput);
                  })}
              </div>
              {!chatStarted && <ClientOnly>{() => <RecentTasks />}</ClientOnly>}
            </div>
          </div>
          {chatStarted && showWorkbench && (
            <div
              className="resize-handle"
              onPointerDown={startResizing}
              onPointerMove={handleResize}
              onPointerUp={stopResizing}
              onPointerCancel={stopResizing}
              style={{
                width: '8px',
                cursor: 'ew-resize',
                backgroundColor: isResizing
                  ? 'var(--bolt-elements-borderColorActive)'
                  : 'var(--bolt-elements-borderColor)',
                flexShrink: 0,
                transition: isResizing ? 'none' : 'background-color 0.2s',
                position: 'relative',
                zIndex: 10,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: '3px',
                  height: '40px',
                  backgroundColor: 'var(--bolt-elements-textTertiary)',
                  borderRadius: '2px',
                  opacity: 0.5,
                }}
              />
            </div>
          )}
          <ClientOnly>
            {() => (
              <div
                style={{
                  width: chatStarted && showWorkbench ? `calc(${100 - chatWidthPercent}% + 80px)` : '0%',
                  flexShrink: 0,
                  overflow: 'hidden',
                  transition: isResizing ? 'none' : 'width 0.3s ease',
                }}
              >
                <Workbench
                  chatStarted={chatStarted}
                  isStreaming={isStreaming}
                  setSelectedElement={setSelectedElement}
                />
              </div>
            )}
          </ClientOnly>
        </div>
      </div>
    );

    return <Tooltip.Provider delayDuration={200}>{baseChat}</Tooltip.Provider>;
  },
);

function ScrollToBottom() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  return (
    !isAtBottom && (
      <>
        <div className="sticky bottom-0 left-0 right-0 bg-gradient-to-t from-bolt-elements-background-depth-1 to-transparent h-20 z-10" />
        <button
          className="sticky z-50 bottom-0 left-0 right-0 text-4xl rounded-lg px-1.5 py-0.5 flex items-center justify-center mx-auto gap-2 bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor text-bolt-elements-textPrimary text-sm"
          onClick={() => scrollToBottom()}
        >
          Go to last message
          <span className="i-ph:arrow-down animate-bounce" />
        </button>
      </>
    )
  );
}
