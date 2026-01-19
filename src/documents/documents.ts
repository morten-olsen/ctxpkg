import { createHash, randomUUID } from 'node:crypto';
import { glob, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { TokenTextSplitter } from '@langchain/textsplitters';
import { type FeatureExtractionPipeline, pipeline, cos_sim } from '@huggingface/transformers';

import type { Services } from '../utils/utils.services.js';
import { DatabaseService, tableNames } from '../database/database.js';
import { EmbedderService } from '../embedder/embedder.js';

import {
  searchChunkItemSchema,
  type ReferenceDocument,
  type SearchChunksOptions,
  type SearchChunkItem,
  type ListDocumentsParams,
  type ListDocumentsResult,
  type GetOutlineParams,
  type OutlineResult,
  type OutlineItem,
  type GetSectionParams,
  type SectionResult,
  type FindRelatedParams,
  type SearchBatchParams,
  type SearchBatchResult,
} from './documents.schemas.js';

// Chunking configuration
const CHUNK_SIZE = 400;
const CHUNK_OVERLAP = 80;

// Search configuration
const RRF_K = 60; // Reciprocal Rank Fusion constant
const RERANK_CANDIDATES_MULTIPLIER = 3; // Fetch 3x candidates for re-ranking

class DocumentsService {
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

    // Get document counts per collection
    const docCounts = await database(tableNames.referenceDocuments)
      .select('collection', database.raw('COUNT(*) as document_count'))
      .groupBy('collection')
      .orderBy('collection', 'asc');

    // Get collection metadata (description, version) from collections table
    const collectionIds = docCounts.map((c) => c.collection);
    const collectionMeta = await database(tableNames.collections)
      .select('id', 'description', 'version')
      .whereIn('id', collectionIds);

    // Build a map of collection ID -> metadata
    const metaMap = new Map<string, { description: string | null; version: string | null }>();
    for (const meta of collectionMeta) {
      metaMap.set(meta.id, { description: meta.description, version: meta.version });
    }

    // Merge counts with metadata
    return docCounts.map((c) => {
      const meta = metaMap.get(c.collection);
      return {
        collection: c.collection,
        document_count: c.document_count,
        description: meta?.description ?? null,
        version: meta?.version ?? null,
      };
    });
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

    // Build vector search query
    // Note: We use a subquery to filter by computed distance since SQLite
    // doesn't support HAVING without GROUP BY
    let vectorQuery = database(tableNames.referenceDocumentChunks)
      .select('id', 'collection', 'document', 'content')
      .select(database.raw('vec_distance_cosine(?, embedding) as distance', [JSON.stringify(queryEmbedding)]));

    if (collections) {
      vectorQuery = vectorQuery.whereIn('collection', collections);
    }

    vectorQuery = vectorQuery.orderBy('distance', 'asc').limit(candidateLimit);

    let vectorResults = await vectorQuery;

    // Filter by maxDistance if specified (done in JS since SQLite doesn't support HAVING on computed columns)
    if (maxDistance !== undefined) {
      vectorResults = vectorResults.filter((row) => row.distance <= maxDistance);
    }

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

  // === New methods for MCP tools v2 ===

  /**
   * List documents in a collection with pagination.
   */
  public listDocuments = async (params: ListDocumentsParams): Promise<ListDocumentsResult> => {
    const { collection, limit = 100, offset = 0 } = params;

    const databaseService = this.#services.get(DatabaseService);
    const database = await databaseService.getInstance();

    // Get total count
    const [{ count: total }] = await database(tableNames.referenceDocuments).where({ collection }).count('* as count');

    // Get documents with pagination
    const documents = await database(tableNames.referenceDocuments)
      .select('id', 'content')
      .where({ collection })
      .orderBy('id', 'asc')
      .limit(limit)
      .offset(offset);

    const documentInfos = documents.map((doc) => ({
      id: doc.id,
      title: this.#extractTitle(doc.content, doc.id),
      size: doc.content.length,
    }));

    return {
      documents: documentInfos,
      total: Number(total),
      hasMore: offset + documents.length < Number(total),
    };
  };

  /**
   * Get the outline (heading structure) of a document.
   */
  public getOutline = async (params: GetOutlineParams): Promise<OutlineResult | null> => {
    const { collection, document: documentId, maxDepth = 3 } = params;

    const doc = await this.getDocument(collection, documentId);
    if (!doc) {
      return null;
    }

    const title = this.#extractTitle(doc.content, documentId);
    const outline = this.#parseOutline(doc.content, maxDepth);

    return { title, outline };
  };

  /**
   * Parse markdown content to extract heading outline.
   */
  #parseOutline = (content: string, maxDepth: number): OutlineItem[] => {
    const lines = content.split('\n');
    const outline: OutlineItem[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        const level = match[1].length;
        if (level <= maxDepth) {
          outline.push({
            level,
            text: match[2].trim(),
            line: i + 1, // 1-indexed line numbers
          });
        }
      }
    }

    return outline;
  };

  /**
   * Get a specific section of a document by heading.
   */
  public getSection = async (params: GetSectionParams): Promise<SectionResult | null> => {
    const { collection, document: documentId, section, includeSubsections = true } = params;

    const doc = await this.getDocument(collection, documentId);
    if (!doc) {
      return null;
    }

    const lines = doc.content.split('\n');
    let startLine = -1;
    let endLine = lines.length;
    let matchedHeading = '';
    let headingLevel = 0;

    // Find the section heading (case-insensitive substring match)
    const sectionLower = section.toLowerCase();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        const level = match[1].length;
        const text = match[2].trim();

        if (startLine === -1) {
          // Looking for the start
          if (text.toLowerCase().includes(sectionLower)) {
            startLine = i;
            matchedHeading = text;
            headingLevel = level;
          }
        } else {
          // Looking for the end
          if (includeSubsections) {
            // Stop at same or higher level heading
            if (level <= headingLevel) {
              endLine = i;
              break;
            }
          } else {
            // Stop at any heading
            endLine = i;
            break;
          }
        }
      }
    }

    if (startLine === -1) {
      return null;
    }

    const sectionContent = lines.slice(startLine, endLine).join('\n');

    return {
      section: matchedHeading,
      level: headingLevel,
      content: sectionContent,
      startLine: startLine + 1, // 1-indexed
      endLine: endLine, // 1-indexed (exclusive)
    };
  };

  /**
   * Find content related to a document or chunk.
   */
  public findRelated = async (params: FindRelatedParams): Promise<SearchChunkItem[]> => {
    const { collection, document: documentId, chunk, limit = 5, sameDocument = false } = params;

    const databaseService = this.#services.get(DatabaseService);
    const database = await databaseService.getInstance();
    const embedder = this.#services.get(EmbedderService);

    let queryEmbedding: number[];

    if (chunk) {
      // Embed the provided chunk
      queryEmbedding = await embedder.createQueryEmbedding(chunk);
    } else {
      // Compute centroid of document's chunk embeddings
      const chunks = await database(tableNames.referenceDocumentChunks)
        .select('embedding')
        .where({ collection, document: documentId });

      if (chunks.length === 0) {
        return [];
      }

      // Parse embeddings and compute mean
      const embeddings = chunks.map((c) => JSON.parse(c.embedding) as number[]);
      const dimensions = embeddings[0].length;
      const centroid = new Array(dimensions).fill(0);

      for (const emb of embeddings) {
        for (let i = 0; i < dimensions; i++) {
          centroid[i] += emb[i];
        }
      }

      for (let i = 0; i < dimensions; i++) {
        centroid[i] /= embeddings.length;
      }

      queryEmbedding = centroid;
    }

    // Search for similar chunks
    let query = database(tableNames.referenceDocumentChunks)
      .select('id', 'collection', 'document', 'content')
      .select(database.raw('vec_distance_cosine(?, embedding) as distance', [JSON.stringify(queryEmbedding)]));

    // Exclude source document unless sameDocument is true
    if (!sameDocument) {
      // Use explicit whereNot with function to ensure correct SQL generation
      query = query.whereNot(function () {
        this.where('collection', collection).andWhere('document', documentId);
      });
    }
    // When sameDocument is true, we include all chunks (no exclusion)

    query = query.orderBy('distance', 'asc').limit(limit);

    const results = await query;

    return results.map((row) => ({
      id: row.id,
      document: row.document,
      collection: row.collection,
      content: row.content,
      distance: row.distance,
      score: 1 - row.distance, // Convert distance to similarity score
    }));
  };

  /**
   * Execute multiple search queries in batch.
   */
  public searchBatch = async (params: SearchBatchParams): Promise<SearchBatchResult> => {
    const { queries, limit = 5, maxDistance, hybridSearch = true } = params;

    const results = [];

    for (const q of queries) {
      const searchResults = await this.search({
        query: q.query,
        collections: q.collections,
        limit,
        maxDistance,
        hybridSearch,
        rerank: false, // Don't rerank in batch for performance
      });

      results.push({
        query: q.query,
        results: searchResults,
      });
    }

    return { results };
  };
}

export { DocumentsService };
