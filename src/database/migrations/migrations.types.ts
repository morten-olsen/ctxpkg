import type { Knex } from 'knex';

type Migration = {
  name: string;
  up: (knex: Knex) => Promise<void>;
  down: (knex: Knex) => Promise<void>;
};

export type { Migration };
