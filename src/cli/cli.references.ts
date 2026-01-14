import type { Command } from 'commander';
import { select, confirm, input } from '@inquirer/prompts';

import {
  formatHeader,
  formatSuccess,
  formatError,
  formatInfo,
  formatTableHeader,
  formatTableRow,
  withErrorHandling,
  chalk,
} from './cli.utils.ts';

import { ReferencesService } from '#root/references/references.ts';
import { Services } from '#root/utils/utils.services.ts';

const createReferenceCli = (command: Command) => {
  command.description('Manage reference document collections');

  // List collections command
  command
    .command('list-collections')
    .alias('ls')
    .description('List all reference collections')
    .action(
      withErrorHandling(async () => {
        const services = new Services();
        try {
          const referenceService = services.get(ReferencesService);
          const list = await referenceService.listCollections();

          if (list.length === 0) {
            formatInfo('No collections found.');
            return;
          }

          formatHeader('Reference Collections');

          const maxCollectionLen = Math.max(...list.map((c) => c.collection.length), 10);

          formatTableHeader([
            { name: 'Collection', width: maxCollectionLen },
            { name: 'Documents', width: 10 },
          ]);

          for (const item of list) {
            formatTableRow([
              { value: item.collection, width: maxCollectionLen, color: chalk.white },
              { value: String(item.document_count), width: 10, color: chalk.yellow },
            ]);
          }

          console.log();
        } finally {
          await services.destroy();
        }
      }),
    );

  // Drop collection command
  command
    .command('drop-collection')
    .alias('drop')
    .argument('[name]', 'Name of collection to drop')
    .description('Drop a reference collection')
    .option('-f, --force', 'Skip confirmation prompt')
    .action(
      withErrorHandling(async (name: string | undefined, options: { force?: boolean }) => {
        const services = new Services();
        try {
          const referenceService = services.get(ReferencesService);
          const collections = await referenceService.listCollections();

          if (collections.length === 0) {
            formatInfo('No collections found.');
            return;
          }

          let collectionName: string;

          // If no name provided, prompt user to select
          if (!name) {
            collectionName = await select({
              message: 'Select a collection to drop:',
              choices: collections.map((c) => ({
                name: `${c.collection} (${c.document_count} documents)`,
                value: c.collection,
              })),
            });
          } else {
            // Verify collection exists
            const exists = collections.find((c) => c.collection === name);
            if (!exists) {
              formatError(`Collection "${name}" not found.`);
              console.log();
              formatInfo('Available collections:');
              for (const c of collections) {
                console.log(chalk.dim('  •'), c.collection);
              }
              return;
            }
            collectionName = name;
          }

          // Confirm deletion unless --force is used
          if (!options.force) {
            const confirmed = await confirm({
              message: chalk.yellow(`Are you sure you want to drop "${collectionName}"? This cannot be undone.`),
              default: false,
            });

            if (!confirmed) {
              formatInfo('Operation cancelled.');
              return;
            }
          }

          await referenceService.dropCollection(collectionName);
          formatSuccess(`Collection "${collectionName}" dropped successfully.`);
        } finally {
          await services.destroy();
        }
      }),
    );

  // Update collection from glob command
  command
    .command('update-collection')
    .alias('update')
    .description('Update a collection from files matching a glob pattern')
    .requiredOption('-p, --pattern <pattern>', 'Glob pattern to match files (e.g., "**/*.md")')
    .option('-c, --collection <name>', 'Collection name (defaults to cwd)')
    .option('-d, --cwd <directory>', 'Working directory for glob pattern', process.cwd())
    .action(
      withErrorHandling(async (options: { pattern: string; collection?: string; cwd: string }) => {
        const services = new Services();
        try {
          const referenceService = services.get(ReferencesService);
          const collectionName = options.collection || options.cwd;

          formatHeader('Updating Collection');
          formatInfo(`Pattern: ${chalk.cyan(options.pattern)}`);
          formatInfo(`Directory: ${chalk.cyan(options.cwd)}`);
          formatInfo(`Collection: ${chalk.cyan(collectionName)}`);
          console.log();

          console.log(chalk.dim('Processing files...'));

          await referenceService.updateCollectionFromGlob({
            pattern: options.pattern,
            cwd: options.cwd,
            collection: collectionName,
          });

          formatSuccess('Collection updated successfully.');
        } finally {
          await services.destroy();
        }
      }),
    );

  // Search command
  command
    .command('search')
    .description('Search for documents in reference collections')
    .argument('<query>', 'Search query')
    .option('-c, --collections <names...>', 'Limit search to specific collections')
    .option('-l, --limit <number>', 'Maximum number of results', '10')
    .action(
      withErrorHandling(async (query: string, options: { collections?: string[]; limit: string }) => {
        const services = new Services();
        try {
          const referenceService = services.get(ReferencesService);

          formatHeader('Search Results');
          formatInfo(`Query: ${chalk.cyan(query)}`);
          if (options.collections) {
            formatInfo(`Collections: ${chalk.cyan(options.collections.join(', '))}`);
          }
          console.log();

          const results = await referenceService.search({
            query,
            collections: options.collections,
            limit: parseInt(options.limit, 10),
          });

          if (results.length === 0) {
            formatInfo('No results found.');
            return;
          }

          for (let i = 0; i < results.length; i++) {
            const result = results[i];
            const distanceColor = result.distance < 0.5 ? chalk.green : result.distance < 1 ? chalk.yellow : chalk.red;

            console.log(
              chalk.bold.white(`${i + 1}.`) +
                ' ' +
                chalk.cyan(result.document) +
                chalk.dim(' in ') +
                chalk.magenta(result.collection),
            );
            console.log(chalk.dim('   Distance: ') + distanceColor(result.distance.toFixed(4)));
            console.log();

            // Format content with indentation and truncation
            const contentLines = result.content.split('\n').slice(0, 6);
            for (const line of contentLines) {
              const truncated = line.length > 100 ? line.slice(0, 97) + '...' : line;
              console.log(chalk.dim('   │ ') + chalk.white(truncated));
            }
            if (result.content.split('\n').length > 6) {
              console.log(chalk.dim('   │ ...'));
            }
            console.log();
          }
        } finally {
          await services.destroy();
        }
      }),
    );

  // Interactive search command
  command
    .command('interactive-search')
    .alias('isearch')
    .description('Interactive search mode')
    .action(
      withErrorHandling(async () => {
        const services = new Services();
        try {
          const referenceService = services.get(ReferencesService);
          const collections = await referenceService.listCollections();

          if (collections.length === 0) {
            formatInfo('No collections found. Add some documents first.');
            return;
          }

          formatHeader('Interactive Search');

          // Select collections to search
          const selectedCollections = await select({
            message: 'Search in:',
            choices: [
              { name: 'All collections', value: undefined },
              ...collections.map((c) => ({
                name: `${c.collection} (${c.document_count} docs)`,
                value: c.collection,
              })),
            ],
          });

          const query = await input({
            message: 'Enter search query:',
          });

          if (!query.trim()) {
            formatInfo('Empty query. Exiting.');
            return;
          }

          const limitStr = await input({
            message: 'Number of results:',
            default: '10',
          });

          const results = await referenceService.search({
            query,
            collections: selectedCollections ? [selectedCollections] : undefined,
            limit: parseInt(limitStr, 10) || 10,
          });

          console.log();

          if (results.length === 0) {
            formatInfo('No results found.');
            return;
          }

          formatHeader(`Found ${results.length} results`);

          for (let i = 0; i < results.length; i++) {
            const result = results[i];
            const distanceColor = result.distance < 0.5 ? chalk.green : result.distance < 1 ? chalk.yellow : chalk.red;

            console.log(
              chalk.bold.white(`${i + 1}.`) +
                ' ' +
                chalk.cyan(result.document) +
                chalk.dim(' in ') +
                chalk.magenta(result.collection),
            );
            console.log(chalk.dim('   Distance: ') + distanceColor(result.distance.toFixed(4)));
            console.log();

            const contentLines = result.content.split('\n').slice(0, 6);
            for (const line of contentLines) {
              const truncated = line.length > 100 ? line.slice(0, 97) + '...' : line;
              console.log(chalk.dim('   │ ') + chalk.white(truncated));
            }
            if (result.content.split('\n').length > 6) {
              console.log(chalk.dim('   │ ...'));
            }
            console.log();
          }
        } finally {
          await services.destroy();
        }
      }),
    );
};

export { createReferenceCli };
