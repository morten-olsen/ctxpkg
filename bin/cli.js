#!/usr/bin/env node

import { createProgram } from '../dist/cli/cli.js';

const program = createProgram();

// eslint-disable-next-line
await program.parseAsync(process.argv);
