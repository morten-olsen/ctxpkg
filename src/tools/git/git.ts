import { resolve } from 'node:path';

import { tool } from 'langchain';
import * as z from 'zod';
import { simpleGit } from 'simple-git';

const getStatus = tool(
  async ({ path }) => {
    const git = simpleGit(resolve(path || process.cwd()));
    const status = await git.status();
    return JSON.stringify(status, null, 2);
  },
  {
    name: 'git_status',
    description: 'Get the status of the git repository (staged, modified, untracked files)',
    schema: z.object({
      path: z.string().optional().describe('Path to the git repository root. Defaults to CWD.'),
    }),
  },
);

const getDiff = tool(
  async ({ path, target, cached }) => {
    const git = simpleGit(resolve(path || process.cwd()));
    const options = [];
    if (cached) options.push('--cached');
    if (target) options.push(target);

    const diff = await git.diff(options);
    return diff;
  },
  {
    name: 'git_get_diff',
    description:
      'Get diff of files. Use cached=true for staged changes, or provide a target (e.g. "main") to compare against.',
    schema: z.object({
      path: z.string().optional().describe('Path to the git repository root. Defaults to CWD.'),
      target: z.string().optional().describe('Target branch or commit to compare against (e.g., "main", "HEAD~1").'),
      cached: z.boolean().optional().describe('If true, shows staged changes.'),
    }),
  },
);

const getLog = tool(
  async ({ path, maxCount, from, to }) => {
    const git = simpleGit(resolve(path || process.cwd()));
    const logOptions: any = {};
    if (maxCount) logOptions.maxCount = maxCount;
    if (from && to) {
      logOptions.from = from;
      logOptions.to = to;
    }

    const log = await git.log(logOptions);
    return JSON.stringify(log.all, null, 2);
  },
  {
    name: 'git_get_log',
    description: 'Get the commit history.',
    schema: z.object({
      path: z.string().optional().describe('Path to the git repository root. Defaults to CWD.'),
      maxCount: z.number().optional().default(10).describe('Maximum number of commits to return.'),
      from: z.string().optional(),
      to: z.string().optional(),
    }),
  },
);

const gitTools = {
  getStatus,
  getDiff,
  getLog,
};

export { gitTools };
