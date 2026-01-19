import { z } from 'zod';

import type { Services } from '../utils/utils.services.js';
import { DocumentsService } from '../documents/documents.js';
import { CollectionsService } from '../collections/collections.js';
import type {
  ReferenceDocument,
  SearchChunkItem,
  ListDocumentsResult,
  OutlineResult,
  SectionResult,
  SearchBatchResult,
} from '../documents/documents.schemas.js';

import type { CollectionInfo, SystemStatus, SyncResult, CollectionRecordInfo } from './backend.schemas.js';
import {
  searchChunksOptionsSchema,
  updateCollectionOptionsSchema,
  dropCollectionParamsSchema,
  getDocumentParamsSchema,
  syncCollectionParamsSchema,
  listDocumentsParamsSchema,
  getOutlineParamsSchema,
  getSectionParamsSchema,
  findRelatedParamsSchema,
  searchBatchParamsSchema,
} from './backend.schemas.js';
import { procedure } from './backend.protocol.js';

// Factory to create service procedures with access to Services container
const createBackendServices = (services: Services, getStatus: () => { uptime: number; connections: number }) => {
  // Documents service procedures
  const documents = {
    listCollections: procedure(z.object({}), async (): Promise<CollectionInfo[]> => {
      const docService = services.get(DocumentsService);
      return docService.listCollections();
    }),

    dropCollection: procedure(dropCollectionParamsSchema, async (params): Promise<void> => {
      const docService = services.get(DocumentsService);
      await docService.dropCollection(params.collection);
    }),

    updateCollection: procedure(updateCollectionOptionsSchema, async (params): Promise<void> => {
      const docService = services.get(DocumentsService);
      await docService.updateCollectionFromGlob(params);
    }),

    search: procedure(searchChunksOptionsSchema, async (params): Promise<SearchChunkItem[]> => {
      const docService = services.get(DocumentsService);
      return docService.search(params);
    }),

    getDocument: procedure(getDocumentParamsSchema, async (params): Promise<ReferenceDocument | null> => {
      const docService = services.get(DocumentsService);
      return docService.getDocument(params.collection, params.id);
    }),

    // New procedures for MCP tools v2
    listDocuments: procedure(listDocumentsParamsSchema, async (params): Promise<ListDocumentsResult> => {
      const docService = services.get(DocumentsService);
      return docService.listDocuments(params);
    }),

    getOutline: procedure(getOutlineParamsSchema, async (params): Promise<OutlineResult | null> => {
      const docService = services.get(DocumentsService);
      return docService.getOutline(params);
    }),

    getSection: procedure(getSectionParamsSchema, async (params): Promise<SectionResult | null> => {
      const docService = services.get(DocumentsService);
      return docService.getSection(params);
    }),

    findRelated: procedure(findRelatedParamsSchema, async (params): Promise<SearchChunkItem[]> => {
      const docService = services.get(DocumentsService);
      return docService.findRelated(params);
    }),

    searchBatch: procedure(searchBatchParamsSchema, async (params): Promise<SearchBatchResult> => {
      const docService = services.get(DocumentsService);
      return docService.searchBatch(params);
    }),
  };

  // Collections service procedures
  const collections = {
    sync: procedure(syncCollectionParamsSchema, async (params): Promise<SyncResult> => {
      const colService = services.get(CollectionsService);
      return colService.syncCollection(params.name, params.spec, params.cwd, {
        force: params.force,
      });
    }),

    list: procedure(z.object({}), async (): Promise<CollectionRecordInfo[]> => {
      const colService = services.get(CollectionsService);
      const records = await colService.listCollections();
      return records.map((r) => ({
        id: r.id,
        url: r.url,
        name: r.name,
        version: r.version,
        lastSyncAt: r.last_sync_at,
      }));
    }),

    getSyncStatus: procedure(
      z.object({
        spec: z.object({ url: z.string() }),
      }),
      async (params): Promise<'synced' | 'not_synced' | 'stale'> => {
        const colService = services.get(CollectionsService);
        return colService.getSyncStatus(params.spec);
      },
    ),

    delete: procedure(z.object({ id: z.string() }), async (params): Promise<void> => {
      const colService = services.get(CollectionsService);
      await colService.deleteCollection(params.id);
    }),
  };

  // System procedures
  const system = {
    ping: procedure(z.object({}), async (): Promise<{ pong: true; timestamp: number }> => {
      return { pong: true, timestamp: Date.now() };
    }),

    status: procedure(z.object({}), async (): Promise<SystemStatus> => {
      const status = getStatus();
      return {
        uptime: status.uptime,
        connections: status.connections,
        services: ['documents', 'collections'],
      };
    }),

    shutdown: procedure(z.object({}), async (): Promise<void> => {
      // Shutdown is handled by the daemon, this just signals intent
      process.emit('SIGTERM');
    }),
  };

  return { documents, collections, system };
};

// Type for the services object returned by createBackendServices
type BackendServices = ReturnType<typeof createBackendServices>;

export type { BackendServices };
export { createBackendServices };
