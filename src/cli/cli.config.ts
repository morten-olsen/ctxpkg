import type { Command } from 'commander';
import { input, confirm, select } from '@inquirer/prompts';

import {
  formatHeader,
  formatSuccess,
  formatInfo,
  formatWarning,
  formatTableHeader,
  formatTableRow,
  flattenObject,
  withErrorHandling,
  chalk,
} from './cli.utils.ts';

import { config, configPath, saveConfig } from '#root/config/config.ts';

/**
 * Parse a string value to the appropriate type
 */
const parseValue = (key: string, value: string): unknown => {
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Don't convert API keys to numbers
  if (!key.toLowerCase().includes('key') && !isNaN(Number(value)) && value.trim() !== '') {
    return Number(value);
  }

  return value;
};

/**
 * Get the raw value from config, handling sensitive values
 */
const getRawValue = (key: string): unknown => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const value = (config as any).get(key);

  if (value === '[Sensitive]') {
    // Try to get the raw value for display
    const parts = key.split('.');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let current: Record<string, unknown> = (config as any)._properties;

    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part] as Record<string, unknown>;
      } else {
        return value;
      }
    }

    return current;
  }

  return value;
};

const createConfigCli = (command: Command) => {
  command.description('Manage configuration settings');

  // Set a configuration value
  command
    .command('set')
    .argument('<key>', 'Configuration key (e.g., "openai.apiKey")')
    .argument('<value>', 'Value to set')
    .description('Set a configuration value')
    .action(
      withErrorHandling(async (key: string, value: string) => {
        const parsedValue = parseValue(key, value);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (config as any).set(key, parsedValue);
        saveConfig();

        formatSuccess(`Configuration updated`);
        console.log(chalk.dim('  Key:   ') + chalk.cyan(key));
        console.log(chalk.dim('  Value: ') + chalk.yellow(String(parsedValue)));
      }),
    );

  // Get a configuration value
  command
    .command('get')
    .argument('<key>', 'Configuration key to retrieve')
    .description('Get a configuration value')
    .action(
      withErrorHandling(async (key: string) => {
        const value = getRawValue(key);

        if (value === undefined) {
          formatWarning(`Key "${key}" is not set`);
          return;
        }

        console.log(chalk.cyan(String(value)));
      }),
    );

  // Show config file path
  command
    .command('path')
    .description('Show configuration file path')
    .action(() => {
      formatInfo(`Configuration file: ${chalk.cyan(configPath)}`);
    });

  // List all configuration values
  command
    .command('list')
    .alias('ls')
    .description('List all configuration values')
    .option('-a, --all', 'Show all values including sensitive ones')
    .action(
      withErrorHandling(async (options: { all?: boolean }) => {
        const props = config.getProperties();
        const flat = flattenObject(props as Record<string, unknown>);
        const keys = Object.keys(flat).sort();

        if (keys.length === 0) {
          formatInfo('No configuration values set.');
          return;
        }

        formatHeader('Configuration');

        const maxKeyLen = Math.max(...keys.map((k) => k.length), 3);

        formatTableHeader([
          { name: 'Key', width: maxKeyLen },
          { name: 'Value', width: 40 },
        ]);

        for (const key of keys) {
          let value = flat[key];
          let valueColor = chalk.white;

          // Handle sensitive values
          if (value === '[Sensitive]') {
            if (options.all) {
              value = getRawValue(key);
              valueColor = chalk.yellow;
            } else {
              valueColor = chalk.dim;
            }
          }

          formatTableRow([
            { value: key, width: maxKeyLen, color: chalk.white },
            { value: String(value), width: 40, color: valueColor },
          ]);
        }

        console.log();

        if (!options.all) {
          formatInfo('Use --all to show sensitive values');
        }
      }),
    );

  // Interactive set command
  command
    .command('edit')
    .argument('[key]', 'Configuration key to edit')
    .description('Interactively edit a configuration value')
    .action(
      withErrorHandling(async (key?: string) => {
        const props = config.getProperties();
        const flat = flattenObject(props as Record<string, unknown>);
        const keys = Object.keys(flat).sort();

        let selectedKey = key;

        if (!selectedKey) {
          selectedKey = await select({
            message: 'Select a configuration key to edit:',
            choices: keys.map((k) => ({
              name: `${k} = ${flat[k]}`,
              value: k,
            })),
          });
        }

        if (!keys.includes(selectedKey)) {
          const createNew = await confirm({
            message: `Key "${selectedKey}" doesn't exist. Create it?`,
            default: false,
          });

          if (!createNew) {
            formatInfo('Operation cancelled.');
            return;
          }
        }

        const currentValue = flat[selectedKey];
        const newValue = await input({
          message: `Enter new value for "${selectedKey}":`,
          default: currentValue !== '[Sensitive]' ? String(currentValue ?? '') : '',
        });

        const parsedValue = parseValue(selectedKey, newValue);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (config as any).set(selectedKey, parsedValue);
        saveConfig();

        formatSuccess(`Configuration updated`);
        console.log(chalk.dim('  Key:   ') + chalk.cyan(selectedKey));
        console.log(chalk.dim('  Value: ') + chalk.yellow(String(parsedValue)));
      }),
    );

  // Reset/delete a configuration value
  command
    .command('reset')
    .argument('<key>', 'Configuration key to reset')
    .description('Reset a configuration value to its default')
    .option('-f, --force', 'Skip confirmation prompt')
    .action(
      withErrorHandling(async (key: string, options: { force?: boolean }) => {
        const currentValue = getRawValue(key);

        if (currentValue === undefined) {
          formatWarning(`Key "${key}" is not set`);
          return;
        }

        if (!options.force) {
          const confirmed = await confirm({
            message: chalk.yellow(`Reset "${key}" to default value?`),
            default: false,
          });

          if (!confirmed) {
            formatInfo('Operation cancelled.');
            return;
          }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (config as any).reset(key);
        saveConfig();

        formatSuccess(`Configuration key "${key}" reset to default`);
      }),
    );
};

export { createConfigCli };
