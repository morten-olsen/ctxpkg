import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

import knex, { type Knex } from 'knex';
import type { Db } from 'sqlite-vec';

import { migrationSource } from './migrations/migrations.ts';

import { config } from '#root/config/config.ts';
import { destroy } from '#root/utils/utils.services.ts';

class DatabaseService {
  #instance?: Promise<Knex>;

  #setup = async () => {
    const sqliteVec = await import('sqlite-vec');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbPath = (config as any).get('database.path') as string;

    // Ensure directory exists
    const dbDir = dirname(dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    const db = knex({
      client: 'better-sqlite3',
      connection: {
        filename: dbPath,
      },
      useNullAsDefault: true,
      pool: {
        afterCreate: (conn: Db, done: (err: unknown, conn: Db) => void) => {
          sqliteVec.load(conn);
          done(null, conn);
        },
      },
    });

    await db.migrate.latest({
      migrationSource,
    });

    return db;
  };

  public getInstance = async () => {
    if (!this.#instance) {
      this.#instance = this.#setup();
    }
    return await this.#instance;
  };

  [destroy] = async () => {
    if (!this.#instance) {
      return;
    }
    const database = await this.#instance;
    await database.destroy();
  };
}

export { tableNames } from './migrations/migrations.ts';
export { DatabaseService };
