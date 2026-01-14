#!/usr/bin/env node

import { Daemon } from '../src/daemon/daemon.ts';

const daemon = new Daemon();

await daemon.start();
