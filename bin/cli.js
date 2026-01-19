#!/usr/bin/env node

import { createProgram } from '../src/cli/cli.ts';

const program = createProgram();

// eslint-disable-next-line
await program.parseAsync(process.argv);
