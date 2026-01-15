import { existsSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';

import type { Command } from 'commander';

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
import type { CollectionSpec, Manifest } from '#root/collections/collections.schemas.ts';
import { config } from '#root/config/config.ts';
import type { GetBackendAPIResponse } from '#root/backend/backend.types.ts';

type SyncResult = GetBackendAPIResponse<'collections', 'sync'>;

const createCollectionsCli = (command: Command) => {
  command.description('Manage collection packages for AI context');

  // collections init
  command
    .command('init')
    .description('Create a new project config file')
    .option('-f, --force', 'Overwrite existing file')
    .action(
      withErrorHandling(async (options: { force?: boolean }) => {
        const services = new Services();
        try {
          const collectionsService = services.get(CollectionsService);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const configFile = (config as any).get('project.configFile') as string;

          if (collectionsService.projectConfigExists() && !options.force) {
            formatError(`${configFile} already exists. Use --force to overwrite.`);
            return;
          }

          collectionsService.initProjectConfig(process.cwd(), options.force);
          formatSuccess(`Created ${configFile}`);
        } finally {
          await services.destroy();
        }
      }),
    );

  // collections add
  command
    .command('add')
    .argument('<name>', 'Name/alias for the collection')
    .argument('<url>', 'Manifest or bundle URL (supports https://, file://, or relative paths)')
    .description('Add a collection to project or global config')
    .option('-g, --global', 'Add to global config instead of project config')
    .action(
      withErrorHandling(async (name: string, url: string, options: { global?: boolean }) => {
        const services = new Services();
        try {
          const collectionsService = services.get(CollectionsService);

          if (!options.global && !collectionsService.projectConfigExists()) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const configFile = (config as any).get('project.configFile') as string;
            formatError(`No ${configFile} found. Run 'collections init' first, or use -g for global.`);
            return;
          }

          // Normalize local paths to file:// URLs
          let normalizedUrl = url;
          if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://')) {
            normalizedUrl = `file://${url}`;
          }

          const spec: CollectionSpec = { url: normalizedUrl };
          collectionsService.addToConfig(name, spec, { global: options.global });

          const scope = options.global ? 'global config' : 'project config';
          formatSuccess(`Added collection "${name}" to ${scope} (${normalizedUrl})`);
        } finally {
          await services.destroy();
        }
      }),
    );

  // collections remove
  command
    .command('remove')
    .argument('<name>', 'Name of the collection to remove')
    .description('Remove a collection from project or global config')
    .option('-g, --global', 'Remove from global config instead of project config')
    .option('--drop', 'Also drop indexed data from database')
    .action(
      withErrorHandling(async (name: string, options: { global?: boolean; drop?: boolean }) => {
        const services = new Services();
        const client = options.drop ? await createCliClient() : null;
        try {
          const collectionsService = services.get(CollectionsService);

          if (options.global) {
            if (!collectionsService.globalConfigExists()) {
              formatError('No global config found.');
              return;
            }
          } else {
            if (!collectionsService.projectConfigExists()) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const configFile = (config as any).get('project.configFile') as string;
              formatError(`No ${configFile} found.`);
              return;
            }
          }

          const spec = collectionsService.getFromConfig(name, { global: options.global });
          if (!spec) {
            const scope = options.global ? 'global config' : 'project config';
            formatError(`Collection "${name}" not found in ${scope}.`);
            return;
          }

          if (options.drop && client) {
            const collectionId = collectionsService.computeCollectionId(spec);
            await client.documents.dropCollection({ collection: collectionId });
            await client.collections.delete({ id: collectionId });
            formatInfo(`Dropped indexed data for "${name}"`);
          }

          collectionsService.removeFromConfig(name, { global: options.global });
          const scope = options.global ? 'global config' : 'project config';
          formatSuccess(`Removed "${name}" from ${scope}`);
        } finally {
          if (client) {
            await client.disconnect();
          }
          await services.destroy();
        }
      }),
    );

  // collections list
  command
    .command('list')
    .alias('ls')
    .description('List configured collections and their status')
    .option('-g, --global', 'Show only global collections')
    .option('--no-global', 'Show only local collections')
    .action(
      withErrorHandling(async (options: { global?: boolean }) => {
        const services = new Services();
        const client = await createCliClient();
        try {
          const collectionsService = services.get(CollectionsService);

          // Determine which collections to show
          let entries: [string, CollectionSpec, 'local' | 'global'][] = [];

          if (options.global === true) {
            // Show only global
            if (!collectionsService.globalConfigExists()) {
              formatInfo('No global collections configured. Use "collections add -g" to add one.');
              return;
            }
            const globalConfig = collectionsService.readGlobalConfig();
            entries = Object.entries(globalConfig.collections).map(([name, spec]) => [name, spec, 'global']);
          } else if (options.global === false) {
            // Show only local
            if (!collectionsService.projectConfigExists()) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const configFile = (config as any).get('project.configFile') as string;
              formatInfo(`No ${configFile} found. Run 'collections init' first.`);
              return;
            }
            const projectConfig = collectionsService.readProjectConfig();
            entries = Object.entries(projectConfig.collections).map(([name, spec]) => [name, spec, 'local']);
          } else {
            // Show both (default)
            const allCollections = collectionsService.getAllCollections();
            entries = Array.from(allCollections.entries()).map(([name, { spec, source }]) => [name, spec, source]);
          }

          if (entries.length === 0) {
            formatInfo('No collections configured. Use "collections add" to add one.');
            return;
          }

          formatHeader('Collections');

          const maxNameLen = Math.max(...entries.map(([name]) => name.length), 10);
          const urlLengths = entries.map(([, spec]) => spec.url.length);
          const maxUrlLen = Math.min(Math.max(...urlLengths, 20), 45);
          const showSource = options.global === undefined; // Show source column when showing both

          const columns = [
            { name: 'Name', width: maxNameLen },
            { name: 'URL', width: maxUrlLen },
            ...(showSource ? [{ name: 'Source', width: 8 }] : []),
            { name: 'Status', width: 14 },
          ];

          formatTableHeader(columns);

          for (const [name, spec, source] of entries) {
            const status = await client.collections.getSyncStatus({ spec });
            const statusText = status === 'synced' ? chalk.green('✓ synced') : chalk.yellow('⚠ not synced');

            let url = spec.url;
            if (url.length > maxUrlLen) {
              url = url.substring(0, maxUrlLen - 3) + '...';
            }

            const sourceColor = source === 'local' ? chalk.blue : chalk.magenta;

            const row = [
              { value: name, width: maxNameLen, color: chalk.cyan },
              { value: url, width: maxUrlLen, color: chalk.white },
              ...(showSource ? [{ value: source, width: 8, color: sourceColor }] : []),
              { value: statusText, width: 14 },
            ];

            formatTableRow(row);
          }

          console.log();
        } finally {
          await client.disconnect();
          await services.destroy();
        }
      }),
    );

  // collections sync
  command
    .command('sync')
    .argument('[name]', 'Name of specific collection to sync (omit for all)')
    .description('Sync collection(s) from config')
    .option('-g, --global', 'Sync only global collections')
    .option('--no-global', 'Sync only local collections')
    .option('-f, --force', 'Re-index all documents (ignore hash cache)')
    .option('--dry-run', 'Show what would happen without making changes')
    .action(
      withErrorHandling(
        async (name: string | undefined, options: { global?: boolean; force?: boolean; dryRun?: boolean }) => {
          const services = new Services();
          try {
            const collectionsService = services.get(CollectionsService);

            // Build list of collections to sync based on options
            let toSync: [string, CollectionSpec, 'local' | 'global'][] = [];

            if (name) {
              // Syncing a specific collection by name
              if (options.global === true) {
                // Explicitly global
                const spec = collectionsService.getFromConfig(name, { global: true });
                if (!spec) {
                  formatError(`Collection "${name}" not found in global config.`);
                  return;
                }
                toSync = [[name, spec, 'global']];
              } else if (options.global === false) {
                // Explicitly local
                const spec = collectionsService.getFromConfig(name, { global: false });
                if (!spec) {
                  formatError(`Collection "${name}" not found in project config.`);
                  return;
                }
                toSync = [[name, spec, 'local']];
              } else {
                // Search local first, then global
                const localSpec = collectionsService.getFromConfig(name, { global: false });
                if (localSpec) {
                  toSync = [[name, localSpec, 'local']];
                } else {
                  const globalSpec = collectionsService.getFromConfig(name, { global: true });
                  if (globalSpec) {
                    toSync = [[name, globalSpec, 'global']];
                  } else {
                    formatError(`Collection "${name}" not found in project or global config.`);
                    return;
                  }
                }
              }
            } else {
              // Syncing all collections
              if (options.global === true) {
                // Only global
                if (!collectionsService.globalConfigExists()) {
                  formatInfo('No global collections configured. Use "collections add -g" to add one.');
                  return;
                }
                const globalConfig = collectionsService.readGlobalConfig();
                toSync = Object.entries(globalConfig.collections).map(([n, spec]) => [n, spec, 'global']);
              } else if (options.global === false) {
                // Only local
                if (!collectionsService.projectConfigExists()) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const configFile = (config as any).get('project.configFile') as string;
                  formatError(`No ${configFile} found. Run 'collections init' first.`);
                  return;
                }
                const projectConfig = collectionsService.readProjectConfig();
                toSync = Object.entries(projectConfig.collections).map(([n, spec]) => [n, spec, 'local']);
              } else {
                // Both local and global (default)
                const allCollections = collectionsService.getAllCollections();
                toSync = Array.from(allCollections.entries()).map(([n, { spec, source }]) => [n, spec, source]);
              }
            }

            if (toSync.length === 0) {
              formatInfo('No collections configured. Use "collections add" to add one.');
              return;
            }

            // Handle dry-run mode separately
            if (options.dryRun) {
              formatWarning('Dry run mode - no changes will be made');
              console.log();

              for (const [collectionName, , source] of toSync) {
                console.log(chalk.bold(`Syncing ${collectionName}`) + chalk.dim(` (${source})...`));
                formatInfo('  Would sync this collection');
                console.log();
              }

              console.log(chalk.green.bold('All collections synced.'));
              return;
            }

            // Actually sync collections
            const client = await createCliClient();
            try {
              for (const [collectionName, spec, source] of toSync) {
                console.log(chalk.bold(`Syncing ${collectionName}`) + chalk.dim(` (${source})...`));

                const result = await client.collections.sync({
                  name: collectionName,
                  spec,
                  cwd: process.cwd(),
                  force: options.force,
                });

                printSyncResult(collectionName, result);
              }
            } finally {
              await client.disconnect();
            }

            console.log(chalk.green.bold('All collections synced.'));
          } finally {
            await services.destroy();
          }
        },
      ),
    );

  // collections manifest (subcommand group)
  const manifestCmd = command.command('manifest').description('Manifest management commands');

  // collections manifest init
  manifestCmd
    .command('init')
    .description('Create a manifest.json for publishing')
    .option('-n, --name <name>', 'Package name')
    .option('-v, --version <version>', 'Package version', '1.0.0')
    .action(
      withErrorHandling(async (options: { name?: string; version?: string }) => {
        const manifestPath = resolve(process.cwd(), 'manifest.json');

        if (existsSync(manifestPath)) {
          formatError('manifest.json already exists');
          return;
        }

        const manifest: Manifest = {
          name: options.name || basename(process.cwd()),
          version: options.version || '1.0.0',
          description: '',
          sources: {
            glob: ['**/*.md'],
          },
        };

        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        formatSuccess('Created manifest.json');
      }),
    );

  // collections pack
  command
    .command('pack')
    .description('Create a distributable bundle from a manifest')
    .option('-m, --manifest <path>', 'Path to manifest file', 'manifest.json')
    .option('-o, --output <path>', 'Output path for bundle')
    .action(
      withErrorHandling(async (options: { manifest: string; output?: string }) => {
        const { createHash } = await import('node:crypto');
        const { readFile, glob } = await import('node:fs/promises');
        const tar = await import('tar');

        const manifestPath = resolve(process.cwd(), options.manifest);

        if (!existsSync(manifestPath)) {
          formatError(`Manifest not found: ${manifestPath}`);
          return;
        }

        const manifestContent = await readFile(manifestPath, 'utf8');
        const manifest = JSON.parse(manifestContent) as Manifest;

        formatHeader('Creating Bundle');
        formatInfo(`Name: ${chalk.cyan(manifest.name)}`);
        formatInfo(`Version: ${chalk.cyan(manifest.version)}`);
        console.log();

        const manifestDir = manifestPath.substring(0, manifestPath.lastIndexOf('/'));

        // Collect files to include
        const filesToInclude: string[] = ['manifest.json'];

        if ('glob' in manifest.sources) {
          for (const pattern of manifest.sources.glob) {
            for await (const file of glob(pattern, { cwd: manifestDir || process.cwd() })) {
              filesToInclude.push(file);
            }
          }
        } else if ('files' in manifest.sources) {
          for (const entry of manifest.sources.files) {
            const path = typeof entry === 'string' ? entry : entry.path;
            if (path) {
              filesToInclude.push(path);
            }
          }
        }

        formatInfo(`Including ${filesToInclude.length} files`);

        // Create bundle
        const outputPath = options.output || `${manifest.name}-${manifest.version}.tar.gz`;
        const fullOutputPath = resolve(process.cwd(), outputPath);

        await tar.create(
          {
            gzip: true,
            file: fullOutputPath,
            cwd: manifestDir || process.cwd(),
          },
          filesToInclude,
        );

        // Calculate hash
        const bundleContent = await readFile(fullOutputPath);
        const hash = createHash('sha256').update(bundleContent).digest('hex');

        console.log();
        formatSuccess(`Created ${outputPath}`);
        formatInfo(`SHA256: ${chalk.dim(hash)}`);
      }),
    );
};

const printSyncResult = (name: string, result: SyncResult) => {
  const parts = [];
  if (result.added > 0) parts.push(chalk.green(`${result.added} added`));
  if (result.updated > 0) parts.push(chalk.yellow(`${result.updated} updated`));
  if (result.removed > 0) parts.push(chalk.red(`${result.removed} removed`));

  if (parts.length === 0) {
    console.log(chalk.green(`  ✓ ${result.total} documents (no changes)`));
  } else {
    console.log(chalk.green(`  ✓ ${result.total} documents (${parts.join(', ')})`));
  }
  console.log();
};

export { createCollectionsCli };
