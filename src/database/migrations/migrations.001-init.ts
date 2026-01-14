import type { Migration } from './migrations.types.ts';

const tableNames = {
  referenceDocuments: 'reference_documents',
  referenceDocumentChunks: 'reference_documentchunks',
};

const init: Migration = {
  name: 'init',
  up: async (knex) => {
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
  },
};

export { init, tableNames };
