#!/usr/bin/env node

import { createProgram } from '../src/cli/cli.ts';

const program = await createProgram();

await program.parseAsync(process.argv);
