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

import { Services } from '#root/utils/utils.services.ts';
import { CollectionsService, type SyncResult } from '#root/collections/collections.ts';
import { isFileSpec, type FileSpec, type PkgSpec, type Manifest } from '#root/collections/collections.schemas.ts';
import { config } from '#root/config/config.ts';

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
    .argument('[source]', 'Path or URL (type will be inferred if not specified)')
    .description('Add a collection to the project config')
    .option('-t, --type <type>', 'Collection type (file or pkg)')
    .option('-p, --path <path>', 'Local path (for file type)')
    .option('-g, --glob <pattern>', 'Glob pattern (for file type)', '**/*.md')
    .option('-u, --url <url>', 'Manifest or bundle URL (for pkg type)')
    .action(
      withErrorHandling(
        async (
          name: string,
          source: string | undefined,
          options: { type?: string; path?: string; glob?: string; url?: string },
        ) => {
          const services = new Services();
          try {
            const collectionsService = services.get(CollectionsService);

            if (!collectionsService.projectConfigExists()) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const configFile = (config as any).get('project.configFile') as string;
              formatError(`No ${configFile} found. Run 'collections init' first.`);
              return;
            }

            // Determine the spec based on provided options
            let spec: FileSpec | PkgSpec;

            if (options.type === 'file' || options.path) {
              // Explicit file type
              const path = options.path || source;
              if (!path) {
                formatError('Path is required for file type. Use --path or provide as source argument.');
                return;
              }
              spec = {
                type: 'file',
                path,
                glob: options.glob || '**/*.md',
              };
            } else if (options.type === 'pkg' || options.url) {
              // Explicit pkg type
              const url = options.url || source;
              if (!url) {
                formatError('URL is required for pkg type. Use --url or provide as source argument.');
                return;
              }
              spec = {
                type: 'pkg',
                url,
              };
            } else if (source) {
              // Infer type from source
              if (source.startsWith('http://') || source.startsWith('https://') || source.startsWith('file://')) {
                spec = { type: 'pkg', url: source };
              } else {
                // Assume local path
                spec = { type: 'file', path: source, glob: options.glob || '**/*.md' };
              }
            } else {
              formatError('Must provide a source path/URL or use --path/--url options.');
              return;
            }

            collectionsService.addToProjectConfig(name, spec);

            if (isFileSpec(spec)) {
              formatSuccess(`Added file collection "${name}" (${spec.path}, ${spec.glob})`);
            } else {
              formatSuccess(`Added pkg collection "${name}" (${spec.url})`);
            }
          } finally {
            await services.destroy();
          }
        },
      ),
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

          if (options.drop) {
            const collectionId = collectionsService.computeCollectionId(spec);
            const { ReferencesService } = await import('#root/references/references.ts');
            const referencesService = services.get(ReferencesService);
            await referencesService.dropCollection(collectionId);
            await collectionsService.deleteCollection(collectionId);
            formatInfo(`Dropped indexed data for "${name}"`);
          }

          collectionsService.removeFromProjectConfig(name);
          formatSuccess(`Removed "${name}" from project config`);
        } finally {
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
          const sourceLengths = entries.map(([, spec]) => {
            if (isFileSpec(spec)) return `${spec.path} (${spec.glob})`.length;
            return spec.url.length;
          });
          const maxSourceLen = Math.min(Math.max(...sourceLengths, 20), 50);

          formatTableHeader([
            { name: 'Name', width: maxNameLen },
            { name: 'Type', width: 6 },
            { name: 'Source', width: maxSourceLen },
            { name: 'Status', width: 14 },
          ]);

          for (const [name, spec] of entries) {
            const status = await collectionsService.getSyncStatus(spec);
            const statusText = status === 'synced' ? chalk.green('✓ synced') : chalk.yellow('⚠ not synced');

            let source: string;
            if (isFileSpec(spec)) {
              source = `${spec.path} (${spec.glob})`;
            } else {
              source = spec.url;
            }

            // Truncate source if too long
            if (source.length > maxSourceLen) {
              source = source.substring(0, maxSourceLen - 3) + '...';
            }

            formatTableRow([
              { value: name, width: maxNameLen, color: chalk.cyan },
              { value: spec.type, width: 6, color: chalk.dim },
              { value: source, width: maxSourceLen, color: chalk.white },
              { value: statusText, width: 14 },
            ]);
          }

          console.log();
        } finally {
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

          if (options.dryRun) {
            formatWarning('Dry run mode - no changes will be made');
            console.log();
          }

          const toSync = name
            ? [[name, projectConfig.collections[name]] as const]
            : Object.entries(projectConfig.collections);

          if (name && !projectConfig.collections[name]) {
            formatError(`Collection "${name}" not found in project config.`);
            return;
          }

          for (const [collectionName, spec] of toSync) {
            const typeLabel = isFileSpec(spec) ? 'file' : 'pkg';
            console.log(chalk.bold(`Syncing ${collectionName} (${typeLabel})...`));

            if (options.dryRun) {
              formatInfo('  Would sync this collection');
              console.log();
              continue;
            }

            const result = await collectionsService.syncCollection(collectionName, spec, process.cwd(), {
              force: options.force,
              onProgress: (message) => {
                console.log(chalk.dim(`  ${message}`));
              },
            });

            printSyncResult(collectionName, result);
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
