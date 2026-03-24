import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap,
  Cpu,
  Layers,
  Globe,
  Code,
  Terminal,
  Play,
  ShieldCheck,
  ChevronRight,
  BookOpen,
  ArrowRight,
  Database,
  BarChart3,
} from 'lucide-react';

const ArchitectureGuide = () => {
  const [activeStep, setActiveStep] = useState(0);

  const pillars = [
    {
      title: 'The LLM Brain',
      icon: Cpu,
      color: 'from-blue-500 to-indigo-600',
      description:
        'Uses the Vercel AI SDK to orchestrate real-time streaming between your query and industry-leading models.',
      techs: ['OpenAI', 'Anthropic', 'api.chat.ts', 'stream-text.ts'],
    },
    {
      title: 'WebContainer OS',
      icon: Layers,
      color: 'from-emerald-500 to-teal-600',
      description: 'A full Node.js runtime running INSIDE your browser tab. No remote server needed for previews.',
      techs: ['Virtual POSIX', 'npm/pnpm', 'In-memory FS'],
    },
    {
      title: 'Action Runner',
      icon: Code,
      color: 'from-orange-500 to-red-600',
      description: "Intercepts AI response tags in real-time and 'types' them into the file system or terminal.",
      techs: ['MessageParser', 'ActionRunner.ts', 'shell.ts'],
    },
    {
      title: 'Shadow Deploy',
      icon: Globe,
      color: 'from-purple-500 to-pink-600',
      description: 'Packages apps into Docker containers and injects analytics invisibly during the move to Fly.io.',
      techs: ['Docker', 'Fly.io', 'api.deploy-docker.ts', 'api.stats.ts'],
    },
  ];

  const flow = [
    {
      title: 'Prompt Input',
      stage: 'Frontend - Chat.client.tsx',
      content:
        'You type a request. The app creates a snapshot of your current files and combines it with a massive system prompt (the rules of Bolt).',
      icon: Zap,
    },
    {
      title: 'LLM Streaming',
      stage: 'Backend - api.chat.ts',
      content:
        'The AI responds using specialized XML tags like <boltAction>. The frontend parser reads these immediately, even before the AI finishes speaking.',
      icon: Play,
    },
    {
      title: 'Virtual Execution',
      stage: 'Runtime - WebContainer',
      content:
        "The Action Runner sees an 'npm install' or 'file creation' tag and executes it in your tab's virtual sandbox.",
      icon: Terminal,
    },
    {
      title: 'Local Preview',
      stage: 'UI - Preview.tsx',
      content:
        'The WebContainer starts a dev server (port 5173). Bolt detects this and proxy-renders the app in your Workbench preview window.',
      icon: BookOpen,
    },
    {
      title: 'Analytics Injection',
      stage: 'Middleware - Service Layer',
      content:
        "When you click 'Deploy', the server reaches into your index.html and dynamically pastes the tracking beacon before sending it to the cloud.",
      icon: ShieldCheck,
    },
    {
      title: 'Production Live',
      stage: 'Cloud - Fly.io',
      content:
        'Your app is now a live Docker container. When users visit, their browser pings your api.stats endpoint to update your view counts.',
      icon: BarChart3,
    },
  ];

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 font-sans selection:bg-indigo-500/30">
      {/* Header */}
      <nav className="border-b border-white/5 bg-slate-950/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Code className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight leading-none">BOLT.DIY</h1>
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                Architecture Explorer
              </span>
            </div>
          </div>
          <div className="flex gap-4">
            <a href="/" className="text-xs font-bold text-slate-400 hover:text-white transition-colors">
              Return to App
            </a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative py-24 px-8 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full bg-[radial-gradient(circle_at_50%_0%,#1e1b4b,transparent_70%)] opacity-30 -z-10" />
        <div className="max-w-5xl mx-auto text-center">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-5xl md:text-7xl font-black tracking-tighter mb-6"
          >
            How the{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-cyan-400 to-indigo-500">
              Magic
            </span>{' '}
            Happens
          </motion.h2>
          <p className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto leading-relaxed">
            Bolt.diy isn't just an AI wrapper. It's an end-to-end engineering environment that virtualizes a full
            dev-stack inside your browser.
          </p>
        </div>
      </section>

      {/* The 4 Pillars */}
      <section className="max-w-7xl mx-auto px-8 py-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {pillars.map((p, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.1 }}
            className="group p-8 rounded-3xl bg-white/5 border border-white/10 hover:border-indigo-500/50 hover:bg-white/[0.07] transition-all relative overflow-hidden"
          >
            <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${p.color}`} />
            <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <p.icon className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-xl font-bold mb-3">{p.title}</h3>
            <p className="text-sm text-slate-400 leading-relaxed mb-6">{p.description}</p>
            <div className="flex flex-wrap gap-2">
              {p.techs.map((t, idx) => (
                <span
                  key={idx}
                  className="text-[10px] font-bold px-2 py-1 rounded bg-black/40 border border-white/5 text-slate-500"
                >
                  {t}
                </span>
              ))}
            </div>
          </motion.div>
        ))}
      </section>

      {/* The User Flow Walkthrough */}
      <section className="max-w-6xl mx-auto px-8 py-32">
        <div className="flex items-center gap-4 mb-16">
          <div className="w-1 px-4 py-1 bg-indigo-500 rounded-full font-bold text-xs">01</div>
          <h2 className="text-3xl font-bold">The Prompt Life-Cycle</h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-16">
          {/* Stepper Nav */}
          <div className="lg:col-span-4 flex flex-col gap-4">
            {flow.map((s, i) => (
              <button
                key={i}
                onClick={() => setActiveStep(i)}
                className={`flex items-center gap-4 p-4 rounded-2xl transition-all text-left ${
                  activeStep === i
                    ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-500/20'
                    : 'bg-white/5 text-slate-500 hover:bg-white/10 hover:text-slate-300'
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center ${activeStep === i ? 'bg-white/20' : 'bg-white/5'}`}
                >
                  <s.icon className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase opacity-60">Step {i + 1}</div>
                  <div className="font-bold text-sm leading-tight">{s.title}</div>
                </div>
                {activeStep === i && <ChevronRight className="w-5 h-5 ml-auto" />}
              </button>
            ))}
          </div>

          {/* Step Detail */}
          <div className="lg:col-span-8 bg-white/5 border border-white/10 rounded-[40px] p-12 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 blur-[120px]" />
            <AnimatePresence mode="wait">
              <motion.div
                key={activeStep}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="relative h-full flex flex-col"
              >
                <div className="flex items-center gap-3 text-indigo-400 mb-6 font-mono text-sm font-bold">
                  <Database className="w-4 h-4" />
                  {flow[activeStep].stage}
                </div>
                <h3 className="text-4xl font-black mb-8 leading-tight">{flow[activeStep].title}</h3>
                <p className="text-xl text-slate-400 leading-relaxed mb-12">{flow[activeStep].content}</p>

                <div className="mt-auto pt-8 border-t border-white/5 flex items-center gap-4">
                  <div className="flex -space-x-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="w-8 h-8 rounded-full border-2 border-[#020617] bg-slate-800" />
                    ))}
                  </div>
                  <span className="text-xs font-bold text-slate-500 italic">Core Pipeline Active</span>
                  <div className="ml-auto flex gap-2">
                    {activeStep > 0 && (
                      <button
                        onClick={() => setActiveStep((prev) => prev - 1)}
                        className="p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
                      >
                        <ChevronRight className="w-5 h-5 rotate-180" />
                      </button>
                    )}
                    {activeStep < flow.length - 1 && (
                      <button
                        onClick={() => setActiveStep((prev) => prev + 1)}
                        className="px-6 py-3 rounded-xl bg-white text-slate-950 font-bold hover:bg-slate-200 transition-all flex items-center gap-2"
                      >
                        Next Step <ArrowRight className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </section>

      {/* Footer / CTA */}
      <footer className="max-w-7xl mx-auto px-8 pt-12 pb-24 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-8">
        <div className="text-slate-500 text-sm">&copy; 2026 Bolt.diy Architectural Systems. Internal Document.</div>
        <div className="flex gap-6 text-xs font-bold text-slate-400">
          <a href="#" className="hover:text-white transition-colors">
            Privacy Policy
          </a>
          <a href="#" className="hover:text-white transition-colors">
            Internal Wiki
          </a>
          <a href="#" className="hover:text-white transition-colors">
            Security Audit
          </a>
        </div>
      </footer>
    </div>
  );
};

export default ArchitectureGuide;
