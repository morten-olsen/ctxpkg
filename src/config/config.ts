import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

import convict from 'convict';
import envPaths from 'env-paths';

const paths = envPaths('ai-assist');
const configPath = join(paths.config, 'config.json');

const config = convict({
  openai: {
    apiKey: {
      doc: 'The API key for the OpenAI compatible provider',
      format: String,
      default: '',
      env: 'OPENAI_API_KEY',
      sensitive: true,
    },
    baseUrl: {
      doc: 'The base URL for the API (optional)',
      format: String,
      default: 'https://api.openai.com/v1',
      env: 'OPENAI_BASE_URL',
    },
    model: {
      doc: 'The model to use',
      format: String,
      default: 'gpt-4o',
      env: 'OPENAI_MODEL',
    },
    temperature: {
      doc: 'The temperature for generation',
      format: Number,
      default: 0,
    },
  },
});

// Ensure config directory exists for future writes, but don't fail if we can't read yet
if (existsSync(configPath)) {
  try {
    config.loadFile(configPath);
  } catch (e) {
    console.warn(`Failed to load config from ${configPath}:`, e);
  }
}

config.validate({ allowed: 'strict' });

export { config, configPath };

export const saveConfig = () => {
  if (!existsSync(paths.config)) {
    mkdirSync(paths.config, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(config.get(), null, 2));
};
