import { z } from 'zod';

// === Project Config (context.json) ===

const collectionSpecSchema = z.object({
  url: z.string(),
});

const projectConfigSchema = z.object({
  collections: z.record(z.string(), collectionSpecSchema).default({}),
});

type CollectionSpec = z.infer<typeof collectionSpecSchema>;
type ProjectConfig = z.infer<typeof projectConfigSchema>;

// === Package Manifest (manifest.json) ===

const globSourcesSchema = z.object({
  glob: z.array(z.string()),
});

const fileEntryObjectSchema = z
  .object({
    path: z.string().optional(),
    url: z.string().optional(),
    hash: z.string().optional(),
  })
  .refine((data) => (data.path && !data.url) || (!data.path && data.url), {
    message: 'File entry must have either path or url, not both or neither',
  });

const fileEntrySchema = z.union([z.string(), fileEntryObjectSchema]);

const fileSourcesSchema = z.object({
  files: z.array(fileEntrySchema),
});

const manifestSourcesSchema = z.union([globSourcesSchema, fileSourcesSchema]);

const manifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  baseUrl: z.string().optional(),
  sources: manifestSourcesSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

type GlobSources = z.infer<typeof globSourcesSchema>;
type FileEntryObject = z.infer<typeof fileEntryObjectSchema>;
type FileEntry = z.infer<typeof fileEntrySchema>;
type FileSources = z.infer<typeof fileSourcesSchema>;
type ManifestSources = z.infer<typeof manifestSourcesSchema>;
type Manifest = z.infer<typeof manifestSchema>;

// === Database Record ===

const collectionRecordSchema = z.object({
  id: z.string(),
  url: z.string(),
  name: z.string().nullable(),
  version: z.string().nullable(),
  description: z.string().nullable(),
  manifest_hash: z.string().nullable(),
  last_sync_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

type CollectionRecord = z.infer<typeof collectionRecordSchema>;

// === Utility Types ===

type ResolvedFileEntry = {
  id: string; // Document ID (path or URL)
  url: string; // Resolved URL to fetch from
  hash?: string; // Optional hash for change detection
};

// === Helpers ===

const isGlobSources = (sources: ManifestSources): sources is GlobSources => {
  return 'glob' in sources;
};

const isFileSources = (sources: ManifestSources): sources is FileSources => {
  return 'files' in sources;
};

// === Git URL Parsing ===

type ParsedGitUrl = {
  protocol: 'git';
  cloneUrl: string; // URL to clone (without git+ prefix)
  ref: string | null; // Branch, tag, or commit SHA
  manifestPath: string; // Path to manifest within repo
};

/**
 * Check if a URL is a git URL (starts with git+https://, git+ssh://, or git+file://).
 */
const isGitUrl = (url: string): boolean => {
  return url.startsWith('git+https://') || url.startsWith('git+ssh://') || url.startsWith('git+file://');
};

/**
 * Parse a git URL into its components.
 *
 * Format: git+<protocol>://<host>/<path>[#<ref>]?manifest=<path>
 *
 * Examples:
 *   git+https://github.com/owner/repo#v1.0.0?manifest=docs/manifest.json
 *   git+ssh://git@github.com/org/repo#main?manifest=manifest.json
 */
const parseGitUrl = (url: string): ParsedGitUrl => {
  if (!isGitUrl(url)) {
    throw new Error(`Not a git URL: ${url}`);
  }

  // Remove git+ prefix
  const urlWithoutPrefix = url.slice(4);

  // Split off the fragment (#ref) first
  const hashIndex = urlWithoutPrefix.indexOf('#');
  const queryIndex = urlWithoutPrefix.indexOf('?');

  let baseUrl: string;
  let ref: string | null = null;
  let queryString: string;

  if (hashIndex !== -1 && (queryIndex === -1 || hashIndex < queryIndex)) {
    // Has fragment: extract ref
    baseUrl = urlWithoutPrefix.slice(0, hashIndex);
    const afterHash = urlWithoutPrefix.slice(hashIndex + 1);
    const refQueryIndex = afterHash.indexOf('?');
    if (refQueryIndex !== -1) {
      ref = afterHash.slice(0, refQueryIndex);
      queryString = afterHash.slice(refQueryIndex + 1);
    } else {
      ref = afterHash;
      queryString = '';
    }
  } else if (queryIndex !== -1) {
    // No fragment, but has query
    baseUrl = urlWithoutPrefix.slice(0, queryIndex);
    queryString = urlWithoutPrefix.slice(queryIndex + 1);
  } else {
    throw new Error(`Git URL must specify manifest path: ?manifest=<path>`);
  }

  // Parse query string for manifest path
  const params = new URLSearchParams(queryString);
  const manifestPath = params.get('manifest');

  if (!manifestPath) {
    throw new Error(`Git URL must specify manifest path: ?manifest=<path>`);
  }

  return {
    protocol: 'git',
    cloneUrl: baseUrl,
    ref: ref || null,
    manifestPath,
  };
};

export type {
  CollectionSpec,
  ProjectConfig,
  GlobSources,
  FileEntryObject,
  FileEntry,
  FileSources,
  ManifestSources,
  Manifest,
  CollectionRecord,
  ResolvedFileEntry,
  ParsedGitUrl,
};

export {
  collectionSpecSchema,
  projectConfigSchema,
  globSourcesSchema,
  fileEntryObjectSchema,
  fileEntrySchema,
  fileSourcesSchema,
  manifestSourcesSchema,
  manifestSchema,
  collectionRecordSchema,
  isGlobSources,
  isFileSources,
  isGitUrl,
  parseGitUrl,
};
