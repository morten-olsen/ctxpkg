import type { Knex } from 'knex';

import type { Migration } from './migrations.types.ts';
import { init, tableNames as initTableNames } from './migrations.001-init.ts';
import { fts5, ftsTableNames } from './migrations.002-fts5.ts';

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
