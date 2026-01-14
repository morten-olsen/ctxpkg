import { createHash, randomUUID } from 'node:crypto';
import { glob, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { TokenTextSplitter } from '@langchain/textsplitters';
import { type FeatureExtractionPipeline, pipeline, cos_sim } from '@huggingface/transformers';

import {
  searchChunkItemSchema,
  type ReferenceDocument,
  type SearchChunksOptions,
  type SearchChunkItem,
} from './references.schemas.ts';

import type { Services } from '#root/utils/utils.services.ts';
import { DatabaseService, tableNames } from '#root/database/database.ts';
import { EmbedderService } from '#root/embedder/embedder.ts';

// Chunking configuration
const CHUNK_SIZE = 400;
const CHUNK_OVERLAP = 80;

// Search configuration
const RRF_K = 60; // Reciprocal Rank Fusion constant
const RERANK_CANDIDATES_MULTIPLIER = 3; // Fetch 3x candidates for re-ranking

class ReferencesService {
  #services: Services;
  #reranker?: Promise<FeatureExtractionPipeline>;

  constructor(services: Services) {
    this.#services = services;
  }

  /**
   * Lazily initialize the re-ranker model.
   * Uses a smaller, faster model for re-ranking candidates.
   */
  #getReranker = async (): Promise<FeatureExtractionPipeline> => {
    if (!this.#reranker) {
      // Use a smaller model for fast re-ranking
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const loadPipeline = pipeline as any;
      this.#reranker = loadPipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2',
      ) as Promise<FeatureExtractionPipeline>;
    }
    return this.#reranker;
  };

  /**
   * Extract document title from markdown content.
   */
  #extractTitle = (content: string, fallback: string): string => {
    const titleMatch = content.match(/^#\s+(.+)$/m);
    return titleMatch?.[1]?.trim() || fallback;
  };

  /**
   * Extract the nearest preceding heading for a chunk position.
   */
  #extractSectionHeading = (content: string, chunkStart: number): string | null => {
    const beforeChunk = content.slice(0, chunkStart);
    const headings = beforeChunk.match(/^#{1,6}\s+.+$/gm);
    return headings?.[headings.length - 1]?.replace(/^#+\s+/, '') || null;
  };

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

    await database.transaction(async (trx) => {
      await trx(tableNames.referenceDocumentChunks).delete().where({ collection });
      await trx(tableNames.referenceDocumentChunksFts).delete().where({ collection });
      await trx(tableNames.referenceDocuments).delete().where({ collection });
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
      // Clean up existing chunks (both vector and FTS)
      if (current) {
        await trx(tableNames.referenceDocumentChunks).delete().where({
          collection: document.collection,
          document: document.id,
        });
        await trx(tableNames.referenceDocumentChunksFts).delete().where({
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

      // Create chunks with improved settings
      const splitter = new TokenTextSplitter({
        encodingName: 'cl100k_base',
        chunkSize: CHUNK_SIZE,
        chunkOverlap: CHUNK_OVERLAP,
      });
      const chunks = (await splitter.createDocuments([document.content])) as {
        pageContent: string;
        metadata: { loc: { lines: { from: number; to: number } } };
      }[];

      // Extract document title for context
      const title = this.#extractTitle(document.content, document.id);

      // Create contextualized chunks with document and section context
      const contextualizedChunks = chunks.map((chunk) => {
        // Find the character position approximately (using line info if available)
        const lines = document.content.split('\n');
        let charPos = 0;
        const startLine = chunk.metadata?.loc?.lines?.from ?? 0;
        for (let i = 0; i < startLine && i < lines.length; i++) {
          charPos += lines[i].length + 1;
        }

        const sectionHeading = this.#extractSectionHeading(document.content, charPos);

        // Build context prefix
        let contextPrefix = `Document: ${title}`;
        if (sectionHeading && sectionHeading !== title) {
          contextPrefix += `\nSection: ${sectionHeading}`;
        }

        return {
          // Embed with context for better semantic understanding
          textForEmbedding: `${contextPrefix}\n\n${chunk.pageContent}`,
          // Store original content for display
          originalContent: chunk.pageContent,
        };
      });

      // Create embeddings using document embedding method (no query instruction)
      const embedder = this.#services.get(EmbedderService);
      const embeddings = await embedder.createDocumentEmbeddings(contextualizedChunks.map((c) => c.textForEmbedding));

      // Insert chunks into vector table
      const chunkRecords = embeddings.map((embedding, i) => ({
        id: randomUUID(),
        collection: document.collection,
        document: document.id,
        content: contextualizedChunks[i].originalContent,
        embedding: JSON.stringify(embedding),
      }));

      await trx(tableNames.referenceDocumentChunks).insert(chunkRecords);

      // Insert into FTS5 table for hybrid search
      await trx(tableNames.referenceDocumentChunksFts).insert(
        chunkRecords.map((record) => ({
          id: record.id,
          collection: record.collection,
          document: record.document,
          content: record.content,
        })),
      );
    });
  };

  public search = async (options: SearchChunksOptions): Promise<SearchChunkItem[]> => {
    const { query, collections, limit = 10, maxDistance, hybridSearch = true, rerank = false } = options;

    const databaseService = this.#services.get(DatabaseService);
    const database = await databaseService.getInstance();

    // Determine how many candidates to fetch
    const candidateLimit = rerank ? limit * RERANK_CANDIDATES_MULTIPLIER : limit;

    // 1. Vector similarity search using cosine distance
    const embedder = this.#services.get(EmbedderService);
    const queryEmbedding = await embedder.createQueryEmbedding(query);

    let vectorQuery = database(tableNames.referenceDocumentChunks)
      .select('id', 'collection', 'document', 'content')
      .select(database.raw('vec_distance_cosine(?, embedding) as distance', [JSON.stringify(queryEmbedding)]));

    if (collections) {
      vectorQuery = vectorQuery.whereIn('collection', collections);
    }
    if (maxDistance !== undefined) {
      vectorQuery = vectorQuery.having('distance', '<=', maxDistance);
    }

    vectorQuery = vectorQuery.orderBy('distance', 'asc').limit(candidateLimit);

    const vectorResults = await vectorQuery;

    // 2. Keyword search using FTS5 (if hybrid search enabled)
    let keywordResults: { id: string; collection: string; document: string; content: string; rank: number }[] = [];

    if (hybridSearch) {
      // Escape special FTS5 characters and create search query
      const ftsQuery = query
        .replace(/['"(){}[\]*:^~\\]/g, ' ')
        .split(/\s+/)
        .filter((term) => term.length > 0)
        .map((term) => `"${term}"`)
        .join(' OR ');

      if (ftsQuery) {
        let ftsDbQuery = database(tableNames.referenceDocumentChunksFts)
          .select('id', 'collection', 'document', 'content')
          .select(database.raw('rank as rank'))
          .whereRaw(`${tableNames.referenceDocumentChunksFts} MATCH ?`, [ftsQuery]);

        if (collections) {
          ftsDbQuery = ftsDbQuery.whereIn('collection', collections);
        }

        ftsDbQuery = ftsDbQuery.orderBy('rank', 'asc').limit(candidateLimit);

        try {
          keywordResults = await ftsDbQuery;
        } catch {
          // FTS query might fail for edge cases, fall back to vector-only
          keywordResults = [];
        }
      }
    }

    // 3. Merge results using Reciprocal Rank Fusion (RRF)
    let mergedResults: SearchChunkItem[];

    if (hybridSearch && keywordResults.length > 0) {
      mergedResults = this.#reciprocalRankFusion(vectorResults, keywordResults, candidateLimit);
    } else {
      // Vector-only results
      mergedResults = vectorResults.map((row) => ({
        id: row.id,
        document: row.document,
        collection: row.collection,
        content: row.content,
        distance: row.distance,
        score: 1 / (RRF_K + 1), // Single source score
      }));
    }

    // 4. Re-rank using cross-encoder (if enabled)
    if (rerank && mergedResults.length > 0) {
      mergedResults = await this.#rerankResults(query, mergedResults);
    }

    // 5. Apply final limit and return
    return mergedResults.slice(0, limit).map((row) => searchChunkItemSchema.parse(row));
  };

  /**
   * Merge vector and keyword search results using Reciprocal Rank Fusion.
   * RRF score = sum(1 / (k + rank)) for each result across all rankings.
   */
  #reciprocalRankFusion = (
    vectorResults: { id: string; collection: string; document: string; content: string; distance: number }[],
    keywordResults: { id: string; collection: string; document: string; content: string; rank: number }[],
    limit: number,
  ): SearchChunkItem[] => {
    const scoreMap = new Map<string, { item: SearchChunkItem; score: number }>();

    // Add vector results with RRF scores
    vectorResults.forEach((item, rank) => {
      const rrfScore = 1 / (RRF_K + rank + 1);
      scoreMap.set(item.id, {
        item: {
          id: item.id,
          document: item.document,
          collection: item.collection,
          content: item.content,
          distance: item.distance,
        },
        score: rrfScore,
      });
    });

    // Add keyword results with RRF scores
    keywordResults.forEach((item, rank) => {
      const rrfScore = 1 / (RRF_K + rank + 1);
      const existing = scoreMap.get(item.id);

      if (existing) {
        // Combine scores if item appears in both result sets
        existing.score += rrfScore;
      } else {
        scoreMap.set(item.id, {
          item: {
            id: item.id,
            document: item.document,
            collection: item.collection,
            content: item.content,
            distance: 1, // Default distance for keyword-only results
          },
          score: rrfScore,
        });
      }
    });

    // Sort by combined RRF score (higher is better)
    const sorted = Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return sorted.map(({ item, score }) => ({ ...item, score }));
  };

  /**
   * Re-rank results using a secondary embedding model for higher precision.
   * Uses cosine similarity with a different model to diversify ranking signals.
   */
  #rerankResults = async (query: string, results: SearchChunkItem[]): Promise<SearchChunkItem[]> => {
    if (results.length === 0) return results;

    const reranker = await this.#getReranker();

    // Get embeddings for query and all result contents
    const queryEmbedding = await reranker(query, { pooling: 'mean', normalize: true });
    const contentEmbeddings = await reranker(
      results.map((r) => r.content),
      { pooling: 'mean', normalize: true },
    );

    // Compute cosine similarity scores
    const queryVec = queryEmbedding.tolist()[0];
    const contentVecs = contentEmbeddings.tolist();

    const scored = results.map((result, i) => {
      const similarity = cos_sim(queryVec, contentVecs[i]);
      return { ...result, score: similarity };
    });

    // Sort by re-ranker score (higher similarity is better)
    return scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
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

  /**
   * Get all document IDs and hashes in a collection.
   */
  public getDocumentIds = async (collection: string): Promise<{ id: string; hash: string }[]> => {
    const databaseService = this.#services.get(DatabaseService);
    const database = await databaseService.getInstance();

    const documents = await database(tableNames.referenceDocuments).select('id', 'hash').where({ collection });

    return documents.map((doc) => ({ id: doc.id, hash: doc.hash }));
  };

  /**
   * Delete a specific document from a collection.
   */
  public deleteDocument = async (collection: string, id: string): Promise<void> => {
    const databaseService = this.#services.get(DatabaseService);
    const database = await databaseService.getInstance();

    await database.transaction(async (trx) => {
      await trx(tableNames.referenceDocumentChunks).delete().where({
        collection,
        document: id,
      });
      await trx(tableNames.referenceDocumentChunksFts).delete().where({
        collection,
        document: id,
      });
      await trx(tableNames.referenceDocuments).delete().where({
        collection,
        id,
      });
    });
  };

  /**
   * Delete multiple documents from a collection.
   */
  public deleteDocuments = async (collection: string, ids: string[]): Promise<void> => {
    if (ids.length === 0) return;

    const databaseService = this.#services.get(DatabaseService);
    const database = await databaseService.getInstance();

    await database.transaction(async (trx) => {
      await trx(tableNames.referenceDocumentChunks).delete().where({ collection }).whereIn('document', ids);
      await trx(tableNames.referenceDocumentChunksFts).delete().where({ collection }).whereIn('document', ids);
      await trx(tableNames.referenceDocuments).delete().where({ collection }).whereIn('id', ids);
    });
  };
}

export { ReferencesService };
