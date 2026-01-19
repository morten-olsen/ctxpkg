#!/usr/bin/env node

import { Daemon } from '../dist/daemon/daemon.js';

const daemon = new Daemon();

await daemon.start();
