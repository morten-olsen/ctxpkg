import { z } from 'zod';

// === Project Config (context.json) ===

const fileSpecSchema = z.object({
  type: z.literal('file'),
  path: z.string(),
  glob: z.string().default('**/*.md'),
});

const pkgSpecSchema = z.object({
  type: z.literal('pkg'),
  url: z.string(),
});

const collectionSpecSchema = z.discriminatedUnion('type', [fileSpecSchema, pkgSpecSchema]);

const projectConfigSchema = z.object({
  collections: z.record(z.string(), collectionSpecSchema).default({}),
});

type FileSpec = z.infer<typeof fileSpecSchema>;
type PkgSpec = z.infer<typeof pkgSpecSchema>;
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
  type: z.enum(['file', 'pkg']),
  path: z.string().nullable(),
  glob: z.string().nullable(),
  url: z.string().nullable(),
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

const isFileSpec = (spec: CollectionSpec): spec is FileSpec => {
  return spec.type === 'file';
};

const isPkgSpec = (spec: CollectionSpec): spec is PkgSpec => {
  return spec.type === 'pkg';
};

export type {
  FileSpec,
  PkgSpec,
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
};

export {
  fileSpecSchema,
  pkgSpecSchema,
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
  isFileSpec,
  isPkgSpec,
};
