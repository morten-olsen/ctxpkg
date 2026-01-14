import { ChatOpenAI } from '@langchain/openai';
import { createAgent as createLangchainAgent, type ReactAgent } from 'langchain';

import { config } from '../config/config.ts';

const createAgent = async (tools: any[], systemPrompt: string): Promise<ReactAgent> => {
  const model = new ChatOpenAI({
    model: config.get('openai.model'),
    temperature: config.get('openai.temperature'),
    apiKey: config.get('openai.apiKey'),
    configuration: {
      baseURL: config.get('openai.baseUrl'),
    },
  });

  const agent = createLangchainAgent({
    model,
    tools,
    systemPrompt,
  });

  return agent;
};

export { createAgent };
