import { useState } from 'react';
import type { ProviderInfo } from '~/types/model';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('usePromptEnhancement');

export function usePromptEnhancer() {
  const [enhancingPrompt, setEnhancingPrompt] = useState(false);
  const [promptEnhanced, setPromptEnhanced] = useState(false);

  const resetEnhancer = () => {
    setEnhancingPrompt(false);
    setPromptEnhanced(false);
  };

  const enhancePrompt = async (
    _input: string,
    _setInput: (value: string) => void,
    _model: string,
    _provider: ProviderInfo,
    _apiKeys?: Record<string, string>,
  ) => {
    // Stub - Prompt enhancement disabled
    logger.warn('Prompt enhancement is disabled');
    setEnhancingPrompt(false);
    setPromptEnhanced(false);

    return;
  };

  return { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer };
}
