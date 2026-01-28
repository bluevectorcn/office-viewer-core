import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Logger, LogLevel, LogEntry } from '@/shared/logging/Logger';

describe('Logger', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger({ enableConsole: false }); // 禁用控制台输出
  });

  it('should log debug messages', () => {
    const entries: LogEntry[] = [];
    logger.onLog((entry) => entries.push(entry));

    logger.debug('Debug message', { key: 'value' });

    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('debug');
    expect(entries[0].message).toBe('Debug message');
    expect(entries[0].metadata).toEqual({ key: 'value' });
  });

  it('should log info messages', () => {
    const entries: LogEntry[] = [];
    logger.onLog((entry) => entries.push(entry));

    logger.info('Info message');

    expect(entries[0].level).toBe('info');
    expect(entries[0].message).toBe('Info message');
  });

  it('should log warnings', () => {
    const entries: LogEntry[] = [];
    logger.onLog((entry) => entries.push(entry));

    logger.warn('Warning message', { code: 'WARN_001' });

    expect(entries[0].level).toBe('warn');
    expect(entries[0].metadata).toEqual({ code: 'WARN_001' });
  });

  it('should log errors with Error objects', () => {
    const entries: LogEntry[] = [];
    logger.onLog((entry) => entries.push(entry));

    const error = new Error('Test error');
    logger.error('Error occurred', error);

    expect(entries[0].level).toBe('error');
    expect(entries[0].metadata?.error).toHaveProperty('message', 'Test error');
    expect(entries[0].metadata?.error).toHaveProperty('name', 'Error');
  });

  it('should respect minimum log level', () => {
    const warnLogger = new Logger({ minLevel: 'warn', enableConsole: false });
    const entries: LogEntry[] = [];
    warnLogger.onLog((entry) => entries.push(entry));

    warnLogger.debug('Debug');
    warnLogger.info('Info');
    warnLogger.warn('Warn');
    warnLogger.error('Error');

    expect(entries).toHaveLength(2); // 只有 warn 和 error
    expect(entries[0].level).toBe('warn');
    expect(entries[1].level).toBe('error');
  });

  it('should include prefix and editorId in entries', () => {
    const prefixLogger = new Logger({
      prefix: '[Test]',
      editorId: 'editor-123',
      enableConsole: false
    });

    const entries: LogEntry[] = [];
    prefixLogger.onLog((entry) => entries.push(entry));

    prefixLogger.info('Message');

    expect(entries[0].prefix).toBe('[Test]');
    expect(entries[0].editorId).toBe('editor-123');
  });

  it('should support multiple handlers', () => {
    const entries1: LogEntry[] = [];
    const entries2: LogEntry[] = [];

    logger.onLog((entry) => entries1.push(entry));
    logger.onLog((entry) => entries2.push(entry));

    logger.info('Test');

    expect(entries1).toHaveLength(1);
    expect(entries2).toHaveLength(1);
  });

  it('should remove handler when unsubscribe is called', () => {
    const entries: LogEntry[] = [];
    const unsubscribe = logger.onLog((entry) => entries.push(entry));

    logger.info('Message 1');
    unsubscribe();
    logger.info('Message 2');

    expect(entries).toHaveLength(1);
  });

  it('should handle handler errors gracefully', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logger.onLog(() => {
      throw new Error('Handler error');
    });

    expect(() => logger.info('Test')).not.toThrow();
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('should create child logger with inherited config', () => {
    const parentLogger = new Logger({
      prefix: '[Parent]',
      minLevel: 'info',
      enableConsole: false
    });

    const childLogger = parentLogger.createChild({
      editorId: 'child-123'
    });

    const entries: LogEntry[] = [];
    childLogger.onLog((entry) => entries.push(entry));

    childLogger.info('Child message');

    expect(entries[0].prefix).toBe('[Parent]');
    expect(entries[0].editorId).toBe('child-123');
  });

  it('should clear all handlers', () => {
    const entries: LogEntry[] = [];
    logger.onLog((entry) => entries.push(entry));
    logger.onLog((entry) => entries.push(entry));

    logger.clearHandlers();
    logger.info('Test');

    expect(entries).toHaveLength(0);
  });

  it('should include timestamp in log entries', () => {
    const entries: LogEntry[] = [];
    logger.onLog((entry) => entries.push(entry));

    const before = Date.now();
    logger.info('Test');
    const after = Date.now();

    expect(entries[0].timestamp).toBeGreaterThanOrEqual(before);
    expect(entries[0].timestamp).toBeLessThanOrEqual(after);
  });
});
