import { z } from 'zod';

const daemonStatusSchema = z.object({
  running: z.boolean(),
  socketPath: z.string(),
  pid: z.number(),
  uptime: z.number(),
  connections: z.number(),
});

type DaemonStatus = z.infer<typeof daemonStatusSchema>;

const daemonOptionsSchema = z.object({
  socketPath: z.string().optional(),
  idleTimeout: z.number().default(300000), // 5 minutes
  pidFile: z.string().optional(),
});

type DaemonOptions = z.infer<typeof daemonOptionsSchema>;

export type { DaemonStatus, DaemonOptions };
export { daemonStatusSchema, daemonOptionsSchema };
