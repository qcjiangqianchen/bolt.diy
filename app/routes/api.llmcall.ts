import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { streamText } from '~/lib/.server/llm/stream-text';
import { generateText } from 'ai';
import { MAX_TOKENS, isReasoningModel } from '~/lib/.server/llm/constants';
import { getModel } from '~/lib/.server/llm/model-factory';
import { createScopedLogger } from '~/utils/logger';

export async function action(args: ActionFunctionArgs) {
  return llmCallAction(args);
}

const logger = createScopedLogger('api.llmcall');

async function llmCallAction({ context, request }: ActionFunctionArgs) {
  const { system, message, streamOutput } = await request.json<{
    system: string;
    message: string;
    model?: string;
    provider?: any;
    streamOutput?: boolean;
  }>();

  const serverEnv = context.cloudflare?.env as any;

  if (streamOutput) {
    try {
      const result = await streamText({
        options: {},
        messages: [
          {
            role: 'user',
            content: `${message}`,
          },
        ],
        env: serverEnv,
      });

      return result.toDataStreamResponse();
    } catch (error: unknown) {
      console.log(error);

      if (error instanceof Error && error.message?.includes('API key')) {
        throw new Response('Invalid or missing API key', {
          status: 401,
          statusText: 'Unauthorized',
        });
      }

      if (
        error instanceof Error &&
        (error.message?.includes('max_tokens') ||
          error.message?.includes('token') ||
          error.message?.includes('exceeds') ||
          error.message?.includes('maximum'))
      ) {
        throw new Response(
          `Token limit error: ${error.message}. Try reducing your request size or using a model with higher token limits.`,
          {
            status: 400,
            statusText: 'Token Limit Exceeded',
          },
        );
      }

      throw new Response(null, {
        status: 500,
        statusText: 'Internal Server Error',
      });
    }
  } else {
    try {
      const resolved = getModel(serverEnv);
      const dynamicMaxTokens = Math.min(MAX_TOKENS, 16384);
      const isReasoning = isReasoningModel(resolved.modelId);

      logger.info(`Generating response Provider: ${resolved.providerName}, Model: ${resolved.modelId}`);

      const tokenParams = isReasoning ? { maxCompletionTokens: dynamicMaxTokens } : { maxTokens: dynamicMaxTokens };

      const baseParams = {
        system,
        messages: [
          {
            role: 'user' as const,
            content: `${message}`,
          },
        ],
        model: resolved.model,
        ...tokenParams,
        toolChoice: 'none' as const,
      };

      const finalParams = isReasoning ? { ...baseParams, temperature: 1 } : { ...baseParams, temperature: 0 };

      const result = await generateText(finalParams);
      logger.info(`Generated response`);

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    } catch (error: unknown) {
      console.log(error);

      const errorResponse = {
        error: true,
        message: error instanceof Error ? error.message : 'An unexpected error occurred',
        statusCode: (error as any).statusCode || 500,
        isRetryable: (error as any).isRetryable !== false,
        provider: 'server',
      };

      if (error instanceof Error && error.message?.includes('API key')) {
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

      if (
        error instanceof Error &&
        (error.message?.includes('max_tokens') ||
          error.message?.includes('token') ||
          error.message?.includes('exceeds') ||
          error.message?.includes('maximum'))
      ) {
        return new Response(
          JSON.stringify({
            ...errorResponse,
            message: `Token limit error: ${error.message}. Try reducing your request size or using a model with higher token limits.`,
            statusCode: 400,
            isRetryable: false,
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            statusText: 'Token Limit Exceeded',
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
}
