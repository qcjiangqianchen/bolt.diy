import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createDataStream, generateId } from 'ai';
import { MAX_RESPONSE_SEGMENTS, MAX_TOKENS, type FileMap } from '~/lib/.server/llm/constants';
import { CONTINUE_PROMPT } from '~/lib/common/prompts/prompts';
import { streamText, type Messages } from '~/lib/.server/llm/stream-text';
import SwitchableStream from '~/lib/.server/llm/switchable-stream';
import { createScopedLogger } from '~/utils/logger';
import { getFilePaths } from '~/lib/.server/llm/select-context';
import type { ContextAnnotation, ProgressAnnotation } from '~/types/context';
import { WORK_DIR } from '~/utils/constants';
import type { DesignScheme } from '~/types/design-scheme';
import { MCPService } from '~/lib/services/mcpService';
import { StreamRecoveryManager } from '~/lib/.server/llm/stream-recovery';
import { requireAuthenticatedUser } from '~/lib/auth/request-user.server';
import { extractCurrentContext } from '~/lib/.server/llm/utils';

export async function action(args: ActionFunctionArgs) {
  return chatAction(args);
}

const logger = createScopedLogger('api.chat');
const CONTEXT_OPTIMIZATION_MAX_FILES = 8;
const CONTEXT_OPTIMIZATION_MAX_CHARS = 60000;
const CONTEXT_OPTIMIZATION_MAX_MESSAGE_WINDOW = 4;

function getRelativeProjectPath(filePath: string) {
  if (filePath.startsWith(WORK_DIR)) {
    return filePath.replace(WORK_DIR, '').replace(/^\/+/, '');
  }

  return filePath.replace(/^\/home\/project\//, '').replace(/^\/+/, '');
}

function tokenizeForContextSelection(input: string) {
  return Array.from(
    new Set(
      input
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .filter((token) => token.length >= 3),
    ),
  ).slice(0, 24);
}

function estimateFileCharLength(file: FileMap[string]) {
  if (!file || file.type !== 'file' || file.isBinary) {
    return 0;
  }

  return file.content.length;
}

function selectFilesForContextBudget(files: FileMap, messages: Messages) {
  const fileEntries = Object.entries(files).filter(([, file]) => file?.type === 'file' && !file.isBinary) as Array<
    [string, NonNullable<FileMap[string]>]
  >;
  const totalChars = fileEntries.reduce((sum, [, file]) => sum + estimateFileCharLength(file), 0);

  if (fileEntries.length <= CONTEXT_OPTIMIZATION_MAX_FILES && totalChars <= CONTEXT_OPTIMIZATION_MAX_CHARS) {
    return {
      files,
      reduced: false,
      totalChars,
      selectedChars: totalChars,
      selectedCount: fileEntries.length,
    };
  }

  const { codeContext } = extractCurrentContext(messages);
  const currentContextFiles = new Set((codeContext?.type === 'codeContext' ? codeContext.files : []) || []);
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  const latestUserText =
    typeof latestUserMessage?.content === 'string'
      ? latestUserMessage.content
      : Array.isArray(latestUserMessage?.parts)
        ? latestUserMessage.parts.find(
            (item): item is Extract<(typeof latestUserMessage.parts)[number], { type: 'text' }> => item.type === 'text',
          )?.text || ''
        : '';
  const queryTokens = tokenizeForContextSelection(latestUserText);

  const scoredEntries = fileEntries
    .map(([fullPath, file]) => {
      const relativePath = getRelativeProjectPath(fullPath);
      const normalizedPath = relativePath.toLowerCase();
      const baseName = normalizedPath.split('/').pop() || normalizedPath;
      const fileLength = estimateFileCharLength(file);
      let score = 0;

      if (currentContextFiles.has(relativePath)) {
        score += 120;
      }

      for (const token of queryTokens) {
        if (normalizedPath.includes(token)) {
          score += Math.min(18, token.length + 4);
        }

        if (baseName.includes(token)) {
          score += 8;
        }
      }

      if (/(^|\/)(index|main|app)\.(html|css|js|ts|tsx|jsx)$/.test(normalizedPath)) {
        score += 18;
      }

      if (/(^|\/)package\.json$/.test(normalizedPath)) {
        score += 14;
      }

      if (/vite\.config|tsconfig|uno\.config|tailwind\.config/.test(normalizedPath)) {
        score += 10;
      }

      if (normalizedPath.endsWith('.html')) {
        score += 12;
      } else if (normalizedPath.endsWith('.css') || normalizedPath.endsWith('.scss')) {
        score += 9;
      } else if (/\.(js|ts|jsx|tsx)$/.test(normalizedPath)) {
        score += 7;
      }

      score -= Math.floor(fileLength / 15000);

      return { fullPath, file, fileLength, score };
    })
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return a.fileLength - b.fileLength;
    });

  const selectedFiles: FileMap = {};
  let selectedChars = 0;
  let selectedCount = 0;

  for (const entry of scoredEntries) {
    if (selectedCount >= CONTEXT_OPTIMIZATION_MAX_FILES) {
      break;
    }

    const nextChars = selectedChars + entry.fileLength;

    if (selectedCount > 0 && nextChars > CONTEXT_OPTIMIZATION_MAX_CHARS) {
      continue;
    }

    selectedFiles[entry.fullPath] = entry.file;
    selectedChars = nextChars;
    selectedCount++;
  }

  if (selectedCount === 0 && scoredEntries[0]) {
    selectedFiles[scoredEntries[0].fullPath] = scoredEntries[0].file;
    selectedChars = scoredEntries[0].fileLength;
    selectedCount = 1;
  }

  return {
    files: selectedFiles,
    reduced: true,
    totalChars,
    selectedChars,
    selectedCount,
  };
}

async function chatAction({ context, request }: ActionFunctionArgs) {
  const user = await requireAuthenticatedUser(request, context);

  if (user instanceof Response) {
    return user;
  }

  const streamRecovery = new StreamRecoveryManager({
    timeout: 45000,
    maxRetries: 2,
    onTimeout: () => {
      logger.warn('Stream timeout - attempting recovery');
    },
  });

  const { messages, files, promptId, contextOptimization, supabase, chatMode, designScheme } = await request.json<{
    messages: Messages;
    files: any;
    promptId?: string;
    contextOptimization: boolean;
    chatMode: 'discuss' | 'build';
    designScheme?: DesignScheme;
    supabase?: {
      isConnected: boolean;
      hasSelectedProject: boolean;
      credentials?: {
        anonKey?: string;
        supabaseUrl?: string;
      };
    };
    maxLLMSteps?: number;
  }>();

  const stream = new SwitchableStream();

  const cumulativeUsage = {
    completionTokens: 0,
    promptTokens: 0,
    totalTokens: 0,
  };
  const encoder: TextEncoder = new TextEncoder();
  let progressCounter: number = 1;

  try {
    const mcpService = MCPService.getInstance();
    const totalMessageContent = messages.reduce((acc, message) => acc + message.content, '');
    logger.debug(`Total message length: ${totalMessageContent.split(' ').length}, words`);

    let lastChunk: string | undefined = undefined;

    const dataStream = createDataStream({
      async execute(dataStream) {
        streamRecovery.startMonitoring();

        const filePaths = getFilePaths(files || {});
        let filteredFiles: FileMap | undefined = undefined;
        let summary: string | undefined = undefined;
        let messageSliceId = 0;

        const processedMessages = await mcpService.processToolInvocations(messages, dataStream);

        if (processedMessages.length > CONTEXT_OPTIMIZATION_MAX_MESSAGE_WINDOW) {
          messageSliceId = processedMessages.length - CONTEXT_OPTIMIZATION_MAX_MESSAGE_WINDOW;
        }

        if (filePaths.length > 0 && contextOptimization) {
          logger.debug('Skipping chat summary generation during context optimization');

          const contextSelection = selectFilesForContextBudget(files || {}, processedMessages);
          summary = undefined;
          filteredFiles = contextSelection.files;

          logger.debug(
            contextSelection.reduced
              ? `Reducing context files to fit request budget (${contextSelection.selectedCount}/${Object.keys(files || {}).length} files, ${contextSelection.selectedChars}/${contextSelection.totalChars} chars)`
              : `Using all selected files as context (${contextSelection.selectedCount} files, ${contextSelection.selectedChars} chars)`,
          );

          if (filteredFiles) {
            logger.debug(`files in context : ${JSON.stringify(Object.keys(filteredFiles))}`);
          }

          dataStream.writeMessageAnnotation({
            type: 'codeContext',
            files: Object.keys(filteredFiles || {}).map((key) => {
              let path = key;

              if (path.startsWith(WORK_DIR)) {
                path = path.replace(WORK_DIR, '');
              }

              return path;
            }),
          } as ContextAnnotation);

          dataStream.writeData({
            type: 'progress',
            label: 'context',
            status: 'complete',
            order: progressCounter++,
            message: contextSelection.reduced ? 'Code Context Reduced To Fit Request Budget' : 'Code Files Selected',
          } satisfies ProgressAnnotation);
        }

        const options: any = {
          supabaseConnection: supabase,
          onStepFinish: ({ toolCalls }: { toolCalls: any[] }) => {
            toolCalls.forEach((toolCall: any) => {
              mcpService.processToolCall(toolCall, dataStream);
            });
          },
          onFinish: async ({ text: content, finishReason, usage }: { text: any; finishReason: any; usage: any }) => {
            logger.debug('usage', JSON.stringify(usage));

            if (usage) {
              cumulativeUsage.completionTokens += usage.completionTokens || 0;
              cumulativeUsage.promptTokens += usage.promptTokens || 0;
              cumulativeUsage.totalTokens += usage.totalTokens || 0;
            }

            if (finishReason !== 'length') {
              dataStream.writeMessageAnnotation({
                type: 'usage',
                value: {
                  completionTokens: cumulativeUsage.completionTokens,
                  promptTokens: cumulativeUsage.promptTokens,
                  totalTokens: cumulativeUsage.totalTokens,
                },
              });
              dataStream.writeData({
                type: 'progress',
                label: 'response',
                status: 'complete',
                order: progressCounter++,
                message: 'Response Generated',
              } satisfies ProgressAnnotation);
              await new Promise((resolve) => setTimeout(resolve, 0));

              return;
            }

            if (stream.switches >= MAX_RESPONSE_SEGMENTS) {
              throw Error('Cannot continue message: Maximum segments reached');
            }

            const switchesLeft = MAX_RESPONSE_SEGMENTS - stream.switches;

            logger.info(`Reached max token limit (${MAX_TOKENS}): Continuing message (${switchesLeft} switches left)`);

            // Continue the conversation — model/provider are resolved from env, no need to extract from message
            processedMessages.push({ id: generateId(), role: 'assistant', content });
            processedMessages.push({
              id: generateId(),
              role: 'user',
              content: CONTINUE_PROMPT,
            });

            const result = await streamText({
              messages: [...processedMessages],
              env: context.cloudflare?.env,
              options,
              files,
              promptId,
              contextOptimization,
              contextFiles: filteredFiles,
              chatMode,
              designScheme,
              summary,
              messageSliceId,
            });

            result.mergeIntoDataStream(dataStream);

            (async () => {
              for await (const part of result.fullStream) {
                if (part.type === 'error') {
                  const error: any = part.error;
                  logger.error(`${error}`);

                  return;
                }
              }
            })();

            return;
          },
        };

        dataStream.writeData({
          type: 'progress',
          label: 'response',
          status: 'in-progress',
          order: progressCounter++,
          message: 'Generating Response',
        } satisfies ProgressAnnotation);

        const result = await streamText({
          messages: [...processedMessages],
          env: context.cloudflare?.env,
          options,
          files,
          promptId,
          contextOptimization,
          contextFiles: filteredFiles,
          chatMode,
          designScheme,
          summary,
          messageSliceId,
        });

        // Start error monitoring
        const errorMonitor = (async () => {
          for await (const part of result.fullStream) {
            streamRecovery.updateActivity();

            if (part.type === 'error') {
              const error: any = part.error;
              logger.error('Streaming error:', error);
              streamRecovery.stop();

              return;
            }
          }
          streamRecovery.stop();
        })();

        // Merge the stream into the data stream
        await result.mergeIntoDataStream(dataStream);

        // Wait for error monitor to complete
        await errorMonitor;
      },
      onError: (error: any) => {
        const errorMessage = error.message || 'Unknown error';

        const normalizedErrorMessage = errorMessage.toLowerCase();

        if (normalizedErrorMessage.includes('model') && normalizedErrorMessage.includes('not found')) {
          return 'Custom error: Invalid model selected. Please check that the model name is correct and available.';
        }

        if (errorMessage.includes('Invalid JSON response')) {
          return 'Custom error: The AI service returned an invalid response. This may be due to an invalid model name, API rate limiting, or server issues.';
        }

        if (
          errorMessage.includes('API key') ||
          errorMessage.includes('unauthorized') ||
          errorMessage.includes('authentication')
        ) {
          return 'Custom error: Invalid or missing API key. Please check your API key configuration.';
        }

        if (
          normalizedErrorMessage.includes('rate limit') ||
          normalizedErrorMessage.includes('429') ||
          normalizedErrorMessage.includes('tokens per min') ||
          normalizedErrorMessage.includes('tpm')
        ) {
          return 'Custom error: API rate limit exceeded. This request exceeded the provider tokens-per-minute limit for the selected model. Reduce the conversation/context size or wait and try again.';
        }

        if (normalizedErrorMessage.includes('token') && normalizedErrorMessage.includes('limit')) {
          return 'Custom error: Token limit exceeded. The request is too large for the selected model or provider limits. Reduce the conversation/context size and try again.';
        }

        if (normalizedErrorMessage.includes('network') || normalizedErrorMessage.includes('timeout')) {
          return 'Custom error: Network error. Please check your internet connection and try again.';
        }

        return `Custom error: ${errorMessage}`;
      },
    }).pipeThrough(
      new TransformStream({
        transform: (chunk, controller) => {
          try {
            if (!lastChunk) {
              lastChunk = ' ';
            }

            if (typeof chunk === 'string') {
              if (chunk.startsWith('g') && !lastChunk.startsWith('g')) {
                controller.enqueue(encoder.encode(`0: "<div class=\\"__boltThought__\\">"\n`));
              }

              if (lastChunk.startsWith('g') && !chunk.startsWith('g')) {
                controller.enqueue(encoder.encode(`0: "</div>\\n"\n`));
              }
            }

            lastChunk = chunk;

            let transformedChunk = chunk;

            if (typeof chunk === 'string' && chunk.startsWith('g')) {
              let content = chunk.split(':').slice(1).join(':');

              if (content.endsWith('\n')) {
                content = content.slice(0, content.length - 1);
              }

              transformedChunk = `0:${content}\n`;
            }

            const str = typeof transformedChunk === 'string' ? transformedChunk : JSON.stringify(transformedChunk);
            controller.enqueue(encoder.encode(str));
          } catch (e) {
            // Guard against "Controller is already closed" errors during stream termination
            console.warn('[api.chat] Transform stream error (likely closed):', e);
          }
        },
      }),
    );

    return new Response(dataStream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache',
        'Text-Encoding': 'chunked',
      },
    });
  } catch (error: any) {
    logger.error(error);

    const errorResponse = {
      error: true,
      message: error.message || 'An unexpected error occurred',
      statusCode: error.statusCode || 500,
      isRetryable: error.isRetryable !== false,
      provider: error.provider || 'unknown',
    };

    if (error.message?.includes('API key')) {
      return new Response(
        JSON.stringify({
          ...errorResponse,
          message: 'Invalid or missing API key',
          statusCode: 401,
          isRetryable: false,
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
          statusText: 'Unauthorized',
        },
      );
    }

    return new Response(JSON.stringify(errorResponse), {
      status: errorResponse.statusCode,
      headers: { 'Content-Type': 'application/json' },
      statusText: 'Error',
    });
  }
}
