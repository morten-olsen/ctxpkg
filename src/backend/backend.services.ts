import { z } from 'zod';

import { procedure } from './backend.protocol.ts';
import {
  searchChunksOptionsSchema,
  updateCollectionOptionsSchema,
  dropCollectionParamsSchema,
  getDocumentParamsSchema,
} from './backend.schemas.ts';
import type { CollectionInfo, SystemStatus } from './backend.schemas.ts';

import type { Services } from '#root/utils/utils.services.ts';
import { ReferencesService } from '#root/references/references.ts';
import type { ReferenceDocument, SearchChunkItem } from '#root/references/references.schemas.ts';

// Factory to create service procedures with access to Services container
const createBackendServices = (services: Services, getStatus: () => { uptime: number; connections: number }) => {
  // References service procedures
  const references = {
    listCollections: procedure(z.object({}), async (): Promise<CollectionInfo[]> => {
      const refService = services.get(ReferencesService);
      return refService.listCollections();
    }),

    dropCollection: procedure(dropCollectionParamsSchema, async (params): Promise<void> => {
      const refService = services.get(ReferencesService);
      await refService.dropCollection(params.collection);
    }),

    updateCollection: procedure(updateCollectionOptionsSchema, async (params): Promise<void> => {
      const refService = services.get(ReferencesService);
      await refService.updateCollectionFromGlob(params);
    }),

    search: procedure(searchChunksOptionsSchema, async (params): Promise<SearchChunkItem[]> => {
      const refService = services.get(ReferencesService);
      return refService.search(params);
    }),

    getDocument: procedure(getDocumentParamsSchema, async (params): Promise<ReferenceDocument | null> => {
      const refService = services.get(ReferencesService);
      return refService.getDocument(params.collection, params.id);
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
        services: ['references'],
      };
    }),

    shutdown: procedure(z.object({}), async (): Promise<void> => {
      // Shutdown is handled by the daemon, this just signals intent
      process.emit('SIGTERM');
    }),
  };

  return { references, system };
};

// Type for the services object returned by createBackendServices
type BackendServices = ReturnType<typeof createBackendServices>;

export type { BackendServices };
export { createBackendServices };
