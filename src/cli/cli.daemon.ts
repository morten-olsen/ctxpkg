import type { Command } from 'commander';

import {
  formatHeader,
  formatSuccess,
  formatInfo,
  formatTableHeader,
  formatTableRow,
  withErrorHandling,
  chalk,
} from './cli.utils.js';

import { DaemonManager } from '#root/daemon/daemon.manager.js';

const createDaemonCli = (command: Command) => {
  command.description('Manage the background daemon');

  // Start command
  command
    .command('start')
    .description('Start the daemon')
    .action(
      withErrorHandling(async () => {
        const manager = new DaemonManager();

        if (await manager.isRunning()) {
          formatInfo('Daemon is already running.');
          return;
        }

        formatInfo('Starting daemon...');
        await manager.start();
        formatSuccess('Daemon started.');

        const status = await manager.getStatus();
        if (status) {
          formatInfo(`Socket: ${chalk.cyan(status.socketPath)}`);
          formatInfo(`PID: ${chalk.cyan(status.pid)}`);
        }
      }),
    );

  // Stop command
  command
    .command('stop')
    .description('Stop the daemon')
    .action(
      withErrorHandling(async () => {
        const manager = new DaemonManager();

        if (!(await manager.isRunning())) {
          formatInfo('Daemon is not running.');
          return;
        }

        formatInfo('Stopping daemon...');
        await manager.stop();
        formatSuccess('Daemon stopped.');
      }),
    );

  // Status command
  command
    .command('status')
    .description('Show daemon status')
    .action(
      withErrorHandling(async () => {
        const manager = new DaemonManager();
        const status = await manager.getStatus();

        formatHeader('Daemon Status');

        if (!status) {
          formatInfo('Daemon is not running.');
          return;
        }

        const uptime = formatUptime(status.uptime);

        formatTableHeader([
          { name: 'Property', width: 15 },
          { name: 'Value', width: 40 },
        ]);

        formatTableRow([
          { value: 'Status', width: 15, color: chalk.white },
          { value: 'Running', width: 40, color: chalk.green },
        ]);

        formatTableRow([
          { value: 'PID', width: 15, color: chalk.white },
          { value: String(status.pid), width: 40, color: chalk.cyan },
        ]);

        formatTableRow([
          { value: 'Socket', width: 15, color: chalk.white },
          { value: status.socketPath, width: 40, color: chalk.cyan },
        ]);

        formatTableRow([
          { value: 'Uptime', width: 15, color: chalk.white },
          { value: uptime, width: 40, color: chalk.yellow },
        ]);

        formatTableRow([
          { value: 'Connections', width: 15, color: chalk.white },
          { value: String(status.connections), width: 40, color: chalk.magenta },
        ]);

        console.log();
      }),
    );

  // Restart command
  command
    .command('restart')
    .description('Restart the daemon')
    .action(
      withErrorHandling(async () => {
        const manager = new DaemonManager();

        if (await manager.isRunning()) {
          formatInfo('Stopping daemon...');
          await manager.stop();
          // Wait a bit for cleanup
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        formatInfo('Starting daemon...');
        await manager.start();
        formatSuccess('Daemon restarted.');

        const status = await manager.getStatus();
        if (status) {
          formatInfo(`Socket: ${chalk.cyan(status.socketPath)}`);
          formatInfo(`PID: ${chalk.cyan(status.pid)}`);
        }
      }),
    );
};

const formatUptime = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
};

export { createDaemonCli };
