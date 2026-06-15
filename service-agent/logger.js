/**
 * Structured logging with Pino
 * - Production: JSON to stdout
 * - Development: pretty-printed with colors
 * - Replaces console.log/error scattered throughout
 */

const pino = require('pino');
const path = require('path');
const fs = require('fs');

const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const isDev = process.env.NODE_ENV !== 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  
  // Base context included in every log
  base: {
    service: 'carshine-service-agent',
    env: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0'
  },
  
  // ISO timestamps
  timestamp: pino.stdTimeFunctions.isoTime,
  
  // Redact sensitive fields automatically
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.apiKey',
      'req.body.api_key',
      'req.body.token',
      'res.headers["set-cookie"]',
      '*.password',
      '*.apiKey',
      '*.api_key',
      '*.token',
      '*.jwtSecret',
      '*.jwt',
      'adminCredentials.passwordHash',
      'config.postiz.apiKey',
      'config.imageGen.apiKey'
    ],
    censor: '[REDACTED]'
  },
  
  // Pretty print in dev
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname,service,env,version',
        singleLine: false
      }
    }
  })
});

const accessLogger = logger.child({ type: 'access' });
const errorLogger = logger.child({ type: 'error' });

// HTTP request logger middleware
function httpLogger(req, res, next) {
  const start = Date.now();
  const requestId = req.headers['x-request-id'] || 
    `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  
  req.id = requestId;
  res.setHeader('x-request-id', requestId);
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      requestId,
      method: req.method,
      url: req.url,
      status: res.statusCode,
      durationMs: duration,
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.headers['user-agent']?.substring(0, 100)
    };
    
    // Log to stdout
    if (res.statusCode >= 500) {
      errorLogger.error(logData, 'HTTP request failed');
    } else if (res.statusCode >= 400) {
      logger.warn(logData, 'HTTP request client error');
    } else {
      logger.info(logData, 'HTTP request');
    }
    
    // Persist access log
    accessLogger.info(logData);
  });
  
  next();
}

module.exports = {
  logger,
  httpLogger,
  accessLogger,
  errorLogger
};
