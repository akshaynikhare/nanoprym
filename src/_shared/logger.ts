/**
 * Nanoprym Logger
 * Structured logging with Winston
 */
import winston from 'winston';

const LOG_LEVEL = process.env.NANOPRYM_LOG_LEVEL ?? 'info';

export const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'nanoprym' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} [${service}] ${level}: ${message}${metaStr}`;
        })
      ),
    }),
  ],
});

export function createChildLogger(module: string): winston.Logger {
  return logger.child({ module });
}
