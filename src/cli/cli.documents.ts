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
import { createCliClient } from './cli.client.ts';

import { Services } from '#root/utils/utils.services.ts';
import { CollectionsService } from '#root/collections/collections.ts';

const createDocumentsCli = (command: Command) => {
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
          const list = await client.documents.listCollections();

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
          const collections = await client.documents.listCollections();

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

          await client.documents.dropCollection({ collection: collectionName });
          formatSuccess(`Collection "${collectionName}" dropped successfully.`);
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
    .option('-c, --collections <names...>', 'Limit search to specific collections (can be aliases)')
    .option('--no-global', 'Exclude global collections from search')
    .option('-l, --limit <number>', 'Maximum number of results', '10')
    .option('--max-distance <number>', 'Maximum distance threshold (0-2, lower = stricter)')
    .option('--no-hybrid', 'Disable hybrid search (use pure vector search)')
    .option('--rerank', 'Enable re-ranking for higher precision (slower)')
    .action(
      withErrorHandling(
        async (
          query: string,
          options: {
            collections?: string[];
            global: boolean;
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
            const resolveCollection = (name: string, includeGlobal: boolean): string => {
              // Try to resolve as alias (local first, then global if allowed)
              if (includeGlobal) {
                const spec = collectionsService.getFromConfig(name);
                if (spec) {
                  return collectionsService.computeCollectionId(spec);
                }
              } else {
                const spec = collectionsService.getFromConfig(name, { global: false });
                if (spec) {
                  return collectionsService.computeCollectionId(spec);
                }
              }
              // Return as-is (might be a raw collection ID or path)
              return name;
            };

            let collectionsToSearch: string[] = [];
            const includeGlobal = options.global !== false;

            if (options.collections && options.collections.length > 0) {
              // Explicit collections provided - resolve aliases
              const collectionsSet = new Set<string>();
              for (const c of options.collections) {
                collectionsSet.add(resolveCollection(c, includeGlobal));
              }
              collectionsToSearch = Array.from(collectionsSet);
            } else {
              // No explicit collections - default to all from local + global configs
              const allCollections = includeGlobal
                ? collectionsService.getAllCollections()
                : new Map(
                    Object.entries(collectionsService.readProjectConfig().collections).map(([name, spec]) => [
                      name,
                      { spec, source: 'local' as const },
                    ]),
                  );

              if (allCollections.size === 0) {
                formatError('No collections configured. Use "collections add" to add one.');
                return;
              }

              collectionsToSearch = Array.from(allCollections.values()).map(({ spec }) =>
                collectionsService.computeCollectionId(spec),
              );
            }

            formatHeader('Search Results');
            formatInfo(`Query: ${chalk.cyan(query)}`);
            if (collectionsToSearch.length > 0) {
              const displayCollections =
                collectionsToSearch.length > 3
                  ? `${collectionsToSearch.slice(0, 3).join(', ')} (+${collectionsToSearch.length - 3} more)`
                  : collectionsToSearch.join(', ');
              formatInfo(`Collections: ${chalk.cyan(displayCollections)}`);
            }
            if (!includeGlobal) {
              formatInfo(`Scope: ${chalk.cyan('local only')}`);
            }
            if (!options.hybrid) {
              formatInfo(`Mode: ${chalk.cyan('vector-only (hybrid disabled)')}`);
            }
            if (options.rerank) {
              formatInfo(`Re-ranking: ${chalk.cyan('enabled')}`);
            }
            console.log();

            const results = await client.documents.search({
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
          const collections = await client.documents.listCollections();

          if (collections.length === 0) {
            formatInfo('No collections found. Add some documents first.');
            return;
          }

          // Build a map of collection ID → {alias, source} from both configs
          const idToInfo = new Map<string, { alias: string; source: 'local' | 'global' }>();
          const allCollections = collectionsService.getAllCollections();
          for (const [alias, { spec, source }] of allCollections) {
            const id = collectionsService.computeCollectionId(spec);
            idToInfo.set(id, { alias, source });
          }

          formatHeader('Interactive Search');

          // Sort collections: local first, then global, then unaliased
          const sortedCollections = [...collections].sort((a, b) => {
            const aInfo = idToInfo.get(a.collection);
            const bInfo = idToInfo.get(b.collection);

            // Collections with aliases come before those without
            if (aInfo && !bInfo) return -1;
            if (!aInfo && bInfo) return 1;

            // Both have aliases - sort by source (local first) then alias name
            if (aInfo && bInfo) {
              if (aInfo.source !== bInfo.source) {
                return aInfo.source === 'local' ? -1 : 1;
              }
              return aInfo.alias.localeCompare(bInfo.alias);
            }

            // Neither has alias - keep original order
            return 0;
          });

          // Select collections to search - show alias and source indicator
          const selectedCollections = await select({
            message: 'Search in:',
            choices: [
              { name: 'All collections', value: undefined },
              ...sortedCollections.map((c) => {
                const info = idToInfo.get(c.collection);
                let displayName: string;
                if (info) {
                  const sourceIndicator = info.source === 'local' ? 'local' : 'global';
                  displayName = `${info.alias} (${sourceIndicator}, ${c.document_count} docs)`;
                } else {
                  displayName = `${c.collection} (${c.document_count} docs)`;
                }
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

          const results = await client.documents.search({
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

export { createDocumentsCli };
