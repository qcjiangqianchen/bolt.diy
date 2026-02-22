import { json } from '@remix-run/cloudflare';

interface ModelsResponse {
  modelList: any[];
  providers: any[];
  defaultProvider: any;
}

export async function loader({
  request: _request,
  context,
}: {
  request: Request;
  context: {
    cloudflare?: {
      env: Record<string, string>;
    };
  };
}) {
  // Return only Ollama as the provider since we're using local model only
  const ollamaModel = context.cloudflare?.env?.OLLAMA_MODEL || 'qwen2.5-coder:14b';

  const response: ModelsResponse = {
    modelList: [
      {
        name: ollamaModel,
        label: ollamaModel,
        provider: 'Ollama',
        maxTokenAllowed: 8000,
      },
    ],
    providers: [
      {
        name: 'Ollama',
        staticModels: [
          {
            name: ollamaModel,
            label: ollamaModel,
            provider: 'Ollama',
            maxTokenAllowed: 8000,
          },
        ],
        getApiKeyLink: undefined,
        labelForGetApiKey: undefined,
        icon: undefined,
      },
    ],
    defaultProvider: {
      name: 'Ollama',
      staticModels: [
        {
          name: ollamaModel,
          label: ollamaModel,
          provider: 'Ollama',
          maxTokenAllowed: 8000,
        },
      ],
      getApiKeyLink: undefined,
      labelForGetApiKey: undefined,
      icon: undefined,
    },
  };

  return json(response);
}
