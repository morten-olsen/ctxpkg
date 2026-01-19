import type { Knex } from 'knex';

import type { Migration } from './migrations.types.js';
import { init, tableNames as initTableNames } from './migrations.001-init.js';
import { fts5, ftsTableNames } from './migrations.002-fts5.js';

const migrations: Migration[] = [init, fts5];

const migrationSource: Knex.MigrationSource<Migration> = {
  getMigration: async (migration) => migration,
  getMigrationName: (migration) => migration.name,
  getMigrations: async () => migrations,
};

const tableNames = {
  ...initTableNames,
  ...ftsTableNames,
};

export { tableNames, migrationSource };
