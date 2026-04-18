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
  const currentDateIso = new Date().toISOString().slice(0, 10);

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
When the user selects a template (you'll see a message like "I have selected the ... template"), you MUST follow this procedure:
1. Acknowledge their template choice briefly (1 sentence).
1.5. Treat the selected template's title and description as VISUAL STYLING guidance only. Keep the base layout skeleton and page composition rules from the system prompt intact across all pages/routes.
2. If the user's request already specifies pages, content, data, or design direction, DO NOT ask follow-up questions. Infer reasonable defaults and generate the application immediately.
2.5. If the original request includes "subsequent pages", "multiple pages", "separate pages", or named destinations, preserve that as a multi-page requirement and generate real routes/files immediately.
3. Only ask a SINGLE concise clarification question if a missing detail would materially block implementation.
4. For standard brochure, dashboard, sports, portfolio, or informational websites, default to immediate generation rather than a Q&A round.
5. If the user has answered prior questions with short responses like "no", "none", or "use defaults", treat that as permission to proceed immediately with strong defaults and no more questions.`
      : '';

  const templateLayoutBlock = !hasExistingProject
    ? `
TEMPLATE LAYOUT ENFORCEMENT:
When you are offering templates in the first response:
- The 3 templates must differ primarily by visual styling, not by base layout structure.
- Template differences should focus on mood, palette, typography feel, border treatment, card treatment, imagery style, and density of decoration.
- Do NOT use the templates to change the underlying page skeleton. The global base layout template remains the same unless the user explicitly asks for a different layout.
- All pages must still follow the same shared shell, navbar placement, and internal-page composition rules from the main system prompt.

When the user selects a template and you ask follow-up questions:
- Ask about pages/routes, not just sections.
- Ask for the exact navbar items.
- If the original request already specified a multi-page app or named multiple destinations, preserve that structure in your questions instead of reframing it as a single-page site.
- If the original request says "landing page" plus "subsequent pages", treat the landing page as \`index.html\` and the subsequent topics as separate route files/components.
- When you later generate a static multi-page site, make sure every page includes the same head assets and styling strategy so route navigation never falls back to unstyled HTML.
- When you later generate the site, apply the selected template's visual styling consistently on every route while preserving the same base layout standards across the entire app.
`
    : '';

  const finalSystemMessage =
    chatMode === 'build'
      ? `${systemMessage}

CURRENT DATE CONTEXT:
Today's date is ${currentDateIso}. For time-sensitive or current-topic websites, use the user's requested year, season, or date when provided. If the user does not provide one, label content relative to this date and use stable recognized facts when confident. If exact live details may be uncertain, keep the requested structure and mark uncertain slots as "TBD" or "to be confirmed" instead of omitting them.

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
- If the user requested multiple pages, create one real \`.html\` file for each requested top-level page. Do not satisfy page requests with only \`index.html\` plus anchor links.
- If the user requested a landing page plus subsequent pages, use \`index.html\` for the landing page and create separate files for the subsequent topics, such as \`races.html\` and \`drivers.html\`.
- Every generated HTML page must include its own complete \`<head>\`, the shared styling assets, the shared navigation shell, and substantive designed main content.
- Example for a static site:

I'll set up a premium, dark-themed static website for you.

<boltArtifact id="project" title="Premium Static Website">
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
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Formula 1 | Grand Prix Hub</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-950 font-sans text-slate-200 antialiased min-h-screen">
  <nav class="sticky top-0 z-50 bg-slate-950/80 backdrop-blur-md border-b border-white/10 px-6 py-4">
    <div class="max-w-7xl mx-auto flex justify-between items-center">
      <span class="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">PREMIUM</span>
      <div class="hidden md:flex gap-8 text-sm font-medium tracking-wide">
        <a href="#" class="text-slate-300 hover:text-white transition-colors">Platform</a>
        <a href="#" class="text-slate-300 hover:text-white transition-colors">Solutions</a>
        <a href="#" class="text-slate-300 hover:text-white transition-colors">Pricing</a>
      </div>
      <button class="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-full text-sm font-semibold transition-all shadow-lg shadow-indigo-500/20">Get Started</button>
    </div>
  </nav>

  <main>
    <section class="relative pt-24 pb-32 px-6 overflow-hidden text-center">
      <div class="absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,#312e81,transparent)] opacity-40"></div>
      <img src="https://loremflickr.com/1200/800/race,car?lock=11" alt="Racing Background" class="absolute inset-0 w-full h-full object-cover opacity-20 -z-10 animate-pulse" crossorigin="anonymous">
      <div class="max-w-7xl mx-auto relative z-10">
        <h1 class="text-6xl md:text-8xl font-black tracking-tighter text-white mb-8 leading-[1.1]">
          The Pinnacle of <span class="text-transparent bg-clip-text bg-gradient-to-r from-red-600 via-zinc-400 to-red-400">Racing</span>
        </h1>
        <p class="text-xl md:text-2xl text-slate-400 mb-12 max-w-3xl mx-auto leading-relaxed">
          Experience the ultimate Formula 1 dashboard. Real-time telemetry, factual driver standings, and immersive race analytics.
        </p>
        <div class="flex flex-col sm:flex-row gap-5 justify-center">
          <button class="bg-white text-slate-950 px-10 py-4 rounded-full font-bold text-lg hover:bg-slate-200 transition-all shadow-xl">Start Building Now</button>
          <button class="bg-white/5 backdrop-blur-md border border-white/10 px-10 py-4 rounded-full font-bold text-lg hover:border-white/30 transition-all">Watch Demo</button>
        </div>
      </div>
    </section>

    <section class="max-w-7xl mx-auto px-6 py-24 border-t border-white/5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
      <!-- 8 Feature cards... -->
      <div class="group p-8 rounded-3xl bg-white/5 border border-white/10 hover:border-indigo-500/50 transition-all hover:-translate-y-2">
        <div class="w-12 h-12 bg-indigo-500/20 rounded-xl flex items-center justify-center mb-6">
          <svg class="w-6 h-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
        </div>
        <h3 class="text-xl font-bold text-white mb-3">Lightning Fast</h3>
        <p class="text-slate-400 leading-relaxed text-sm">Optimized performance engines delivering sub-millisecond response times across global availability zones.</p>
      </div>
      <!-- Repeat 7 more unique cards here... -->
    </section>

    <!-- More sections: Gallery, Data List, FAQ, etc. -->
  </main>

  <footer class="bg-slate-950 px-6 py-20 border-t border-white/10">
    <div class="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-12 text-sm text-slate-500">
      <div class="col-span-2 md:col-span-1">
        <span class="text-xl font-bold text-white mb-6 block">PREMIUM</span>
        <p class="leading-relaxed mb-6">Building the next generation of high-fidelity digital infrastructure.</p>
      </div>
      <!-- Footer columns... -->
    </div>
  </footer>
</body>
</html>
</boltAction>
<boltAction type="shell">npm install</boltAction>
<boltAction type="start">npm run start</boltAction>
</boltArtifact>

The site is now running! You can see it in the preview panel.

FOR REACT/VITE PROJECTS:
- Create package.json with dependencies and dev script
- ALWAYS run <boltAction type="shell">npm install</boltAction> BEFORE the start action
- Then start with <boltAction type="start">npm run dev</boltAction>
- If the user requested multiple pages, install and wire \`react-router-dom\`, create a route component for each requested top-level page, and use real routes instead of only conditionally scrolling sections.
- Example for a React app:

I'll create a premium React application for you.

<boltArtifact id="react-app" title="Premium React Application">
<boltAction type="file" filePath="package.json">{
  "name": "my-app",
  "scripts": { "dev": "vite" },
  "dependencies": { "react": "^18.2.0", "react-dom": "^18.2.0" },
  "devDependencies": { "@vitejs/plugin-react": "^3.1.0", "vite": "^4.2.0", "autoprefixer": "^10.4.18", "postcss": "^8.4.35", "tailwindcss": "^3.4.1" }
}</boltAction>
<boltAction type="file" filePath="index.html">
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>React App</title>
  </head>
  <body class="bg-slate-950">
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
</boltAction>
<boltAction type="file" filePath="tailwind.config.js">
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: { 950: '#020617', 900: '#0f172a' }
      }
    },
  },
  plugins: [],
}
</boltAction>
<boltAction type="file" filePath="src/index.css">
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  body { @apply text-slate-200 antialiased; }
}
</boltAction>
<boltAction type="file" filePath="src/main.jsx">
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
</boltAction>
<boltAction type="file" filePath="src/App.jsx">
import React from 'react';
import { Rocket, Shield, Zap, Globe, Cpu, BarChart3, Users, MessageSquare } from 'lucide-react';

const FeatureCard = ({ icon: Icon, title, description }) => (
  <div className="group p-8 rounded-3xl bg-white/5 border border-white/10 hover:border-indigo-500/50 transition-all hover:-translate-y-2">
    <div className="w-12 h-12 bg-indigo-500/20 rounded-xl flex items-center justify-center mb-6 transition-colors group-hover:bg-indigo-500/30">
      <Icon className="w-6 h-6 text-indigo-400" />
    </div>
    <h3 className="text-xl font-bold text-white mb-3">{title}</h3>
    <p className="text-slate-400 leading-relaxed text-sm">{description}</p>
  </div>
);

export default function App() {
  const drivers = [
    { name: "Max Verstappen", team: "Red Bull Racing", description: "3x World Champion." },
    { name: "Lewis Hamilton", team: "Mercedes-AMG", description: "7x World Champion." },
    { name: "Lando Norris", team: "McLaren", description: "Rising star." },
    { name: "Charles Leclerc", team: "Scuderia Ferrari", description: "Qualifying master." }
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 antialiased select-none">
      <nav className="sticky top-0 z-50 bg-slate-950/80 backdrop-blur-md border-b border-white/10 px-6 py-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center text-sm font-medium">
          <span className="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">PREMIUM</span>
          <div className="hidden md:flex gap-8 text-slate-400">
            <a href="#" className="hover:text-white transition-colors underline decoration-transparent hover:decoration-indigo-500 underline-offset-8 decoration-2 duration-300">Platform</a>
            <a href="#" className="hover:text-white transition-colors">Solutions</a>
            <a href="#" className="hover:text-white transition-colors">Enterprise</a>
            <a href="#" className="hover:text-white transition-colors">Pricing</a>
          </div>
          <button className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-full font-semibold transition-all">Get Started</button>
        </div>
      </nav>

      <main>
        <section className="relative pt-32 pb-48 px-6 text-center overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,#312e81,transparent)] opacity-40 animate-pulse"></div>
          <img src="https://loremflickr.com/1200/800/race,car?lock=12" alt="Racing Car" className="absolute inset-0 w-full h-full object-cover opacity-20 -z-10 shadow-inner" crossorigin="anonymous" />
          <div className="max-w-7xl mx-auto relative z-10">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-indigo-400 text-xs font-bold mb-8 tracking-[0.2em] uppercase">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
              </span>
              Now Processing Version 2025
            </div>
            <h1 className="text-6xl md:text-9xl font-black text-white mb-12 tracking-tight leading-[0.9]">
              Elite <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-500 via-orange-500 to-yellow-500">Performance</span>
            </h1>
            <p className="text-xl md:text-2xl text-slate-400 max-w-3xl mx-auto mb-16 font-light leading-relaxed">
              Tracking the 2024 FIA Formula One World Championship with precision data and immersive visuals.
            </p>
            <div className="flex flex-col sm:flex-row gap-6 justify-center">
              <button className="bg-white text-slate-950 px-12 py-5 rounded-full font-black text-xl hover:scale-105 transition-all shadow-2xl">Start Building Now</button>
              <button className="bg-white/5 backdrop-blur-md border border-white/10 px-12 py-5 rounded-full font-black text-xl hover:bg-white/10 transition-all">Watch 2025 Demo</button>
            </div>
          </div>
        </section>

        <section className="max-w-7xl mx-auto px-6 py-32 border-t border-white/5">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {features.map((f, i) => <FeatureCard key={i} {...f} />)}
          </div>
        </section>

        <section className="bg-slate-900/50 py-20 border-y border-white/5 text-center">
            <h2 className="text-3xl font-bold text-white mb-8">99.9% Uptime SLA</h2>
        </section>
      </main>

      <footer className="bg-slate-950 px-6 py-24 border-t border-white/10">
        <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-16 text-sm">
           <div className="col-span-2 md:col-span-1">
              <span className="text-2xl font-black text-white mb-8 block">PREMIUM</span>
              <p className="text-slate-500 leading-relaxed mb-8">Building the high-fidelity infrastructure of our digital future. Tailored for excellence.</p>
           </div>
           <div>
              <h4 className="text-white font-bold mb-6">Product</h4>
              <ul className="space-y-4 text-slate-500"><li>Changelog</li><li>Documentation</li><li>Real-time Stats</li><li>Security</li></ul>
           </div>
           <div>
              <h4 className="text-white font-bold mb-6">Company</h4>
              <ul className="space-y-4 text-slate-500"><li>About Us</li><li>Careers</li><li>Press</li><li>Privacy</li></ul>
           </div>
           <div>
              <h4 className="text-white font-bold mb-6">Social</h4>
              <ul className="space-y-4 text-slate-500"><li>Twitter</li><li>LinkedIn</li><li>GitHub</li><li>Discord</li></ul>
           </div>
        </div>
      </footer>
    </div>
  );
}
</boltAction>
<boltAction type="shell">npm install</boltAction>
<boltAction type="start">npm run dev</boltAction>
</boltArtifact>

Your React app is now running! The dev server is started and you should see it in the preview. You can customize the components in the src/ folder.

NEVER use echo commands or npm start without a package.json. ALWAYS use <boltAction type="start"> (not type="shell") for starting servers. ALWAYS run npm install before starting if there are dependencies.

WEBSITE HARD RULES:
- For website and web app requests, do NOT output sparse article-style pages with a title and a few paragraphs only.
- The main content area must absorb leftover height using designed sections such as hero panels, stat strips, card grids, schedule tables, media bands, or spotlight sections. Never make the footer tall to fill space.
- The default footer must remain compact by default, approximately navbar-height unless extra footer content is intentionally added.
- If the user asks for pages like Home, About, Drivers, Races, Teams, Schedule, or similar, each page must contain multiple designed sections and visible layout structure.
- If the user says "subsequent pages", "multiple pages", "separate pages", "pages for", or "landing page plus", create real routes/files for those pages. A single \`index.html\` with sections or \`#anchors\` is a failure.
- Navigation labels are a route contract: every top-level nav destination must point to a real generated page/route unless the user explicitly requested a single-page anchor layout.
- If the user asks for drivers, races, standings, schedules, products, services, locations, or people, present them using cards, tiles, tables, schedules, or visual information panels rather than plain paragraphs.
- If the user requests a count such as "top 10 drivers" or "all 20 drivers", output that full count. Fewer items is a failure.
- If the user says they do not want buttons, omit buttons and strengthen the layout with cards, stats, imagery, bands, and structured sections instead.
- For sports or automotive subjects, prefer a dashboard/editorial layout with a bold hero, stats rail, featured event block, and dense card or table sections.

${templateOfferBlock}
${templateSelectionBlock}
${templateLayoutBlock}
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
