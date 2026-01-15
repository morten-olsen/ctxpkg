import type { Command } from 'commander';

import { config } from '../config/config.ts';
import { createDocumentsMcpServer, runMcpServer } from '../mcp/mcp.ts';

import { createCliClient } from './cli.client.ts';
import { withErrorHandling } from './cli.utils.ts';

import { CollectionsService } from '#root/collections/collections.ts';
import { Services } from '#root/utils/utils.services.ts';

const createMcpCli = (command: Command) => {
  command.description('Start MCP servers for tool integration');

  // Documents MCP server command
  command
    .command('documents')
    .alias('docs')
    .description('Start an MCP server with document tools')
    .option('-c, --collections <names...>', 'Limit searches to specific collections')
    .option('--no-default', 'Do not include default collections')
    .option('--name <name>', 'MCP server name', 'ctxpkg-documents')
    .option('--version <version>', 'MCP server version', '1.0.0')
    .action(
      withErrorHandling(
        async (options: { collections?: string[]; default: boolean; name: string; version: string }) => {
          const client = await createCliClient();

          // Build alias map from project config
          const aliasMap = new Map<string, string>();
          const services = new Services();
          try {
            const collectionsService = services.get(CollectionsService);
            const cwd = process.cwd();

            if (collectionsService.projectConfigExists(cwd)) {
              const projectConfig = collectionsService.readProjectConfig(cwd);
              for (const [alias, spec] of Object.entries(projectConfig.collections)) {
                const collectionId = collectionsService.computeCollectionId(spec);
                aliasMap.set(alias, collectionId);
              }
            }
          } finally {
            await services.destroy();
          }

          // Build collections list similar to cli.documents.ts search command
          let collectionsToUse: string[] | undefined;
          const defaultCollections = config.get('documents.defaultCollections') as string[];

          if (options.collections || options.default) {
            const collectionsSet = new Set<string>();

            if (options.default) {
              // Include cwd and default collections
              collectionsSet.add(process.cwd());
              for (const c of defaultCollections) {
                collectionsSet.add(c);
              }
            }

            if (options.collections) {
              for (const c of options.collections) {
                collectionsSet.add(c);
              }
            }

            collectionsToUse = collectionsSet.size > 0 ? [...collectionsSet] : undefined;
          }

          // Create and run MCP server
          const server = createDocumentsMcpServer({
            client,
            aliasMap,
            collections: collectionsToUse,
            name: options.name,
            version: options.version,
          });

          await runMcpServer(server);

          // Note: cleanup happens on SIGINT/SIGTERM in runMcpServer
        },
      ),
    );
};

export { createMcpCli };
