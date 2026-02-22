import { convertToCoreMessages, type Message } from 'ai';
import { type FileMap } from './constants';
import { getSystemPrompt } from '~/lib/common/prompts/prompts';
import { MODIFICATIONS_TAG_NAME, WORK_DIR } from '~/utils/constants';
import { PromptLibrary } from '~/lib/common/prompt-library';
import { allowedHTMLElements } from '~/utils/markdown';
import { createScopedLogger } from '~/utils/logger';
import { createFilesContext } from './utils';
import { discussPrompt } from '~/lib/common/prompts/discuss-prompt';
import type { DesignScheme } from '~/types/design-scheme';
import { OllamaProvider } from './providers/ollama';

export type Messages = Message[];

export interface StreamingOptions {
  supabaseConnection?: {
    isConnected: boolean;
    hasSelectedProject: boolean;
    credentials?: {
      anonKey?: string;
      supabaseUrl?: string;
    };
  };
}

const logger = createScopedLogger('stream-text');

function sanitizeText(text: string): string {
  let sanitized = text.replace(/<div class=\\"__boltThought__\\">.*?<\/div>/s, '');
  sanitized = sanitized.replace(/<think>.*?<\/think>/s, '');
  sanitized = sanitized.replace(/<boltAction type="file" filePath="package-lock\.json">[\s\S]*?<\/boltAction>/g, '');

  return sanitized.trim();
}

export async function streamText(props: {
  messages: Omit<Message, 'id'>[];
  env?: Env;
  options?: StreamingOptions;
  apiKeys?: Record<string, string>;
  files?: FileMap;
  providerSettings?: Record<string, any>;
  promptId?: string;
  contextOptimization?: boolean;
  contextFiles?: FileMap;
  summary?: string;
  messageSliceId?: number;
  chatMode?: 'discuss' | 'build';
  designScheme?: DesignScheme;
}) {
  const {
    messages,
    env: serverEnv,
    options,
    files,
    promptId,
    contextOptimization,
    contextFiles,
    summary,
    chatMode,
    designScheme,
  } = props;

  // Use local Ollama model - no provider routing needed
  const ollamaBaseURL = serverEnv?.OLLAMA_API_BASE_URL || 'http://127.0.0.1:11434';
  const ollamaModel = (serverEnv as any)?.OLLAMA_MODEL || 'qwen2.5-coder:14b';

  logger.info(`Using local Ollama model: ${ollamaModel} at ${ollamaBaseURL}`);

  // Sanitize messages
  let processedMessages = messages.map((message) => {
    const newMessage = { ...message };

    if (message.role === 'user') {
      newMessage.content = sanitizeText(message.content as string);
    } else if (message.role === 'assistant') {
      newMessage.content = sanitizeText(message.content as string);
    }

    // Sanitize all text parts in parts array, if present
    if (Array.isArray(message.parts)) {
      newMessage.parts = message.parts.map((part) =>
        part.type === 'text' ? { ...part, text: sanitizeText(part.text) } : part,
      );
    }

    return newMessage;
  });

  let systemPrompt =
    PromptLibrary.getPropmtFromLibrary(promptId || 'default', {
      cwd: WORK_DIR,
      allowedHtmlElements: allowedHTMLElements,
      modificationTagName: MODIFICATIONS_TAG_NAME,
      designScheme,
      supabase: {
        isConnected: options?.supabaseConnection?.isConnected || false,
        hasSelectedProject: options?.supabaseConnection?.hasSelectedProject || false,
        credentials: options?.supabaseConnection?.credentials || undefined,
      },
    }) ?? getSystemPrompt();

  if (chatMode === 'build' && contextFiles && contextOptimization) {
    const codeContext = createFilesContext(contextFiles, true);

    systemPrompt = `${systemPrompt}

    Below is the artifact containing the context loaded into context buffer for you to have knowledge of and might need changes to fullfill current user request.
    CONTEXT BUFFER:
    ---
    ${codeContext}
    ---
    `;

    if (summary) {
      systemPrompt = `${systemPrompt}
      below is the chat history till now
      CHAT SUMMARY:
      ---
      ${props.summary}
      ---
      `;

      if (props.messageSliceId) {
        processedMessages = processedMessages.slice(props.messageSliceId);
      } else {
        const lastMessage = processedMessages.pop();

        if (lastMessage) {
          processedMessages = [lastMessage];
        }
      }
    }
  }

  const effectiveLockedFilePaths = new Set<string>();

  if (files) {
    for (const [filePath, fileDetails] of Object.entries(files)) {
      if (fileDetails?.isLocked) {
        effectiveLockedFilePaths.add(filePath);
      }
    }
  }

  if (effectiveLockedFilePaths.size > 0) {
    const lockedFilesListString = Array.from(effectiveLockedFilePaths)
      .map((filePath) => `- ${filePath}`)
      .join('\n');
    systemPrompt = `${systemPrompt}

    IMPORTANT: The following files are locked and MUST NOT be modified in any way. Do not suggest or make any changes to these files. You can proceed with the request but DO NOT make any changes to these files specifically:
    ${lockedFilesListString}
    ---
    `;
  } else {
    console.log('No locked files found from any source for prompt.');
  }

  // Initialize Ollama provider
  const ollama = new OllamaProvider({
    baseURL: ollamaBaseURL,
    model: ollamaModel,
  });

  // Convert messages to Ollama format
  const coreMessages = convertToCoreMessages(processedMessages as any);
  const systemMessage = chatMode === 'build' ? systemPrompt : discussPrompt();

  // Add forced artifact usage reminder at the end of system prompt for build mode
  const finalSystemMessage =
    chatMode === 'build'
      ? `${systemMessage}

RESPONSE FORMAT:
You MUST be conversational and informative. Structure your response like this:
1. First, briefly explain what you're about to do (1-3 sentences). For example: "I'll create a simple tennis webpage with a hero section and player stats." or "Let me update the index.html to add a Roger Federer section below the existing content."
2. Then include the <boltArtifact> block with all necessary file actions.
3. After the closing </boltArtifact> tag, provide a brief summary of what was done and any next steps the user might want to take.

If you encounter an issue or the user's request is unclear:
- Explain what the problem is clearly
- Suggest how the user can fix or clarify their request
- If you can still partially fulfill the request, do so and explain what's missing

IMPORTANT RULES:
- When modifying code, check CONTEXT BUFFER for current files. Only include files that need changes — do NOT recreate unchanged files.
- You MUST create ALL files that are imported or referenced. If a file imports "./styles.css", you MUST include a boltAction to create "styles.css". Never reference a file without creating it first.
- Always create complete, working projects with no missing files.
- EVERY project MUST end with a <boltAction type="start"> to start the dev server. NEVER skip this.

FOR STATIC HTML PROJECTS (no framework, just HTML/CSS/JS):
- You MUST still create a package.json with a start script
- Use npx --yes servor as the start command
- Example for a static site:

I'll set up a simple static website for you.

<boltArtifact id="project" title="Project Title">
<boltAction type="file" filePath="package.json">{
  "name": "my-project",
  "scripts": {
    "start": "npx --yes servor ."
  }
}</boltAction>
<boltAction type="file" filePath="index.html">
<!DOCTYPE html>
...complete HTML content...
</boltAction>
<boltAction type="start">npx --yes servor .</boltAction>
</boltArtifact>

The site is now running! You can see it in the preview panel.

FOR REACT/VITE PROJECTS:
- Create package.json with dependencies and dev script
- ALWAYS run <boltAction type="shell">npm install</boltAction> BEFORE the start action
- Then start with <boltAction type="start">npm run dev</boltAction>
- Example:

I'll create a React app for you. Let me set up the project structure and install dependencies.

<boltArtifact id="react-app" title="React App">
<boltAction type="file" filePath="package.json">{
  "name": "my-app",
  "scripts": { "dev": "vite" },
  "dependencies": { "react": "^18.2.0", "react-dom": "^18.2.0" },
  "devDependencies": { "@vitejs/plugin-react": "^3.1.0", "vite": "^4.2.0" }
}</boltAction>
<boltAction type="file" filePath="index.html">...</boltAction>
<boltAction type="file" filePath="src/main.jsx">...</boltAction>
<boltAction type="file" filePath="src/App.jsx">...</boltAction>
<boltAction type="shell">npm install</boltAction>
<boltAction type="start">npm run dev</boltAction>
</boltArtifact>

Your React app is now running! The dev server is started and you should see it in the preview. You can customize the components in the src/ folder.

NEVER use echo commands or npm start without a package.json. ALWAYS use <boltAction type="start"> (not type="shell") for starting servers. ALWAYS run npm install before starting if there are dependencies.
`
      : systemMessage;

  // Log first 500 chars of system prompt to verify it's correct
  logger.info(`[stream-text] System prompt first 500 chars: ${finalSystemMessage.substring(0, 500)}`);
  logger.info(`[stream-text] Chat mode: ${chatMode}`);

  const formattedMessages = [
    { role: 'system' as const, content: finalSystemMessage },
    ...coreMessages.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content:
        typeof msg.content === 'string'
          ? msg.content
          : msg.content.map((part) => (part.type === 'text' ? part.text : '')).join(''),
    })),
  ];

  // Create a shared async generator that buffers chunks
  const chunks: string[] = [];
  let streamComplete = false;
  let streamError: Error | null = null;

  // Start the Ollama stream immediately and buffer chunks
  void (async () => {
    try {
      logger.info('[stream-text] Starting Ollama stream');

      let chunkCount = 0;
      const startTime = Date.now();
      let foundArtifactStart = false;
      let accumulatedText = '';

      for await (const chunk of ollama.streamChat(formattedMessages)) {
        // Accumulate text to check for artifact start
        accumulatedText += chunk;

        // If we haven't found the artifact start yet, check if it's in the accumulated text
        if (!foundArtifactStart) {
          const artifactIndex = accumulatedText.indexOf('<boltArtifact');

          if (artifactIndex >= 0) {
            // Found it! Discard everything before it and start buffering from the artifact
            foundArtifactStart = true;

            const artifactStart = accumulatedText.substring(artifactIndex);

            if (artifactStart) {
              chunks.push(artifactStart);
              chunkCount++;
            }

            accumulatedText = ''; // Clear accumulated text
            logger.info('[stream-text] Found artifact start, discarded preamble text');
          }

          // If not found yet, continue accumulating
          continue;
        }

        // Once we've found the artifact start, buffer all subsequent chunks
        chunks.push(chunk);
        chunkCount++;

        // Log every 10 chunks
        if (chunkCount % 10 === 0) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          logger.info(`[stream-text] Received ${chunkCount} chunks (${elapsed}s)`);
        }
      }

      streamComplete = true;

      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.info(`[stream-text] Ollama stream complete, ${chunks.length} chunks in ${totalTime}s`);

      // Log the complete response to debug
      const fullResponse = chunks.join('');
      logger.info(`[stream-text] Full response length: ${fullResponse.length} chars`);
      logger.info(`[stream-text] Response starts with: ${fullResponse.substring(0, 100)}`);

      if (fullResponse.includes('<boltArtifact')) {
        logger.info('[stream-text] Response contains <boltArtifact> tag');
      } else {
        logger.error('[stream-text] Response does NOT contain <boltArtifact> tag!');
      }
    } catch (error) {
      streamError = error instanceof Error ? error : new Error(String(error));
      logger.error('[stream-text] Ollama stream error:', streamError);
    }
  })();

  // Generator for fullStream that yields buffered chunks with proper type
  async function* fullStreamGenerator() {
    let index = 0;

    while (!streamComplete || index < chunks.length) {
      // Wait for new chunks
      while (index >= chunks.length && !streamComplete && !streamError) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // Yield available chunks
      while (index < chunks.length) {
        yield {
          type: 'text-delta' as const,
          textDelta: chunks[index],
        };
        index++;
      }

      // Check for errors
      if (streamError) {
        yield {
          type: 'error' as const,
          error: streamError,
        };
        break;
      }

      // Exit if complete
      if (streamComplete && index >= chunks.length) {
        break;
      }
    }
  }

  return {
    fullStream: fullStreamGenerator(),
    mergeIntoDataStream(dataStream: any) {
      // Return a promise so the caller can await the streaming to complete
      return new Promise<void>((resolve, reject) => {
        (async () => {
          try {
            let index = 0;

            while (!streamComplete || index < chunks.length) {
              // Wait for new chunks
              while (index >= chunks.length && !streamComplete && !streamError) {
                await new Promise((r) => setTimeout(r, 10));
              }

              // Write chunks using DataStreamWriter.write() method
              while (index < chunks.length) {
                const chunk = chunks[index];

                // DataStreamWriter.write() expects DataStreamString format: "0:text\n"
                const formatted = `0:${JSON.stringify(chunk)}\n`;
                dataStream.write(formatted);
                index++;
              }

              // Check for errors
              if (streamError) {
                logger.error('[stream-text] Stream error:', streamError);
                reject(streamError);

                return;
              }

              // Exit if complete
              if (streamComplete && index >= chunks.length) {
                logger.info(`[stream-text] Finished merging ${index} chunks`);
                resolve();

                return;
              }
            }
          } catch (err) {
            logger.error('[stream-text] Error in mergeIntoDataStream:', err);
            reject(err);
          }
        })();
      });
    },
    toDataStreamResponse: () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          let index = 0;

          while (!streamComplete || index < chunks.length) {
            // Wait for new chunks
            while (index >= chunks.length && !streamComplete && !streamError) {
              await new Promise((resolve) => setTimeout(resolve, 10));
            }

            // Enqueue chunks in AI SDK protocol format: 0:"text"\n
            while (index < chunks.length) {
              const formatted = `0:${JSON.stringify(chunks[index])}\n`;
              controller.enqueue(encoder.encode(formatted));
              index++;
            }

            if (streamError) {
              controller.error(streamError);
              return;
            }

            if (streamComplete && index >= chunks.length) {
              controller.close();
              return;
            }
          }
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Vercel-AI-Data-Stream': 'v1',
        },
      });
    },
  };
}
