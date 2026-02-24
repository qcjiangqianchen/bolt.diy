import { convertToCoreMessages, streamText as aiStreamText, type Message } from 'ai';
import { type FileMap } from './constants';
import { getSystemPrompt } from '~/lib/common/prompts/prompts';
import { MODIFICATIONS_TAG_NAME, WORK_DIR } from '~/utils/constants';
import { PromptLibrary } from '~/lib/common/prompt-library';
import { allowedHTMLElements } from '~/utils/markdown';
import { createScopedLogger } from '~/utils/logger';
import { createFilesContext } from './utils';
import { discussPrompt } from '~/lib/common/prompts/discuss-prompt';
import type { DesignScheme } from '~/types/design-scheme';
import { getModel } from './model-factory';

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
  onStepFinish?: (event: { toolCalls: any[] }) => void;
  onFinish?: (event: { text: string; finishReason: string; usage: any }) => void;
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

  // Resolve model from env-driven factory (provider-agnostic)
  const { model, modelId, providerName } = getModel(serverEnv);

  logger.info(`Using ${providerName} model: ${modelId}`);

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

  logger.info(`[stream-text] System prompt first 500 chars: ${finalSystemMessage.substring(0, 500)}`);
  logger.info(`[stream-text] Chat mode: ${chatMode}`);

  // Convert messages to core format for the AI SDK
  const coreMessages = convertToCoreMessages(processedMessages as any);

  // Use the AI SDK's streamText — works with any provider returned by getModel()
  const result = aiStreamText({
    model,
    system: finalSystemMessage,
    messages: coreMessages,
    temperature: 0.7,
    maxTokens: 8192,
    ...(options?.onStepFinish ? { onStepFinish: options.onStepFinish } : {}),
    ...(options?.onFinish ? { onFinish: options.onFinish } : {}),
  });

  return result;
}
