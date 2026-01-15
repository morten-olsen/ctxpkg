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
    .description('Add a collection to the project config')
    .action(
      withErrorHandling(async (name: string, url: string) => {
        const services = new Services();
        try {
          const collectionsService = services.get(CollectionsService);

          if (!collectionsService.projectConfigExists()) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const configFile = (config as any).get('project.configFile') as string;
            formatError(`No ${configFile} found. Run 'collections init' first.`);
            return;
          }

          // Normalize local paths to file:// URLs
          let normalizedUrl = url;
          if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://')) {
            normalizedUrl = `file://${url}`;
          }

          const spec: CollectionSpec = { url: normalizedUrl };
          collectionsService.addToProjectConfig(name, spec);
          formatSuccess(`Added collection "${name}" (${normalizedUrl})`);
        } finally {
          await services.destroy();
        }
      }),
    );

  // collections remove
  command
    .command('remove')
    .argument('<name>', 'Name of the collection to remove')
    .description('Remove a collection from project config')
    .option('--drop', 'Also drop indexed data from database')
    .action(
      withErrorHandling(async (name: string, options: { drop?: boolean }) => {
        const services = new Services();
        const client = options.drop ? await createCliClient() : null;
        try {
          const collectionsService = services.get(CollectionsService);

          if (!collectionsService.projectConfigExists()) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const configFile = (config as any).get('project.configFile') as string;
            formatError(`No ${configFile} found.`);
            return;
          }

          const spec = collectionsService.getFromProjectConfig(name);
          if (!spec) {
            formatError(`Collection "${name}" not found in project config.`);
            return;
          }

          if (options.drop && client) {
            const collectionId = collectionsService.computeCollectionId(spec);
            await client.documents.dropCollection({ collection: collectionId });
            await client.collections.delete({ id: collectionId });
            formatInfo(`Dropped indexed data for "${name}"`);
          }

          collectionsService.removeFromProjectConfig(name);
          formatSuccess(`Removed "${name}" from project config`);
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
    .action(
      withErrorHandling(async () => {
        const services = new Services();
        const client = await createCliClient();
        try {
          const collectionsService = services.get(CollectionsService);

          if (!collectionsService.projectConfigExists()) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const configFile = (config as any).get('project.configFile') as string;
            formatInfo(`No ${configFile} found. Run 'collections init' first.`);
            return;
          }

          const projectConfig = collectionsService.readProjectConfig();
          const entries = Object.entries(projectConfig.collections);

          if (entries.length === 0) {
            formatInfo('No collections configured. Use "collections add" to add one.');
            return;
          }

          formatHeader('Collections');

          const maxNameLen = Math.max(...entries.map(([name]) => name.length), 10);
          const sourceLengths = entries.map(([, spec]) => spec.url.length);
          const maxSourceLen = Math.min(Math.max(...sourceLengths, 20), 50);

          formatTableHeader([
            { name: 'Name', width: maxNameLen },
            { name: 'URL', width: maxSourceLen },
            { name: 'Status', width: 14 },
          ]);

          for (const [name, spec] of entries) {
            const status = await client.collections.getSyncStatus({ spec });
            const statusText = status === 'synced' ? chalk.green('✓ synced') : chalk.yellow('⚠ not synced');

            let source = spec.url;

            // Truncate source if too long
            if (source.length > maxSourceLen) {
              source = source.substring(0, maxSourceLen - 3) + '...';
            }

            formatTableRow([
              { value: name, width: maxNameLen, color: chalk.cyan },
              { value: source, width: maxSourceLen, color: chalk.white },
              { value: statusText, width: 14 },
            ]);
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
    .option('-f, --force', 'Re-index all documents (ignore hash cache)')
    .option('--dry-run', 'Show what would happen without making changes')
    .action(
      withErrorHandling(async (name: string | undefined, options: { force?: boolean; dryRun?: boolean }) => {
        const services = new Services();
        try {
          const collectionsService = services.get(CollectionsService);

          if (!collectionsService.projectConfigExists()) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const configFile = (config as any).get('project.configFile') as string;
            formatError(`No ${configFile} found. Run 'collections init' first.`);
            return;
          }

          const projectConfig = collectionsService.readProjectConfig();

          if (Object.keys(projectConfig.collections).length === 0) {
            formatInfo('No collections configured. Use "collections add" to add one.');
            return;
          }

          const toSync = name
            ? [[name, projectConfig.collections[name]] as const]
            : Object.entries(projectConfig.collections);

          if (name && !projectConfig.collections[name]) {
            formatError(`Collection "${name}" not found in project config.`);
            return;
          }

          // Handle dry-run mode separately
          if (options.dryRun) {
            formatWarning('Dry run mode - no changes will be made');
            console.log();

            for (const [collectionName] of toSync) {
              console.log(chalk.bold(`Syncing ${collectionName}...`));
              formatInfo('  Would sync this collection');
              console.log();
            }

            console.log(chalk.green.bold('All collections synced.'));
            return;
          }

          // Actually sync collections
          const client = await createCliClient();
          try {
            for (const [collectionName, spec] of toSync) {
              console.log(chalk.bold(`Syncing ${collectionName}...`));

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
      }),
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
