'use strict';

const crypto = require('crypto');
const path = require('path');

const DEFAULT_ALLOWED_MIME = [
  'audio/webm',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/ogg'
];

function getAudioConfig(env = process.env) {
  const maxMb = Number(env.AUDIO_MAX_MB || 25);
  const allowedMime = (env.AUDIO_ALLOWED_MIME || DEFAULT_ALLOWED_MIME.join(','))
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  return {
    storageDir: env.AUDIO_STORAGE_DIR || path.join(__dirname, '..', 'data', 'audio'),
    maxBytes: Math.max(1, maxMb) * 1024 * 1024,
    allowedMime,
    retentionDays: Number(env.AUDIO_RETENTION_DAYS || 90),
    processingEnabled: env.AUDIO_PROCESSING_ENABLED === 'true'
  };
}

function validateAudioMetadata(input, config = getAudioConfig()) {
  const mimeType = String(input?.mimeType || '').toLowerCase();
  const bytes = Number(input?.bytes || 0);
  const errors = [];

  if (!mimeType || !config.allowedMime.includes(mimeType)) {
    errors.push('UNSUPPORTED_AUDIO_MIME');
  }
  if (!Number.isFinite(bytes) || bytes <= 0) {
    errors.push('INVALID_AUDIO_SIZE');
  } else if (bytes > config.maxBytes) {
    errors.push('AUDIO_TOO_LARGE');
  }

  return {
    valid: errors.length === 0,
    errors,
    mimeType,
    bytes
  };
}

function createAudioId() {
  return `aud_${crypto.randomBytes(9).toString('hex')}`;
}

function storageKeyFor(audioId, now = new Date()) {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return path.posix.join(year, month, `${audioId}.webm`);
}

module.exports = {
  DEFAULT_ALLOWED_MIME,
  createAudioId,
  getAudioConfig,
  storageKeyFor,
  validateAudioMetadata
};
