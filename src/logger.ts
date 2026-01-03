import type { Logging } from 'homebridge';

export type PluginLogLevel = 'debug' | 'warning' | 'none';

export class PluginLogger {
  constructor(
    private readonly log: Logging,
    private readonly level: PluginLogLevel,
  ) {}

  isDebugEnabled(): boolean {
    return this.level === 'debug';
  }

  info(message: string, ...parameters: unknown[]) {
    if (this.level === 'debug') {
      this.log.info(message, ...parameters);
    }
  }

  debug(message: string, ...parameters: unknown[]) {
    if (this.level === 'debug') {
      this.log.info(message, ...parameters);
    }
  }

  warn(message: string, ...parameters: unknown[]) {
    if (this.level !== 'none') {
      this.log.warn(message, ...parameters);
    }
  }

  error(message: string, ...parameters: unknown[]) {
    this.log.error(message, ...parameters);
  }
}
