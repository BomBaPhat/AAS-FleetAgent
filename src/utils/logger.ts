/**
 * Centralized Logger for AAS-FleetAgent
 * Handles structured logging with timestamps and categories
 */

import fs from 'fs';
import path from 'path';
import { AgentLog } from '../types';

export class Logger {
  private logDir: string;
  private logLevel: 'debug' | 'info' | 'warn' | 'error';
  private logLevels = { debug: 0, info: 1, warn: 2, error: 3 };

  constructor(logDir: string = './logs', logLevel: string = 'info') {
    this.logDir = logDir;
    this.logLevel = (logLevel as any) || 'info';

    // Ensure log directory exists
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Format and write a log entry
   */
  private writeLog(
    level: 'debug' | 'info' | 'warn' | 'error',
    category: string,
    message: string,
    data?: any
  ): void {
    // Check if this log level should be printed
    if (
      this.logLevels[level] <
      this.logLevels[this.logLevel as keyof typeof this.logLevels]
    ) {
      return;
    }

    const timestamp = new Date().toISOString();
    const logEntry: AgentLog = {
      timestamp: Date.now(),
      level,
      category,
      message,
      data,
    };

    // Format for console
    const consoleMessage = `[${timestamp}] [${level.toUpperCase()}] [${category}] ${message}`;
    const consoleOutput =
      data !== undefined ? `${consoleMessage}\n${JSON.stringify(data, null, 2)}` : consoleMessage;

    // Output to console
    if (level === 'error') {
      console.error(consoleOutput);
    } else if (level === 'warn') {
      console.warn(consoleOutput);
    } else {
      console.log(consoleOutput);
    }

    // Write to file
    this.writeToFile(logEntry);
  }

  /**
   * Write log entry to file system
   */
  private writeToFile(logEntry: AgentLog): void {
    try {
      const date = new Date(logEntry.timestamp);
      const dateStr = date.toISOString().split('T')[0];
      const logFileName = `agent-${dateStr}.log`;
      const logFilePath = path.join(this.logDir, logFileName);

      const logLine = JSON.stringify(logEntry) + '\n';
      fs.appendFileSync(logFilePath, logLine);
    } catch (error) {
      console.error('Failed to write log to file:', error);
    }
  }

  // =========================================================================
  // Public Logging Methods
  // =========================================================================

  public debug(category: string, message: string, data?: any): void {
    this.writeLog('debug', category, message, data);
  }

  public info(category: string, message: string, data?: any): void {
    this.writeLog('info', category, message, data);
  }

  public warn(category: string, message: string, data?: any): void {
    this.writeLog('warn', category, message, data);
  }

  public error(category: string, message: string, data?: any): void {
    this.writeLog('error', category, message, data);
  }

  /**
   * Get recent logs from file
   */
  public getRecentLogs(limit: number = 100): AgentLog[] {
    try {
      const date = new Date();
      const dateStr = date.toISOString().split('T')[0];
      const logFileName = `agent-${dateStr}.log`;
      const logFilePath = path.join(this.logDir, logFileName);

      if (!fs.existsSync(logFilePath)) {
        return [];
      }

      const content = fs.readFileSync(logFilePath, 'utf-8');
      const lines = content.trim().split('\n');
      return lines.slice(-limit).map((line) => JSON.parse(line));
    } catch (error) {
      console.error('Failed to read recent logs:', error);
      return [];
    }
  }

  /**
   * Clear old logs (older than N days)
   */
  public clearOldLogs(daysOld: number = 7): void {
    try {
      const files = fs.readdirSync(this.logDir);
      const now = Date.now();
      const maxAge = daysOld * 24 * 60 * 60 * 1000;

      files.forEach((file) => {
        const filePath = path.join(this.logDir, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtime.getTime() > maxAge) {
          fs.unlinkSync(filePath);
          this.info('Logger', `Deleted old log file: ${file}`);
        }
      });
    } catch (error) {
      this.error('Logger', 'Failed to clear old logs', { error });
    }
  }
}

// Export singleton instance
export const logger = new Logger(process.env.LOG_DIR || './logs', process.env.LOG_LEVEL || 'info');
