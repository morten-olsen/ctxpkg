import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, realpathSync, createWriteStream, mkdirSync } from 'node:fs';
import { readFile, glob, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import * as tar from 'tar';

import {
  projectConfigSchema,
  collectionRecordSchema,
  manifestSchema,
  isGlobSources,
  isFileSources,
  type ProjectConfig,
  type CollectionSpec,
  type CollectionRecord,
  type Manifest,
  type FileEntry,
  type ResolvedFileEntry,
} from './collections.schemas.ts';

import type { Services } from '#root/utils/utils.services.ts';
import { DatabaseService, tableNames } from '#root/database/database.ts';
import { DocumentsService } from '#root/documents/documents.ts';
import { config } from '#root/config/config.ts';

/**
 * Result of a sync operation.
 */
type SyncResult = {
  added: number;
  updated: number;
  removed: number;
  total: number;
};

class CollectionsService {
  #services: Services;

  constructor(services: Services) {
    this.#services = services;
  }

  // === Project Config ===

  /**
   * Get the project config file path for a given directory.
   */
  public getProjectConfigPath = (cwd: string = process.cwd()): string => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const configFile = (config as any).get('project.configFile') as string;
    return resolve(cwd, configFile);
  };

  /**
   * Check if a project config file exists.
   */
  public projectConfigExists = (cwd: string = process.cwd()): boolean => {
    return existsSync(this.getProjectConfigPath(cwd));
  };

  /**
   * Read and parse the project config file.
   */
  public readProjectConfig = (cwd: string = process.cwd()): ProjectConfig => {
    const configPath = this.getProjectConfigPath(cwd);
    if (!existsSync(configPath)) {
      return { collections: {} };
    }
    const content = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content);
    return projectConfigSchema.parse(parsed);
  };

  /**
   * Write the project config file.
   */
  public writeProjectConfig = (projectConfig: ProjectConfig, cwd: string = process.cwd()): void => {
    const configPath = this.getProjectConfigPath(cwd);
    const content = JSON.stringify(projectConfig, null, 2);
    writeFileSync(configPath, content, 'utf-8');
  };

  /**
   * Initialize a new project config file.
   */
  public initProjectConfig = (cwd: string = process.cwd(), force = false): void => {
    const configPath = this.getProjectConfigPath(cwd);
    if (existsSync(configPath) && !force) {
      throw new Error(`Project config already exists at ${configPath}`);
    }
    const initialConfig: ProjectConfig = { collections: {} };
    this.writeProjectConfig(initialConfig, cwd);
  };

  // === Global Config ===

  /**
   * Get the global config file path.
   */
  public getGlobalConfigPath = (): string => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (config as any).get('global.configFile') as string;
  };

  /**
   * Check if the global config file exists.
   */
  public globalConfigExists = (): boolean => {
    return existsSync(this.getGlobalConfigPath());
  };

  /**
   * Read and parse the global config file.
   */
  public readGlobalConfig = (): ProjectConfig => {
    const configPath = this.getGlobalConfigPath();
    if (!existsSync(configPath)) {
      return { collections: {} };
    }
    const content = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content);
    return projectConfigSchema.parse(parsed);
  };

  /**
   * Write the global config file. Auto-creates directory if needed.
   */
  public writeGlobalConfig = (globalConfig: ProjectConfig): void => {
    const configPath = this.getGlobalConfigPath();
    const configDir = dirname(configPath);

    // Ensure directory exists
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    const content = JSON.stringify(globalConfig, null, 2);
    writeFileSync(configPath, content, 'utf-8');
  };

  // === Unified Config Operations ===

  /**
   * Add a collection to project or global config.
   */
  public addToConfig = (name: string, spec: CollectionSpec, options: { global?: boolean; cwd?: string } = {}): void => {
    const { global: isGlobal = false, cwd = process.cwd() } = options;

    if (isGlobal) {
      const globalConfig = this.readGlobalConfig();
      if (name in globalConfig.collections) {
        throw new Error(`Collection "${name}" already exists in global config`);
      }
      globalConfig.collections[name] = spec;
      this.writeGlobalConfig(globalConfig);
    } else {
      this.addToProjectConfig(name, spec, cwd);
    }
  };

  /**
   * Remove a collection from project or global config.
   */
  public removeFromConfig = (name: string, options: { global?: boolean; cwd?: string } = {}): void => {
    const { global: isGlobal = false, cwd = process.cwd() } = options;

    if (isGlobal) {
      const globalConfig = this.readGlobalConfig();
      if (!(name in globalConfig.collections)) {
        throw new Error(`Collection "${name}" not found in global config`);
      }
      const { [name]: _removed, ...rest } = globalConfig.collections;
      void _removed;
      globalConfig.collections = rest;
      this.writeGlobalConfig(globalConfig);
    } else {
      this.removeFromProjectConfig(name, cwd);
    }
  };

  /**
   * Get a collection spec by name from project or global config.
   * If global is not specified, searches local first then global.
   */
  public getFromConfig = (name: string, options: { global?: boolean; cwd?: string } = {}): CollectionSpec | null => {
    const { global: isGlobal, cwd = process.cwd() } = options;

    if (isGlobal === true) {
      const globalConfig = this.readGlobalConfig();
      return globalConfig.collections[name] || null;
    }

    if (isGlobal === false) {
      return this.getFromProjectConfig(name, cwd);
    }

    // If global is undefined, search local first then global
    const localSpec = this.getFromProjectConfig(name, cwd);
    if (localSpec) {
      return localSpec;
    }

    const globalConfig = this.readGlobalConfig();
    return globalConfig.collections[name] || null;
  };

  /**
   * Get all collections from both local and global configs.
   * Returns a map with collection name as key and spec + source info as value.
   * Local collections take precedence over global ones with the same name.
   */
  public getAllCollections = (
    cwd: string = process.cwd(),
  ): Map<string, { spec: CollectionSpec; source: 'local' | 'global' }> => {
    const result = new Map<string, { spec: CollectionSpec; source: 'local' | 'global' }>();

    // Add global collections first
    const globalConfig = this.readGlobalConfig();
    for (const [name, spec] of Object.entries(globalConfig.collections)) {
      result.set(name, { spec, source: 'global' });
    }

    // Add local collections (will override global ones with same name)
    if (this.projectConfigExists(cwd)) {
      const projectConfig = this.readProjectConfig(cwd);
      for (const [name, spec] of Object.entries(projectConfig.collections)) {
        result.set(name, { spec, source: 'local' });
      }
    }

    return result;
  };

  // === Collection ID Computation ===

  /**
   * Normalize a path to its canonical absolute form.
   */
  public normalizePath = (path: string, basePath: string = process.cwd()): string => {
    const absolutePath = resolve(basePath, path);
    // Resolve symlinks to canonical path
    try {
      return realpathSync(absolutePath);
    } catch {
      // Path doesn't exist yet, return resolved path
      return absolutePath;
    }
  };

  /**
   * Compute the collection ID for a given spec.
   * Format: pkg:{normalized_url}
   */
  public computeCollectionId = (spec: CollectionSpec): string => {
    // Normalize URL (remove trailing slashes)
    const normalizedUrl = spec.url.replace(/\/+$/, '');
    return `pkg:${normalizedUrl}`;
  };

  // === Database Operations ===

  /**
   * Get a collection record by ID.
   */
  public getCollection = async (id: string): Promise<CollectionRecord | null> => {
    const databaseService = this.#services.get(DatabaseService);
    const database = await databaseService.getInstance();

    const [record] = await database(tableNames.collections).where({ id }).limit(1);

    if (!record) {
      return null;
    }

    return collectionRecordSchema.parse(record);
  };

  /**
   * List all collection records.
   */
  public listCollections = async (): Promise<CollectionRecord[]> => {
    const databaseService = this.#services.get(DatabaseService);
    const database = await databaseService.getInstance();

    const records = await database(tableNames.collections).orderBy('created_at', 'asc');

    return records.map((record) => collectionRecordSchema.parse(record));
  };

  /**
   * Create or update a collection record.
   */
  public upsertCollection = async (
    id: string,
    data: Omit<CollectionRecord, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<void> => {
    const databaseService = this.#services.get(DatabaseService);
    const database = await databaseService.getInstance();

    const now = new Date().toISOString();
    const existing = await this.getCollection(id);

    if (existing) {
      await database(tableNames.collections)
        .where({ id })
        .update({
          ...data,
          updated_at: now,
        });
    } else {
      await database(tableNames.collections).insert({
        id,
        ...data,
        created_at: now,
        updated_at: now,
      });
    }
  };

  /**
   * Delete a collection record.
   */
  public deleteCollection = async (id: string): Promise<void> => {
    const databaseService = this.#services.get(DatabaseService);
    const database = await databaseService.getInstance();

    await database(tableNames.collections).where({ id }).delete();
  };

  /**
   * Update the last sync timestamp for a collection.
   */
  public updateLastSync = async (id: string): Promise<void> => {
    const databaseService = this.#services.get(DatabaseService);
    const database = await databaseService.getInstance();

    const now = new Date().toISOString();
    await database(tableNames.collections).where({ id }).update({
      last_sync_at: now,
      updated_at: now,
    });
  };

  /**
   * Update the manifest hash for a collection.
   */
  public updateManifestHash = async (id: string, hash: string): Promise<void> => {
    const databaseService = this.#services.get(DatabaseService);
    const database = await databaseService.getInstance();

    const now = new Date().toISOString();
    await database(tableNames.collections).where({ id }).update({
      manifest_hash: hash,
      updated_at: now,
    });
  };

  // === Project Config Helpers ===

  /**
   * Add a collection to the project config.
   */
  public addToProjectConfig = (name: string, spec: CollectionSpec, cwd: string = process.cwd()): void => {
    const projectConfig = this.readProjectConfig(cwd);

    if (name in projectConfig.collections) {
      throw new Error(`Collection "${name}" already exists in project config`);
    }

    projectConfig.collections[name] = spec;
    this.writeProjectConfig(projectConfig, cwd);
  };

  /**
   * Remove a collection from the project config.
   */
  public removeFromProjectConfig = (name: string, cwd: string = process.cwd()): void => {
    const projectConfig = this.readProjectConfig(cwd);

    if (!(name in projectConfig.collections)) {
      throw new Error(`Collection "${name}" not found in project config`);
    }

    const { [name]: _removed, ...rest } = projectConfig.collections;
    void _removed; // Intentionally unused
    projectConfig.collections = rest;
    this.writeProjectConfig(projectConfig, cwd);
  };

  /**
   * Get a collection spec by name from the project config.
   */
  public getFromProjectConfig = (name: string, cwd: string = process.cwd()): CollectionSpec | null => {
    const projectConfig = this.readProjectConfig(cwd);
    return projectConfig.collections[name] || null;
  };

  // === Sync Status ===

  /**
   * Get sync status for a collection by computing its ID and checking the database.
   */
  public getSyncStatus = async (spec: CollectionSpec): Promise<'synced' | 'not_synced' | 'stale'> => {
    const id = this.computeCollectionId(spec);
    const record = await this.getCollection(id);

    if (!record || !record.last_sync_at) {
      return 'not_synced';
    }

    // For now, just check if it has ever been synced
    // Future: compare manifest hashes for staleness
    return 'synced';
  };

  // === Sync Operations ===

  /**
   * Sync a collection based on its spec.
   */
  public syncCollection = async (
    name: string,
    spec: CollectionSpec,
    cwd: string = process.cwd(),
    options: { force?: boolean; onProgress?: (message: string) => void } = {},
  ): Promise<SyncResult> => {
    return this.syncPkgCollection(name, spec, cwd, options);
  };

  // === Manifest Handling ===

  /**
   * Parse a manifest URL and determine its protocol.
   */
  public parseManifestUrl = (
    url: string,
    cwd: string = process.cwd(),
  ): { protocol: 'file' | 'https'; path: string; isBundle: boolean } => {
    const isBundle = url.endsWith('.tar.gz') || url.endsWith('.tgz');

    if (url.startsWith('file://')) {
      const filePath = url.slice(7); // Remove 'file://'
      const resolvedPath = this.normalizePath(filePath, cwd);
      return { protocol: 'file', path: resolvedPath, isBundle };
    }

    if (url.startsWith('https://') || url.startsWith('http://')) {
      return { protocol: 'https', path: url, isBundle };
    }

    // Assume it's a relative file path
    const resolvedPath = this.normalizePath(url, cwd);
    return { protocol: 'file', path: resolvedPath, isBundle };
  };

  /**
   * Load a manifest from a file:// URL.
   */
  public loadLocalManifest = async (manifestPath: string): Promise<Manifest> => {
    const content = await readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(content);
    return manifestSchema.parse(parsed);
  };

  /**
   * Resolve manifest sources to a list of file entries.
   * For glob sources: expand globs relative to manifest directory.
   * For files sources: resolve paths relative to manifest or baseUrl.
   */
  public resolveManifestSources = async (
    manifest: Manifest,
    manifestDir: string,
    protocol: 'file' | 'https',
  ): Promise<ResolvedFileEntry[]> => {
    const sources = manifest.sources;
    const baseUrl = manifest.baseUrl;

    if (isGlobSources(sources)) {
      if (protocol !== 'file') {
        throw new Error('Glob sources are only supported for file:// manifests');
      }

      const entries: ResolvedFileEntry[] = [];
      for (const pattern of sources.glob) {
        for await (const file of glob(pattern, { cwd: manifestDir })) {
          const fullPath = resolve(manifestDir, file);
          entries.push({
            id: file,
            url: `file://${fullPath}`,
          });
        }
      }
      return entries;
    }

    if (isFileSources(sources)) {
      return sources.files.map((entry) => this.resolveFileEntry(entry, manifestDir, baseUrl, protocol));
    }

    throw new Error('Unknown sources type in manifest');
  };

  /**
   * Resolve a single file entry to its final URL.
   */
  public resolveFileEntry = (
    entry: FileEntry,
    manifestDir: string,
    baseUrl: string | undefined,
    protocol: 'file' | 'https',
  ): ResolvedFileEntry => {
    // String shorthand = relative path
    if (typeof entry === 'string') {
      return this.resolveFileEntry({ path: entry }, manifestDir, baseUrl, protocol);
    }

    // Fully qualified URL
    if (entry.url) {
      return {
        id: entry.url,
        url: entry.url,
        hash: entry.hash,
      };
    }

    // Relative path
    if (entry.path) {
      let resolvedUrl: string;

      if (baseUrl) {
        // Resolve relative to baseUrl
        const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
        resolvedUrl = `${base}${entry.path}`;
      } else if (protocol === 'file') {
        // Resolve relative to manifest directory
        const fullPath = resolve(manifestDir, entry.path);
        resolvedUrl = `file://${fullPath}`;
      } else {
        // For https, resolve relative to manifest URL directory
        const base = manifestDir.endsWith('/') ? manifestDir : `${manifestDir}/`;
        resolvedUrl = `${base}${entry.path}`;
      }

      return {
        id: entry.path,
        url: resolvedUrl,
        hash: entry.hash,
      };
    }

    throw new Error('File entry must have either path or url');
  };

  /**
   * Fetch content from a URL (file:// or https://).
   */
  public fetchContent = async (url: string): Promise<string> => {
    if (url.startsWith('file://')) {
      const filePath = url.slice(7);
      return readFile(filePath, 'utf8');
    }

    if (url.startsWith('https://') || url.startsWith('http://')) {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
      }
      return response.text();
    }

    throw new Error(`Unsupported URL protocol: ${url}`);
  };

  /**
   * Load a manifest from a remote URL.
   */
  public loadRemoteManifest = async (manifestUrl: string): Promise<{ manifest: Manifest; content: string }> => {
    const content = await this.fetchContent(manifestUrl);
    const parsed = JSON.parse(content);
    const manifest = manifestSchema.parse(parsed);
    return { manifest, content };
  };

  /**
   * Get the directory part of a URL.
   */
  public getUrlDirectory = (url: string): string => {
    const lastSlash = url.lastIndexOf('/');
    return lastSlash >= 0 ? url.substring(0, lastSlash) : url;
  };

  // === Bundle Handling ===

  /**
   * Download a bundle to a temporary file and extract it.
   * Returns the path to the extracted directory.
   */
  public downloadAndExtractBundle = async (url: string, onProgress?: (message: string) => void): Promise<string> => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ai-assist-bundle-'));

    try {
      if (url.startsWith('file://')) {
        // Local bundle - extract directly
        const bundlePath = url.slice(7);
        onProgress?.('Extracting local bundle...');
        await tar.extract({
          file: bundlePath,
          cwd: tempDir,
        });
      } else {
        // Remote bundle - download then extract
        onProgress?.('Downloading bundle...');
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to download bundle: ${response.status} ${response.statusText}`);
        }

        const bundlePath = join(tempDir, 'bundle.tar.gz');

        // Stream response to file
        if (!response.body) {
          throw new Error('Response body is empty');
        }

        const fileStream = createWriteStream(bundlePath);
        await pipeline(Readable.fromWeb(response.body as import('stream/web').ReadableStream), fileStream);

        onProgress?.('Extracting bundle...');
        await tar.extract({
          file: bundlePath,
          cwd: tempDir,
        });
      }

      // Find the extracted content - could be in root or a subdirectory
      // Check if manifest.json exists at root or find it
      const manifestAtRoot = join(tempDir, 'manifest.json');
      if (existsSync(manifestAtRoot)) {
        return tempDir;
      }

      // Look for manifest in immediate subdirectories (common for tarballs)
      const { readdir } = await import('node:fs/promises');
      const entries = await readdir(tempDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subManifest = join(tempDir, entry.name, 'manifest.json');
          if (existsSync(subManifest)) {
            return join(tempDir, entry.name);
          }
        }
      }

      throw new Error('Could not find manifest.json in bundle');
    } catch (error) {
      // Clean up on error
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  };

  /**
   * Sync a bundle collection.
   */
  public syncBundleCollection = async (
    name: string,
    spec: CollectionSpec,
    cwd: string = process.cwd(),
    options: { force?: boolean; onProgress?: (message: string) => void } = {},
  ): Promise<SyncResult> => {
    const { force = false, onProgress } = options;
    const collectionId = this.computeCollectionId(spec);
    const { path: bundleUrl } = this.parseManifestUrl(spec.url, cwd);

    let tempDir: string | null = null;

    try {
      // Download and extract bundle
      tempDir = await this.downloadAndExtractBundle(bundleUrl, onProgress);
      const manifestPath = join(tempDir, 'manifest.json');

      onProgress?.('Reading manifest...');

      // Load manifest
      const manifest = await this.loadLocalManifest(manifestPath);
      const manifestContent = await readFile(manifestPath, 'utf8');
      const manifestHash = createHash('sha256').update(manifestContent).digest('hex');

      // Check if we can skip sync
      const existingCollection = await this.getCollection(collectionId);
      if (!force && existingCollection?.manifest_hash === manifestHash) {
        onProgress?.('Bundle unchanged, skipping sync');
        return { added: 0, updated: 0, removed: 0, total: 0 };
      }

      onProgress?.('Resolving sources...');

      // Resolve sources (always use 'file' protocol for extracted bundle)
      const entries = await this.resolveManifestSources(manifest, tempDir, 'file');

      // Get existing documents from database
      const documentsService = this.#services.get(DocumentsService);
      const existingDocs = await documentsService.getDocumentIds(collectionId);
      const existingMap = new Map(existingDocs.map((doc) => [doc.id, doc.hash]));

      // Compute changes
      const toAdd: ResolvedFileEntry[] = [];
      const toUpdate: ResolvedFileEntry[] = [];
      const toRemove: string[] = [];

      for (const entry of entries) {
        const existingHash = existingMap.get(entry.id);

        if (!existingHash) {
          toAdd.push(entry);
        } else if (force) {
          toUpdate.push(entry);
        } else if (entry.hash) {
          if (existingHash !== entry.hash) {
            toUpdate.push(entry);
          }
        } else {
          toUpdate.push(entry);
        }
      }

      const currentIds = new Set(entries.map((e) => e.id));
      for (const [id] of existingMap) {
        if (!currentIds.has(id)) {
          toRemove.push(id);
        }
      }

      // Apply changes
      if (toRemove.length > 0) {
        onProgress?.(`Removing ${toRemove.length} deleted documents...`);
        await documentsService.deleteDocuments(collectionId, toRemove);
      }

      const toProcess = [...toAdd, ...toUpdate];
      let actualUpdated = 0;

      for (let i = 0; i < toProcess.length; i++) {
        const entry = toProcess[i];
        const isNew = toAdd.includes(entry);
        onProgress?.(`${isNew ? 'Adding' : 'Checking'} ${entry.id} (${i + 1}/${toProcess.length})...`);

        const content = await this.fetchContent(entry.url);
        const contentHash = createHash('sha256').update(content).digest('hex');

        if (!isNew && !force && existingMap.get(entry.id) === contentHash) {
          continue;
        }

        if (!isNew) actualUpdated++;

        await documentsService.updateDocument({
          collection: collectionId,
          id: entry.id,
          content,
        });
      }

      // Update collection record
      await this.upsertCollection(collectionId, {
        url: spec.url,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description ?? null,
        manifest_hash: manifestHash,
        last_sync_at: new Date().toISOString(),
      });

      return {
        added: toAdd.length,
        updated: actualUpdated,
        removed: toRemove.length,
        total: entries.length,
      };
    } finally {
      // Clean up temp directory
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  };

  /**
   * Sync a pkg collection.
   */
  public syncPkgCollection = async (
    name: string,
    spec: CollectionSpec,
    cwd: string = process.cwd(),
    options: { force?: boolean; onProgress?: (message: string) => void } = {},
  ): Promise<SyncResult> => {
    const { force = false, onProgress } = options;
    const collectionId = this.computeCollectionId(spec);
    const { protocol, path: manifestPath, isBundle } = this.parseManifestUrl(spec.url, cwd);

    if (isBundle) {
      return this.syncBundleCollection(name, spec, cwd, options);
    }

    onProgress?.(`Loading manifest from ${manifestPath}...`);

    // Load and parse manifest based on protocol
    let manifest: Manifest;
    let manifestContent: string;
    let manifestDir: string;

    if (protocol === 'file') {
      manifest = await this.loadLocalManifest(manifestPath);
      manifestContent = await readFile(manifestPath, 'utf8');
      manifestDir = manifestPath.substring(0, manifestPath.lastIndexOf('/'));
    } else {
      const result = await this.loadRemoteManifest(manifestPath);
      manifest = result.manifest;
      manifestContent = result.content;
      manifestDir = this.getUrlDirectory(manifestPath);
    }

    // Check manifest hash to skip if unchanged
    const manifestHash = createHash('sha256').update(manifestContent).digest('hex');
    const existingCollection = await this.getCollection(collectionId);

    if (!force && existingCollection?.manifest_hash === manifestHash) {
      onProgress?.('Manifest unchanged, skipping sync');
      return { added: 0, updated: 0, removed: 0, total: 0 };
    }

    onProgress?.('Resolving sources...');

    // Resolve sources to file entries
    const entries = await this.resolveManifestSources(manifest, manifestDir, protocol);

    // Get existing documents from database
    const documentsService = this.#services.get(DocumentsService);
    const existingDocs = await documentsService.getDocumentIds(collectionId);
    const existingMap = new Map(existingDocs.map((doc) => [doc.id, doc.hash]));

    // Compute changes
    const toAdd: ResolvedFileEntry[] = [];
    const toUpdate: ResolvedFileEntry[] = [];
    const toRemove: string[] = [];

    for (const entry of entries) {
      const existingHash = existingMap.get(entry.id);

      if (!existingHash) {
        toAdd.push(entry);
      } else if (force) {
        toUpdate.push(entry);
      } else if (entry.hash) {
        // Manifest provides hash, compare with stored hash
        if (existingHash !== entry.hash) {
          toUpdate.push(entry);
        }
      } else {
        // No manifest hash, need to fetch and compare
        toUpdate.push(entry);
      }
    }

    const currentIds = new Set(entries.map((e) => e.id));
    for (const [id] of existingMap) {
      if (!currentIds.has(id)) {
        toRemove.push(id);
      }
    }

    // Apply changes
    if (toRemove.length > 0) {
      onProgress?.(`Removing ${toRemove.length} deleted documents...`);
      await documentsService.deleteDocuments(collectionId, toRemove);
    }

    const toProcess = [...toAdd, ...toUpdate];
    let actualUpdated = 0;

    for (let i = 0; i < toProcess.length; i++) {
      const entry = toProcess[i];
      const isNew = toAdd.includes(entry);
      onProgress?.(`${isNew ? 'Adding' : 'Checking'} ${entry.id} (${i + 1}/${toProcess.length})...`);

      try {
        const content = await this.fetchContent(entry.url);
        const contentHash = createHash('sha256').update(content).digest('hex');

        // Skip if content hash matches (for entries without manifest hash)
        if (!isNew && !force && existingMap.get(entry.id) === contentHash) {
          continue;
        }

        if (!isNew) actualUpdated++;

        await documentsService.updateDocument({
          collection: collectionId,
          id: entry.id,
          content,
        });
      } catch (error) {
        // Log warning but don't fail the entire sync for individual file failures
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        onProgress?.(`Warning: Failed to fetch ${entry.id}: ${errorMsg}`);
      }
    }

    // Update collection record
    await this.upsertCollection(collectionId, {
      url: spec.url,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description ?? null,
      manifest_hash: manifestHash,
      last_sync_at: new Date().toISOString(),
    });

    return {
      added: toAdd.length,
      updated: actualUpdated,
      removed: toRemove.length,
      total: entries.length,
    };
  };

  /**
   * Sync all collections from project config.
   */
  public syncAllCollections = async (
    cwd: string = process.cwd(),
    options: { force?: boolean; onProgress?: (name: string, message: string) => void } = {},
  ): Promise<Map<string, SyncResult>> => {
    const projectConfig = this.readProjectConfig(cwd);
    const results = new Map<string, SyncResult>();

    for (const [name, spec] of Object.entries(projectConfig.collections)) {
      const result = await this.syncCollection(name, spec, cwd, {
        force: options.force,
        onProgress: (message) => options.onProgress?.(name, message),
      });
      results.set(name, result);
    }

    return results;
  };
}

export { CollectionsService };
export type { SyncResult };
