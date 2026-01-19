import { config } from '../config/config.js';

const getSocketPath = (): string => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (config as any).get('daemon.socketPath') as string;
};

const getPidFile = (): string => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (config as any).get('daemon.pidFile') as string;
};

const getIdleTimeout = (): number => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (config as any).get('daemon.idleTimeout') as number;
};

const getAutoStart = (): boolean => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (config as any).get('daemon.autoStart') as boolean;
};

export { getSocketPath, getPidFile, getIdleTimeout, getAutoStart };
