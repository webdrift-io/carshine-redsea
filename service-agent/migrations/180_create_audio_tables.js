'use strict';

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audio_files (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      booking_id TEXT,
      customer_id TEXT,
      uploaded_by_type TEXT NOT NULL CHECK (uploaded_by_type IN ('CUSTOMER','OWNER','DISPATCHER','SYSTEM')),
      uploaded_by_id TEXT,
      source_channel TEXT,
      storage_key TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      codec TEXT,
      bytes INTEGER NOT NULL CHECK (bytes > 0),
      duration_ms INTEGER,
      sha256 TEXT,
      status TEXT NOT NULL DEFAULT 'UPLOADED' CHECK (status IN ('UPLOADED','PROCESSING','READY','FAILED','DELETED')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_audio_files_conversation ON audio_files(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_audio_files_booking ON audio_files(booking_id);
    CREATE INDEX IF NOT EXISTS idx_audio_files_customer ON audio_files(customer_id);
    CREATE INDEX IF NOT EXISTS idx_audio_files_status ON audio_files(status);

    CREATE TABLE IF NOT EXISTS audio_processing_jobs (
      id TEXT PRIMARY KEY,
      audio_file_id TEXT NOT NULL REFERENCES audio_files(id) ON DELETE CASCADE,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','PROCESSING','SUCCEEDED','FAILED')),
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      result_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audio_jobs_audio_file ON audio_processing_jobs(audio_file_id);
    CREATE INDEX IF NOT EXISTS idx_audio_jobs_status ON audio_processing_jobs(status);
  `);
}

module.exports = { up };
