import chalk from 'chalk';

/**
 * Format a header with decorative borders
 */
const formatHeader = (text: string) => {
  console.log();
  console.log(chalk.bold.cyan(`━━━ ${text} ━━━`));
  console.log();
};

/**
 * Format a success message with checkmark
 */
const formatSuccess = (text: string) => {
  console.log(chalk.green('✔'), text);
};

/**
 * Format an error message with X mark
 */
const formatError = (text: string) => {
  console.log(chalk.red('✖'), text);
};

/**
 * Format an info message with info icon
 */
const formatInfo = (text: string) => {
  console.log(chalk.blue('ℹ'), text);
};

/**
 * Format a warning message
 */
const formatWarning = (text: string) => {
  console.log(chalk.yellow('⚠'), text);
};

/**
 * Format a key-value pair
 */
const formatKeyValue = (key: string, value: unknown, keyWidth?: number) => {
  const keyStr = keyWidth ? key.padEnd(keyWidth) : key;
  console.log(chalk.dim('  ') + chalk.white(keyStr) + chalk.dim(' │ ') + chalk.cyan(String(value)));
};

/**
 * Format a table header
 */
const formatTableHeader = (columns: { name: string; width: number }[]) => {
  const header = columns.map((col) => chalk.bold(col.name.padEnd(col.width))).join(chalk.dim(' │ '));
  const separator = columns.map((col) => '─'.repeat(col.width)).join(chalk.dim('─┼─'));

  console.log(chalk.dim('  ') + header);
  console.log(chalk.dim('  ') + separator);
};

/**
 * Format a table row
 */
const formatTableRow = (values: { value: string; width: number; color?: typeof chalk }[]) => {
  const row = values
    .map((val) => {
      const color = val.color || chalk.white;
      return color(val.value.padEnd(val.width));
    })
    .join(chalk.dim(' │ '));

  console.log(chalk.dim('  ') + row);
};

/**
 * Wrap an async action with error handling
 */
const withErrorHandling = <T extends unknown[]>(
  action: (...args: T) => Promise<void>,
): ((...args: T) => Promise<void>) => {
  return async (...args: T) => {
    try {
      await action(...args);
    } catch (error) {
      formatError(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  };
};

/**
 * Flatten an object into dot-notation keys
 */
const flattenObject = (obj: Record<string, unknown>, prefix = ''): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, newKey));
    } else {
      result[newKey] = value;
    }
  }

  return result;
};

export {
  formatHeader,
  formatSuccess,
  formatError,
  formatInfo,
  formatWarning,
  formatKeyValue,
  formatTableHeader,
  formatTableRow,
  withErrorHandling,
  flattenObject,
};

export { chalk };
