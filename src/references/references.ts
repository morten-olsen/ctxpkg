import { createHash, randomUUID } from 'node:crypto';
import { glob, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

import { searchChunkItemSchema, type ReferenceDocument, type SearchChunksOptions } from './references.schemas.ts';

import type { Services } from '#root/utils/utils.services.ts';
import { DatabaseService, tableNames } from '#root/database/database.ts';
import { EmbedderService } from '#root/embedder/embedder.ts';

class ReferencesService {
  #services: Services;

  constructor(services: Services) {
    this.#services = services;
  }

  public listCollections = async () => {
    const databaseService = this.#services.get(DatabaseService);
    const database = await databaseService.getInstance();

    const collections = await database(tableNames.referenceDocuments)
      .select('collection', database.raw('COUNT(*) as document_count'))
      .groupBy('collection')
      .orderBy('collection', 'asc');

    return collections;
  };

  public dropCollection = async (collection: string) => {
    const databaseService = this.#services.get(DatabaseService);
    const database = await databaseService.getInstance();
    await database(tableNames.referenceDocuments).delete().where({
      collection,
    });
  };

  public updateCollectionFromGlob = async (options: { pattern: string; cwd: string; collection?: string }) => {
    const { pattern, collection, cwd } = options;
    for await (const file of glob(pattern, { cwd })) {
      const fullPath = resolve(cwd, file);
      const content = await readFile(fullPath, 'utf8');
      await this.updateDocument({
        collection: collection || cwd,
        id: file,
        content,
      });
    }
  };

  public updateDocument = async (document: ReferenceDocument) => {
    const databaseService = this.#services.get(DatabaseService);
    const database = await databaseService.getInstance();
    const hash = createHash('sha256').update(document.content).digest('hex');
    const [current] = await database(tableNames.referenceDocuments)
      .where({ collection: document.collection, id: document.id })
      .limit(1);

    if (current && current.hash === hash) {
      return;
    }
    await database.transaction(async (trx) => {
      if (current) {
        await trx(tableNames.referenceDocumentChunks).delete().where({
          collection: document.collection,
          document: document.id,
        });
        await trx(tableNames.referenceDocuments)
          .update({
            hash,
            content: document.content,
          })
          .where({
            collection: document.collection,
            id: document.id,
          });
      } else {
        await trx(tableNames.referenceDocuments).insert({
          collection: document.collection,
          id: document.id,
          hash,
          content: document.content,
        });
      }
      const splitter = RecursiveCharacterTextSplitter.fromLanguage('markdown', { chunkSize: 500, chunkOverlap: 0 });
      const chunks = (await splitter.createDocuments([document.content])) as { pageContent: string }[];
      const embedder = this.#services.get(EmbedderService);
      const embeddings = await embedder.createEmbeddings(chunks.map((chunk) => chunk.pageContent));
      await trx(tableNames.referenceDocumentChunks).insert(
        embeddings.map((embedding, i) => ({
          id: randomUUID(),
          collection: document.collection,
          document: document.id,
          content: chunks[i].pageContent,
          embedding: JSON.stringify(embedding),
        })),
      );
    });
  };

  public search = async (options: SearchChunksOptions) => {
    const { query, collections, limit } = options;
    const embedder = this.#services.get(EmbedderService);
    const [embedding] = await embedder.createEmbeddings([query]);

    const databaseService = this.#services.get(DatabaseService);
    const database = await databaseService.getInstance();

    let dbQuery = database(tableNames.referenceDocumentChunks)
      .select('*', database.raw('vec_distance_L2(?, embedding) as distance', [JSON.stringify(embedding)]))
      .limit(limit)
      .orderBy('distance', 'asc');

    if (collections) {
      dbQuery = dbQuery.whereIn('collection', collections);
    }

    const results = await dbQuery;
    return results.map((row) => searchChunkItemSchema.parse(row));
  };

  public getDocument = async (collection: string, id: string): Promise<ReferenceDocument | null> => {
    const databaseService = this.#services.get(DatabaseService);
    const database = await databaseService.getInstance();

    const [document] = await database(tableNames.referenceDocuments)
      .select('collection', 'id', 'content')
      .where({ collection, id })
      .limit(1);

    if (!document) {
      return null;
    }

    return {
      collection: document.collection,
      id: document.id,
      content: document.content,
    };
  };
}

export { ReferencesService };
