import type { Command } from 'commander';
import { select, confirm, input } from '@inquirer/prompts';

import { config } from '../config/config.ts';

import {
  formatHeader,
  formatSuccess,
  formatError,
  formatInfo,
  formatWarning,
  formatTableHeader,
  formatTableRow,
  withErrorHandling,
  chalk,
} from './cli.utils.ts';
import { createCliClient } from './cli.client.ts';

import { Services } from '#root/utils/utils.services.ts';
import { CollectionsService } from '#root/collections/collections.ts';

const createReferenceCli = (command: Command) => {
  command.description('Manage reference document collections');

  // List collections command
  command
    .command('list-collections')
    .alias('ls')
    .description('List all reference collections')
    .action(
      withErrorHandling(async () => {
        const client = await createCliClient();
        try {
          const list = await client.references.listCollections();

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
          await client.disconnect();
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
        const client = await createCliClient();
        try {
          const collections = await client.references.listCollections();

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

          await client.references.dropCollection({ collection: collectionName });
          formatSuccess(`Collection "${collectionName}" dropped successfully.`);
        } finally {
          await client.disconnect();
        }
      }),
    );

  // Update collection from glob command (DEPRECATED)
  command
    .command('update-collection')
    .alias('update')
    .description('[DEPRECATED] Update a collection from files - use "collections add" + "collections sync" instead')
    .option('-p, --pattern <pattern>', 'Glob pattern to match files (e.g., "**/*.md")', '**/*.md')
    .option('-c, --collection <name>', 'Collection name (defaults to cwd)')
    .option('-d, --cwd <directory>', 'Working directory for glob pattern', process.cwd())
    .action(
      withErrorHandling(async (options: { pattern: string; collection?: string; cwd: string }) => {
        formatWarning('This command is deprecated. Use "collections add" + "collections sync" instead.');
        console.log();

        const client = await createCliClient();
        try {
          const collectionName = options.collection || options.cwd;

          formatHeader('Updating Collection');
          formatInfo(`Pattern: ${chalk.cyan(options.pattern)}`);
          formatInfo(`Directory: ${chalk.cyan(options.cwd)}`);
          formatInfo(`Collection: ${chalk.cyan(collectionName)}`);
          console.log();

          console.log(chalk.dim('Processing files...'));

          await client.references.updateCollection({
            pattern: options.pattern,
            cwd: options.cwd,
            collection: collectionName,
          });

          formatSuccess('Collection updated successfully.');
        } finally {
          await client.disconnect();
        }
      }),
    );

  // Search command
  command
    .command('search')
    .description('Search for documents in reference collections using hybrid semantic + keyword search')
    .argument('<query>', 'Search query')
    .option('-c, --collections <names...>', 'Limit search to specific collections (can be aliases from context.json)')
    .option('-l, --limit <number>', 'Maximum number of results', '10')
    .option('--no-default', 'Do not include default collections in search')
    .option('--max-distance <number>', 'Maximum distance threshold (0-2, lower = stricter)')
    .option('--no-hybrid', 'Disable hybrid search (use pure vector search)')
    .option('--rerank', 'Enable re-ranking for higher precision (slower)')
    .action(
      withErrorHandling(
        async (
          query: string,
          options: {
            collections?: string[];
            limit: string;
            default: boolean;
            maxDistance?: string;
            hybrid: boolean;
            rerank?: boolean;
          },
        ) => {
          const services = new Services();
          const client = await createCliClient();
          try {
            const collectionsService = services.get(CollectionsService);

            // Helper to resolve alias to collection ID
            const resolveCollection = (name: string): string => {
              // Try to resolve as alias from project config
              const spec = collectionsService.getFromProjectConfig(name);
              if (spec) {
                return collectionsService.computeCollectionId(spec);
              }
              // Return as-is (might be a raw collection ID or path)
              return name;
            };

            // Merge specified collections with default collections and cwd (unless --no-default is set)
            const defaultCollections = config.get('references.defaultCollections') as string[];
            let collectionsToSearch: string[] | undefined;

            if (options.collections || options.default) {
              const collectionsSet = new Set<string>();
              if (options.default) {
                // Always include cwd as a default collection
                collectionsSet.add(process.cwd());
                for (const c of defaultCollections) {
                  collectionsSet.add(resolveCollection(c));
                }
              }
              if (options.collections) {
                for (const c of options.collections) {
                  collectionsSet.add(resolveCollection(c));
                }
              }
              collectionsToSearch = collectionsSet.size > 0 ? [...collectionsSet] : undefined;
            }

            formatHeader('Search Results');
            formatInfo(`Query: ${chalk.cyan(query)}`);
            if (collectionsToSearch) {
              formatInfo(`Collections: ${chalk.cyan(collectionsToSearch.join(', '))}`);
            }
            if (!options.hybrid) {
              formatInfo(`Mode: ${chalk.cyan('vector-only (hybrid disabled)')}`);
            }
            if (options.rerank) {
              formatInfo(`Re-ranking: ${chalk.cyan('enabled')}`);
            }
            console.log();

            const results = await client.references.search({
              query,
              collections: collectionsToSearch,
              limit: parseInt(options.limit, 10),
              maxDistance: options.maxDistance ? parseFloat(options.maxDistance) : undefined,
              hybridSearch: options.hybrid,
              rerank: options.rerank,
            });

            if (results.length === 0) {
              formatInfo('No results found.');
              return;
            }

            for (let i = 0; i < results.length; i++) {
              const result = results[i];
              const distanceColor =
                result.distance < 0.5 ? chalk.green : result.distance < 1 ? chalk.yellow : chalk.red;

              console.log(
                chalk.bold.white(`${i + 1}.`) +
                  ' ' +
                  chalk.cyan(result.document) +
                  chalk.dim(' in ') +
                  chalk.magenta(result.collection),
              );
              const scoreInfo =
                result.score !== undefined
                  ? chalk.dim('   Score: ') + chalk.green(result.score.toFixed(4)) + chalk.dim(' | ')
                  : chalk.dim('   ');
              console.log(scoreInfo + chalk.dim('Distance: ') + distanceColor(result.distance.toFixed(4)));
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
            await client.disconnect();
            await services.destroy();
          }
        },
      ),
    );

  // Interactive search command
  command
    .command('interactive-search')
    .alias('isearch')
    .description('Interactive search mode')
    .action(
      withErrorHandling(async () => {
        const services = new Services();
        const client = await createCliClient();
        try {
          const collectionsService = services.get(CollectionsService);
          const collections = await client.references.listCollections();

          if (collections.length === 0) {
            formatInfo('No collections found. Add some documents first.');
            return;
          }

          // Build a map of collection ID → alias from project config
          const idToAlias = new Map<string, string>();
          if (collectionsService.projectConfigExists()) {
            const projectConfig = collectionsService.readProjectConfig();
            for (const [alias, spec] of Object.entries(projectConfig.collections)) {
              const id = collectionsService.computeCollectionId(spec);
              idToAlias.set(id, alias);
            }
          }

          formatHeader('Interactive Search');

          // Sort collections: aliased (from project config) first, then others
          const sortedCollections = [...collections].sort((a, b) => {
            const aHasAlias = idToAlias.has(a.collection);
            const bHasAlias = idToAlias.has(b.collection);
            if (aHasAlias && !bHasAlias) return -1;
            if (!aHasAlias && bHasAlias) return 1;
            // If both have aliases, sort by alias name
            if (aHasAlias && bHasAlias) {
              return (idToAlias.get(a.collection) || '').localeCompare(idToAlias.get(b.collection) || '');
            }
            // Otherwise keep original order
            return 0;
          });

          // Select collections to search - show alias if available
          const selectedCollections = await select({
            message: 'Search in:',
            choices: [
              { name: 'All collections', value: undefined },
              ...sortedCollections.map((c) => {
                const alias = idToAlias.get(c.collection);
                const displayName = alias
                  ? `${alias} (${c.document_count} docs)`
                  : `${c.collection} (${c.document_count} docs)`;
                return {
                  name: displayName,
                  value: c.collection,
                };
              }),
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

          const results = await client.references.search({
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
            const scoreInfo =
              result.score !== undefined
                ? chalk.dim('   Score: ') + chalk.green(result.score.toFixed(4)) + chalk.dim(' | ')
                : chalk.dim('   ');
            console.log(scoreInfo + chalk.dim('Distance: ') + distanceColor(result.distance.toFixed(4)));
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
          await client.disconnect();
          await services.destroy();
        }
      }),
    );
};

export { createReferenceCli };
