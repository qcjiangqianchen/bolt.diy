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
  const isFirstMessage = processedMessages.length <= 1;
  const isEarlyConversation = processedMessages.length <= 3;
  const hasExistingProject = contextFiles && Object.keys(contextFiles).length > 0;

  // Block 1: Only shown on the very first message — instructs LLM to offer 3 templates
  const templateOfferBlock =
    isFirstMessage && !hasExistingProject
      ? `
FIRST MESSAGE BEHAVIOR:
When the user sends their FIRST message describing a new project:
1. Briefly acknowledge their request (1-2 sentences max).
2. You MUST offer them EXACTLY 3 distinct visual design templates using the <boltTemplateSelector> tag. ALWAYS provide exactly 3 <template> tags — no more, no fewer.
   - Each template must have a unique id, a descriptive title, an image URL (use Unsplash with ?w=800&q=80), and a short description.
   - The templates should be relevant to the user's request (e.g., for a tennis site, offer tennis/sports-themed templates).
3. After outputting the <boltTemplateSelector>, tell the user to select a template. Then STOP. Do NOT generate any code or <boltArtifact> tags in this first response.

Example of a correct first response:
"Great idea! Let's get started. Please select a template to start with:
<boltTemplateSelector>
  <template id="SaaS-dark" title="Sleek Dark Mode" image="https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=800&q=80" description="A modern, dark-themed template."/>
  <template id="E-commerce-vibrant" title="Vibrant Shopping" image="https://images.unsplash.com/photo-1472851294608-062f824d29cc?w=800&q=80" description="A bright, energetic template for online stores."/>
  <template id="Blog-minimal" title="Clean Reader" image="https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=800&q=80" description="A minimalist blog template focused on typography."/>
</boltTemplateSelector>

Please choose one of the templates to proceed."

CRITICAL RULES FOR FIRST MESSAGE:
- You MUST provide EXACTLY 3 <template> elements inside <boltTemplateSelector>. This is non-negotiable.
- Do NOT generate any code or <boltArtifact> in your first response. Only output the template selector and a brief message.
- NEVER output raw code in the chat. If you absolutely must show code, use <boltArtifact>.`
      : '';

  // Block 2: Shown during the first few messages — instructs LLM to ask questions after template selection
  const templateSelectionBlock =
    isEarlyConversation && !hasExistingProject
      ? `
TEMPLATE SELECTION RESPONSE:
When the user selects a template (you'll see a message like "I have selected the ... template"), you MUST follow this procedure BEFORE generating any code:
1. Acknowledge their template choice briefly (1 sentence).
2. Ask the user 3-5 targeted follow-up questions to gather the information you need to build a great application. Questions should cover:
   - How many pages/sections the site should have, and what each page is about
   - What specific content or features they want on each page (e.g., image galleries, contact forms, data tables)
   - Any branding/style preferences beyond the template (colors, fonts, logos)
   - Any data or functionality requirements (e.g., "list the latest 3 tennis tournaments")
3. CRITICAL: Do NOT generate any code or <boltArtifact> at this stage. Your response should ONLY contain the acknowledgment and questions. Wait for the user to answer your questions first.
4. Only after the user has answered your questions should you proceed to generate the full application code with <boltArtifact>.`
      : '';

  const finalSystemMessage =
    chatMode === 'build'
      ? `${systemMessage}

RESPONSE FORMAT:
(CRITICAL: If you are in the FIRST MESSAGE BEHAVIOR or TEMPLATE SELECTION RESPONSE phase described at the bottom of this prompt, follow those instructions instead and DISREGARD the artifact/code generation rules below until the questions are answered.)

You MUST be conversational and informative. Structure your response like this:
1. First, briefly explain what you're about to do (1-3 sentences). For example: "I'll create a simple tennis webpage with a hero section and player stats." or "Let me update the index.html to add a Roger Federer section below the existing content."
2. Then include the <boltArtifact> block with all necessary file actions.
3. After the closing </boltArtifact> tag, provide a brief summary of what was done and any next steps the user might want to take.

If you encounter an issue or the user's request is unclear:
- Explain what the problem is clearly
- Suggest how the user can fix or clarify their request
- If you can still partially fulfill the request, do so and explain what's missing

IMPORTANT RULES:
- ALWAYS, ALWAYS wrap ALL generated code inside a <boltArtifact> block. NEVER output raw markdown code blocks (like \`\`\`html) directly into the chat response under any circumstances.
- When modifying code, check CONTEXT BUFFER for current files. Only include files that need changes — do NOT recreate unchanged files.
- You MUST create ALL files that are imported or referenced. If a file imports "./styles.css", you MUST include a boltAction to create "styles.css". Never reference a file without creating it first.
- Always create complete, working projects with no missing files.
- EVERY project MUST end with a <boltAction type="start"> to start the dev server. NEVER skip this.

FOR STATIC HTML PROJECTS (no framework, just HTML/CSS/JS):
- You MUST still create a package.json with a start script
- Make sure package.json is the FIRST file you create.
- Use npm run start as the start command
- YOU MUST run <boltAction type="shell">npm install</boltAction> AFTER creating package.json and BEFORE the start action.
- Example for a static site:

I'll set up a simple static website for you.

<boltArtifact id="project" title="Project Title">
<boltAction type="file" filePath="package.json">{
  "name": "my-project",
  "scripts": {
    "start": "vite"
  },
  "devDependencies": {
    "vite": "^5.0.0"
  }
}</boltAction>
<boltAction type="file" filePath="index.html">
<!DOCTYPE html>
...complete HTML content...
</boltAction>
<boltAction type="shell">npm install</boltAction>
<boltAction type="start">npm run start</boltAction>
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

${templateOfferBlock}
${templateSelectionBlock}
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
