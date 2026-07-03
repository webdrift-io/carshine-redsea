'use strict';

const express = require('express');
const audio = require('../services/audio');

function createAudioRouter({ requireAuth, requireRole }) {
  const router = express.Router();

  router.use(requireAuth);

  router.get('/config', requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
    const config = audio.getAudioConfig();
    res.json({
      success: true,
      maxBytes: config.maxBytes,
      allowedMime: config.allowedMime,
      processingEnabled: config.processingEnabled
    });
  });

  router.post('/uploads', requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
    const check = audio.validateAudioMetadata(req.body || {});
    if (!check.valid) {
      return res.status(400).json({ success: false, code: 'AUDIO_VALIDATION_FAILED', errors: check.errors });
    }

    const id = audio.createAudioId();
    res.status(202).json({
      success: true,
      code: 'AUDIO_STORAGE_NOT_ENABLED',
      id,
      storageKey: audio.storageKeyFor(id),
      message: 'Audio metadata is valid. Multipart storage will be enabled in the audio implementation phase.'
    });
  });

  router.get('/:id', requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
    res.status(501).json({
      success: false,
      code: 'AUDIO_METADATA_NOT_IMPLEMENTED',
      id: req.params.id
    });
  });

  router.get('/:id/stream', requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
    res.status(501).json({
      success: false,
      code: 'AUDIO_STREAMING_NOT_IMPLEMENTED',
      id: req.params.id
    });
  });

  router.post('/:id/process', requireRole(['OWNER']), (req, res) => {
    res.status(501).json({
      success: false,
      code: 'AUDIO_PROCESSING_NOT_IMPLEMENTED',
      id: req.params.id
    });
  });

  return router;
}

module.exports = { createAudioRouter };
