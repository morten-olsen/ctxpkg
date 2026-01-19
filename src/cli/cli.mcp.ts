import type { Command } from 'commander';

import { getLLMConfigFromAppConfig } from '../agent/agent.js';
import { createAgentMcpServer, createDocumentsMcpServer, runMcpServer } from '../mcp/mcp.js';
import { CollectionsService } from '../collections/collections.js';
import { Services } from '../utils/utils.services.js';

import { createCliClient } from './cli.client.js';
import { formatError, withErrorHandling } from './cli.utils.js';

const createMcpCli = (command: Command) => {
  command.description('Start MCP servers for tool integration');

  // Documents MCP server command
  command
    .command('documents')
    .alias('docs')
    .description('Start an MCP server with document tools')
    .option('-c, --collections <names...>', 'Limit searches to specific collections')
    .option('--no-global', 'Exclude global collections from searches')
    .option('--name <name>', 'MCP server name', 'ctxpkg-documents')
    .option('--version <version>', 'MCP server version', '1.0.0')
    .action(
      withErrorHandling(async (options: { collections?: string[]; global: boolean; name: string; version: string }) => {
        const client = await createCliClient();

        // Build alias map from both local and global configs (respecting --no-global)
        const aliasMap = new Map<string, string>();
        const services = new Services();
        let defaultCollections: string[] | undefined;

        try {
          const collectionsService = services.get(CollectionsService);
          const includeGlobal = options.global !== false;

          if (includeGlobal) {
            // Include both local and global collections
            const allCollections = collectionsService.getAllCollections();
            for (const [alias, { spec }] of allCollections) {
              const collectionId = collectionsService.computeCollectionId(spec);
              aliasMap.set(alias, collectionId);
            }

            // Default to all configured collections when no -c option
            if (!options.collections) {
              defaultCollections = Array.from(allCollections.values()).map(({ spec }) =>
                collectionsService.computeCollectionId(spec),
              );
            }
          } else {
            // Local only
            if (collectionsService.projectConfigExists()) {
              const projectConfig = collectionsService.readProjectConfig();
              for (const [alias, spec] of Object.entries(projectConfig.collections)) {
                const collectionId = collectionsService.computeCollectionId(spec);
                aliasMap.set(alias, collectionId);
              }

              // Default to local collections only when no -c option
              if (!options.collections) {
                defaultCollections = Object.values(projectConfig.collections).map((spec) =>
                  collectionsService.computeCollectionId(spec),
                );
              }
            }
          }
        } finally {
          await services.destroy();
        }

        // Build collections list - use explicit collections or defaults
        let collectionsToUse: string[] | undefined;

        if (options.collections) {
          const collectionsSet = new Set<string>();
          for (const c of options.collections) {
            // Resolve alias if available
            const resolved = aliasMap.get(c) || c;
            collectionsSet.add(resolved);
          }
          collectionsToUse = [...collectionsSet];
        } else {
          collectionsToUse = defaultCollections;
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
      }),
    );

  // Agent mode MCP server command
  command
    .command('agent')
    .description('Start an MCP server with agent mode (single ask_documents tool)')
    .option('-c, --collections <names...>', 'Limit searches to specific collections')
    .option('--no-global', 'Exclude global collections from searches')
    .option('--name <name>', 'MCP server name', 'ctxpkg-agent')
    .option('--version <version>', 'MCP server version', '1.0.0')
    .option('--model <model>', 'Override LLM model from config')
    .action(
      withErrorHandling(
        async (options: { collections?: string[]; global: boolean; name: string; version: string; model?: string }) => {
          // Get LLM config and validate
          const llmConfig = await getLLMConfigFromAppConfig();

          if (!llmConfig.apiKey) {
            formatError('LLM API key not configured. Set it with: ctxpkg config set llm.apiKey <key>');
            formatError('Or use environment variable: CTXPKG_LLM_API_KEY=<key>');
            process.exitCode = 1;
            return;
          }

          // Override model if specified
          if (options.model) {
            llmConfig.model = options.model;
          }

          const client = await createCliClient();

          // Build alias map from both local and global configs (respecting --no-global)
          const aliasMap = new Map<string, string>();
          const services = new Services();

          try {
            const collectionsService = services.get(CollectionsService);
            const includeGlobal = options.global !== false;

            if (includeGlobal) {
              // Include both local and global collections
              const allCollections = collectionsService.getAllCollections();
              for (const [alias, { spec }] of allCollections) {
                const collectionId = collectionsService.computeCollectionId(spec);
                aliasMap.set(alias, collectionId);
              }
            } else {
              // Local only
              if (collectionsService.projectConfigExists()) {
                const projectConfig = collectionsService.readProjectConfig();
                for (const [alias, spec] of Object.entries(projectConfig.collections)) {
                  const collectionId = collectionsService.computeCollectionId(spec);
                  aliasMap.set(alias, collectionId);
                }
              }
            }
          } finally {
            await services.destroy();
          }

          // Create and run MCP server with agent mode
          const server = createAgentMcpServer({
            client,
            llmConfig,
            aliasMap,
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
