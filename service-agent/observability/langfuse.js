/**
 * Langfuse tracing wrapper.
 *
 * Exposes a single function:
 *
 *     trace({ sessionId, name, metadata }, fn) -> Promise<fn result>
 *
 * Behaviour:
 *   - Always records the run to a JSONL log at
 *     service-agent/logs/langfuse-traces.jsonl (so traces work in
 *     DRY-RUN mode and survive across server restarts).
 *   - In LIVE mode (when LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY
 *     are set in env), it ALSO POSTs the trace to the Langfuse
 *     cloud ingestion endpoint. Failures there NEVER break the
 *     traced function — we just log a warning.
 *
 * Trace shape on disk:
 *   {
 *     id, timestamp, sessionId, name, status, durationMs,
 *     inputSize, outputSize, metadata, error, mode
 *   }
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'langfuse-traces.jsonl');
const INGESTION_URL = 'https://cloud.langfuse.com/api/public/ingestion';

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function isLiveMode() {
  return Boolean(
    process.env.LANGFUSE_PUBLIC_KEY &&
    process.env.LANGFUSE_SECRET_KEY
  );
}

function generateId() {
  return 'tr_' + crypto.randomBytes(8).toString('hex');
}

function safeStringify(obj) {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    return '<unserializable>';
  }
}

function approxSize(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'string') return value.length;
  if (typeof value === 'number') return String(value).length;
  return safeStringify(value).length;
}

function writeTrace(traceRecord) {
  try {
    ensureLogDir();
    fs.appendFileSync(LOG_FILE, safeStringify(traceRecord) + '\n', 'utf8');
  } catch (e) {
    // Never let logging break the traced function.
    // eslint-disable-next-line no-console
    console.warn('[langfuse] failed to write trace to disk:', e.message);
  }
}

function postToLangfuse(traceRecord) {
  // Langfuse ingestion batch format. We only push a minimal
  // span-shaped event so we don't have to map the full schema.
  const batch = {
    batch: [
      {
        id: traceRecord.id,
        timestamp: traceRecord.timestamp,
        type: 'trace-create',
        body: {
          id: traceRecord.id,
          timestamp: traceRecord.timestamp,
          name: traceRecord.name,
          sessionId: traceRecord.sessionId,
          metadata: {
            ...(traceRecord.metadata || {}),
            status: traceRecord.status,
            durationMs: traceRecord.durationMs,
            inputSize: traceRecord.inputSize,
            outputSize: traceRecord.outputSize,
            mode: traceRecord.mode
          }
        }
      }
    ]
  };

  // Best-effort: 1s timeout, swallow all errors.
  const controller = (typeof AbortController === 'function') ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), 1000) : null;

  return fetch(INGESTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Basic ' + Buffer.from(
        process.env.LANGFUSE_PUBLIC_KEY + ':' + process.env.LANGFUSE_SECRET_KEY
      ).toString('base64')
    },
    body: JSON.stringify(batch),
    signal: controller ? controller.signal : undefined
  })
    .then(res => {
      if (!res.ok) {
        // eslint-disable-next-line no-console
        console.warn('[langfuse] ingestion returned non-2xx:', res.status);
      }
    })
    .catch(err => {
      // eslint-disable-next-line no-console
      console.warn('[langfuse] ingestion failed:', err.message);
    })
    .finally(() => {
      if (timeout) clearTimeout(timeout);
    });
}

/**
 * Run `fn`, capturing a trace record around it.
 *
 * @param {object} args
 * @param {string} args.sessionId  - chat session id (or any grouping key)
 * @param {string} args.name       - human-readable name e.g. "IntakeAgent.respond"
 * @param {object} [args.metadata] - free-form tags; typical keys: chatSessionId, language, finalOutcome
 * @param {string} [args.input]    - the input passed to fn (used only to compute inputSize)
 * @param {Function} fn            - async (input) => output
 * @returns {Promise<*>} resolves with the fn() result
 */
async function trace(args, fn) {
  const { sessionId, name, metadata, input } = args || {};
  const id = generateId();
  const timestamp = new Date().toISOString();
  const startNs = process.hrtime.bigint();
  const inputSize = approxSize(input);
  const mode = isLiveMode() ? 'live' : 'dry-run';

  let status = 'success';
  let error = null;
  let output = null;

  try {
    output = await fn(input);
    return output;
  } catch (e) {
    status = 'error';
    error = e && e.message ? e.message : String(e);
    throw e;
  } finally {
    const endNs = process.hrtime.bigint();
    const durationMs = Number(endNs - startNs) / 1e6;
    const outputSize = approxSize(output);

    const traceRecord = {
      id,
      timestamp,
      sessionId: sessionId || null,
      name: name || 'unnamed',
      status,
      durationMs: Math.round(durationMs * 100) / 100,
      inputSize,
      outputSize,
      metadata: metadata || {},
      error,
      mode
    };

    writeTrace(traceRecord);

    if (mode === 'live') {
      // Fire-and-forget; never await — must not slow the agent.
      postToLangfuse(traceRecord);
    }
  }
}

module.exports = {
  trace,
  isLiveMode,
  LOG_FILE
};
