import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { glob, readFile, stat } from 'node:fs/promises';

import { tool } from 'langchain';
import * as z from 'zod';

const getContent = tool(
  async (options) => {
    const { path, lineOffset, lineLimit } = options;
    const fullPath = resolve(path);
    if (!existsSync(fullPath)) {
      throw new Error('File does not exist');
    }
    const content = await readFile(fullPath, 'utf8');
    const lines = content.split('\n');
    return lines.slice(lineOffset, lineLimit);
  },
  {
    name: 'file_get_content',
    description: 'Get diff',
    schema: z.object({
      path: z.string(),
      lineOffset: z.number().optional(),
      lineLimit: z.number().optional(),
    }),
  },
);

const globFiles = tool(
  async (options) => {
    const { path, globPattern } = options;
    const fullPath = resolve(path);
    const files = new Set<string>();
    for await (const file of glob(globPattern, { cwd: fullPath })) {
      files.add(file);
    }
    return files;
  },
  {
    name: 'file_glob_files',
    description: 'Find files using glob pattern',
    schema: z.object({
      path: z.string(),
      globPattern: z.string(),
    }),
  },
);

const searchFiles = tool(
  async ({ path, globPattern, contentMatches }) => {
    const fullPath = resolve(path);
    const results = [];

    const regexes = contentMatches.map((pattern) => {
      // Logic to handle potential slash delimiters in strings like "/pattern/gim"
      const match = pattern.match(/^\/(.*)\/([a-z]*)$/);
      if (match) {
        return new RegExp(match[1], match[2].includes('g') ? match[2] : match[2] + 'g');
      }
      return new RegExp(pattern, 'gm'); // Default to global + multiline
    });

    for await (const file of glob(globPattern, { cwd: fullPath })) {
      const absoluteFilePath = resolve(fullPath, file);
      const content = await readFile(absoluteFilePath, 'utf8');

      for (const regex of regexes) {
        // Reset regex index for safety if 'g' flag is present
        regex.lastIndex = 0;
        let match;

        while ((match = regex.exec(content)) !== null) {
          // Calculate line number by counting newlines before the match index
          const linesBefore = content.substring(0, match.index).split('\n');
          const lineNumber = linesBefore.length;

          results.push({
            file: file,
            line: lineNumber,
            matchedText: match[0].substring(0, 100) + (match[0].length > 100 ? '...' : ''),
          });

          // Prevent infinite loops with zero-width matches
          if (match.index === regex.lastIndex) {
            regex.lastIndex++;
          }
        }
      }
    }

    return JSON.stringify(results, null, 2);
  },
  {
    name: 'file_search_multiline',
    description: 'Searches for multiline regex patterns in files and returns the file path and starting line number.',
    schema: z.object({
      path: z.string(),
      globPattern: z.string(),
      contentMatches: z.array(z.string()),
    }),
  },
);

const getFileStats = tool(
  async ({ path }) => {
    const fullPath = resolve(path);
    if (!existsSync(fullPath)) {
      throw new Error('File does not exist');
    }
    const stats = await stat(fullPath);
    return JSON.stringify(
      {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
      },
      null,
      2,
    );
  },
  {
    name: 'file_get_stats',
    description: 'Get metadata about a file (size, dates, type)',
    schema: z.object({
      path: z.string(),
    }),
  },
);

const fileTools = {
  getContent,
  globFiles,
  searchFiles,
  getFileStats,
};

export { fileTools };
