/**
 * Model Factory — Provider-agnostic LLM resolution via environment variables.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  HOW TO PLUG IN A NEW LLM                                       │
 * │                                                                  │
 * │  1. Set env vars (in .env.local, docker-compose, or wrangler):  │
 * │       LLM_PROVIDER=ollama          # or: openai, anthropic, …   │
 * │       LLM_MODEL=qwen2.5-coder:14b # model id for the provider  │
 * │       LLM_BASE_URL=http://127.0.0.1:11434  # (optional)        │
 * │       LLM_API_KEY=sk-xxx           # (optional, for cloud LLMs) │
 * │                                                                  │
 * │  2. Restart the app                                              │
 * │                                                                  │
 * │  Supported LLM_PROVIDER values:                                  │
 * │    ollama      → local Ollama (default)                          │
 * │    openai      → OpenAI / any OpenAI-compatible API              │
 * │    anthropic   → Anthropic Claude                                │
 * │    google      → Google Gemini                                   │
 * │    mistral     → Mistral AI                                      │
 * │    deepseek    → DeepSeek                                        │
 * │    openrouter  → OpenRouter                                      │
 * │    (add more below as needed)                                    │
 * └──────────────────────────────────────────────────────────────────┘
 */

import { createScopedLogger } from '~/utils/logger';
import { createOllama } from 'ollama-ai-provider';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

const logger = createScopedLogger('model-factory');

/**
 * Reads an env var from the Cloudflare-style `Env` object (server-side)
 * or falls back to process.env / import.meta.env.
 */
function getEnv(serverEnv: Env | undefined, key: string, fallback: string = ''): string {
  // Cloudflare Workers / Wrangler bindings
  if (serverEnv && (serverEnv as any)[key]) {
    return (serverEnv as any)[key];
  }

  // Node process.env (Docker / local dev)
  if (typeof process !== 'undefined' && process.env?.[key]) {
    return process.env[key]!;
  }

  return fallback;
}

export interface ResolvedModel {
  /** The AI SDK LanguageModel instance — pass directly to `streamText({ model })` */
  model: any;

  /** Human-readable model id, e.g. "qwen2.5-coder:14b" */
  modelId: string;

  /** Provider name for logging, e.g. "ollama" */
  providerName: string;
}

/**
 * Returns an AI SDK `LanguageModel` based on env vars.
 * Lazy-imports only the provider package actually needed.
 */
export function getModel(serverEnv?: Env): ResolvedModel {
  const providerName = getEnv(serverEnv, 'LLM_PROVIDER', 'ollama').toLowerCase();
  const modelId = getEnv(serverEnv, 'LLM_MODEL', 'qwen2.5-coder:14b');
  const baseURL = getEnv(serverEnv, 'LLM_BASE_URL', '');
  const apiKey = getEnv(serverEnv, 'LLM_API_KEY', '');

  // Legacy fallback: honour old OLLAMA_* env vars if LLM_PROVIDER not explicitly set
  const isLegacyOllama =
    !getEnv(serverEnv, 'LLM_PROVIDER') &&
    (getEnv(serverEnv, 'OLLAMA_API_BASE_URL') || getEnv(serverEnv, 'OLLAMA_MODEL'));

  const effectiveProvider = isLegacyOllama ? 'ollama' : providerName;
  const effectiveModel = isLegacyOllama ? getEnv(serverEnv, 'OLLAMA_MODEL', 'qwen2.5-coder:14b') : modelId;
  const effectiveBaseURL = isLegacyOllama
    ? getEnv(serverEnv, 'OLLAMA_API_BASE_URL', 'http://127.0.0.1:11434')
    : baseURL;

  logger.info(`Resolving model: provider=${effectiveProvider}, model=${effectiveModel}`);

  switch (effectiveProvider) {
    // ── Ollama (local) ──────────────────────────────────────────────
    case 'ollama': {
      const url = effectiveBaseURL || 'http://127.0.0.1:11434';
      const ollamaProvider = createOllama({ baseURL: `${url}/api` });

      return { model: ollamaProvider(effectiveModel), modelId: effectiveModel, providerName: 'ollama' };
    }

    // ── OpenAI / OpenAI-compatible ──────────────────────────────────
    case 'openai': {
      const openai = createOpenAI({
        ...(apiKey ? { apiKey } : {}),
        ...(effectiveBaseURL ? { baseURL: effectiveBaseURL } : {}),
      });
      return { model: openai(effectiveModel), modelId: effectiveModel, providerName: 'openai' };
    }

    // ── Anthropic ──────────────────────────────────────────────────
    case 'anthropic': {
      const anthropic = createAnthropic({
        ...(apiKey ? { apiKey } : {}),
        ...(effectiveBaseURL ? { baseURL: effectiveBaseURL } : {}),
      });
      return { model: anthropic(effectiveModel), modelId: effectiveModel, providerName: 'anthropic' };
    }

    // ── Google Gemini ──────────────────────────────────────────────
    case 'google': {
      const google = createGoogleGenerativeAI({
        ...(apiKey ? { apiKey } : {}),
        ...(effectiveBaseURL ? { baseURL: effectiveBaseURL } : {}),
      });
      return { model: google(effectiveModel), modelId: effectiveModel, providerName: 'google' };
    }

    // ── Mistral ────────────────────────────────────────────────────
    case 'mistral': {
      const mistral = createMistral({
        ...(apiKey ? { apiKey } : {}),
        ...(effectiveBaseURL ? { baseURL: effectiveBaseURL } : {}),
      });
      return { model: mistral(effectiveModel), modelId: effectiveModel, providerName: 'mistral' };
    }

    // ── DeepSeek ───────────────────────────────────────────────────
    case 'deepseek': {
      const deepseek = createDeepSeek({
        ...(apiKey ? { apiKey } : {}),
        ...(effectiveBaseURL ? { baseURL: effectiveBaseURL } : {}),
      });
      return { model: deepseek(effectiveModel), modelId: effectiveModel, providerName: 'deepseek' };
    }

    // ── OpenRouter ─────────────────────────────────────────────────
    case 'openrouter': {
      const openrouter = createOpenRouter({
        ...(apiKey ? { apiKey } : {}),
      });
      return { model: openrouter(effectiveModel), modelId: effectiveModel, providerName: 'openrouter' };
    }

    // ── OpenAI-compatible (LM Studio, vLLM, text-gen-webui, etc.) ──
    case 'openai-compatible': {
      if (!effectiveBaseURL) {
        throw new Error('LLM_BASE_URL is required for openai-compatible provider');
      }

      const compat = createOpenAI({
        baseURL: effectiveBaseURL,
        ...(apiKey ? { apiKey } : { apiKey: 'not-needed' }),
      });

      return { model: compat(effectiveModel), modelId: effectiveModel, providerName: 'openai-compatible' };
    }

    // ── Fallback: treat as OpenAI-compatible ───────────────────────
    default: {
      logger.warn(`Unknown provider "${effectiveProvider}", treating as OpenAI-compatible`);

      const compat = createOpenAI({
        ...(apiKey ? { apiKey } : {}),
        ...(effectiveBaseURL ? { baseURL: effectiveBaseURL } : {}),
      });

      return { model: compat(effectiveModel), modelId: effectiveModel, providerName: effectiveProvider };
    }
  }
}
