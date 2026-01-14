import type { Knex } from 'knex';

import type { Migration } from './migrations.types.ts';
import { init } from './migrations.001-init.ts';

const migrations: Migration[] = [init];

const migrationSource: Knex.MigrationSource<Migration> = {
  getMigration: async (migration) => migration,
  getMigrationName: (migration) => migration.name,
  getMigrations: async () => migrations,
};

export { tableNames } from './migrations.001-init.ts';
export { migrationSource };
