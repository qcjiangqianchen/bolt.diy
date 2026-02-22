interface OllamaConfig {
  baseURL: string;
  model: string;
}

export class OllamaProvider {
  private _baseURL: string;
  private _model: string;

  constructor(config: OllamaConfig) {
    this._baseURL = config.baseURL;
    this._model = config.model;
  }

  async *streamChat(messages: Array<{ role: string; content: string }>) {
    console.log('[Ollama] Starting stream to', this._baseURL);

    const response = await fetch(`${this._baseURL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this._model,
        messages,
        stream: true,
        options: {
          temperature: 0.7,
          num_predict: 8192,
        },
      }),
    });

    if (!response.ok) {
      console.error('[Ollama] HTTP error:', response.status, response.statusText);
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    console.log('[Ollama] Got response, reading stream...');

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error('No reader available');
    }

    let chunkCount = 0;
    let fullResponse = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        console.log(`[Ollama] Stream complete. Total chunks: ${chunkCount}`);
        console.log(`[Ollama] First 500 chars of response: ${fullResponse.substring(0, 500)}`);
        console.log(
          `[Ollama] Last 500 chars of response: ${fullResponse.substring(Math.max(0, fullResponse.length - 500))}`,
        );
        break;
      }

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter((line) => line.trim());

      for (const line of lines) {
        try {
          const json = JSON.parse(line);

          if (json.message?.content) {
            chunkCount++;
            fullResponse += json.message.content;
            yield json.message.content;
          }
        } catch {
          // Skip invalid JSON lines
        }
      }
    }
  }
}
