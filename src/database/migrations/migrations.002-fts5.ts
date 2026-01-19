import type { Migration } from './migrations.types.js';

const ftsTableNames = {
  referenceDocumentChunksFts: 'reference_documentchunks_fts',
};

/**
 * Migration to add FTS5 virtual table for hybrid search.
 * This enables keyword-based search alongside vector similarity search.
 */
const fts5: Migration = {
  name: 'fts5',
  up: async (knex) => {
    // Create FTS5 virtual table for full-text search on chunks
    // We use content="" to create a contentless FTS table (external content)
    // This means we manage the content ourselves and just use FTS for indexing
    await knex.raw(`
      CREATE VIRTUAL TABLE ${ftsTableNames.referenceDocumentChunksFts} USING fts5(
        id,
        collection,
        document,
        content,
        tokenize='porter unicode61'
      )
    `);
  },
  down: async (knex) => {
    await knex.raw(`DROP TABLE IF EXISTS ${ftsTableNames.referenceDocumentChunksFts}`);
  },
};

export { fts5, ftsTableNames };
