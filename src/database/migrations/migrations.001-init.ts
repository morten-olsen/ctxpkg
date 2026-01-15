import type { Migration } from './migrations.types.ts';

const tableNames = {
  collections: 'collections',
  referenceDocuments: 'reference_documents',
  referenceDocumentChunks: 'reference_documentchunks',
};

const init: Migration = {
  name: 'init',
  up: async (knex) => {
    await knex.schema.createTable(tableNames.collections, (table) => {
      table.string('id').primary();
      table.text('url').notNullable();

      // manifest metadata
      table.string('name').nullable();
      table.string('version').nullable();
      table.text('description').nullable();
      table.string('manifest_hash').nullable();

      // sync state
      table.string('last_sync_at').nullable();

      table.string('created_at').notNullable();
      table.string('updated_at').notNullable();
    });

    await knex.schema.createTable(tableNames.referenceDocuments, (table) => {
      table.string('collection').notNullable();
      table.string('id').notNullable().index();
      table.string('hash').notNullable().index();
      table.text('content').notNullable();

      table.primary(['collection', 'id']);
    });

    await knex.schema.createTable(tableNames.referenceDocumentChunks, (table) => {
      table.string('id').primary();
      table.string('document').notNullable();
      table.string('collection').notNullable();
      table.text('content').notNullable();
      table.specificType('embedding', 'vector(1024)').notNullable();

      table.index(['collection']);
      table.index(['collection', 'document']);
    });
  },
  down: async (knex) => {
    await knex.schema.dropTable(tableNames.referenceDocumentChunks);
    await knex.schema.dropTable(tableNames.referenceDocuments);
    await knex.schema.dropTable(tableNames.collections);
  },
};

export { init, tableNames };
