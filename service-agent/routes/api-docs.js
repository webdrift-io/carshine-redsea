/**
 * API Documentation routes
 * Serves OpenAPI spec and Swagger UI
 */

const path = require('path');
const fs = require('fs');
const express = require('express');

const router = express.Router();

// Load OpenAPI spec
const SPEC_PATH = path.join(__dirname, '..', 'openapi.yaml');
let spec = '';
try {
  spec = fs.readFileSync(SPEC_PATH, 'utf8');
  console.log(`[API Docs] Loaded OpenAPI spec from ${SPEC_PATH} (${spec.length} bytes)`);
} catch (e) {
  console.error('[API Docs] Failed to load openapi.yaml:', e.message);
}

/**
 * Serve OpenAPI spec as JSON
 */
router.get('/openapi.json', (req, res) => {
  try {
    // Convert YAML to JSON for Swagger UI
    const yaml = require('yaml');
    const json = yaml.parse(spec);
    res.json(json);
  } catch (e) {
    console.error('[API Docs] YAML parse error:', e.message);
    res.status(500).json({ error: 'Failed to parse OpenAPI spec', message: e.message });
  }
});

/**
 * Serve raw OpenAPI spec
 */
router.get('/openapi.yaml', (req, res) => {
  res.type('text/yaml').send(spec);
});

/**
 * Serve Swagger UI
 */
router.get('/', (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CarShine API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.10.5/swagger-ui.css">
  <style>
    body { margin: 0; padding: 0; }
    .swagger-ui .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.10.5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/api-docs/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis
        ],
        layout: 'BaseLayout'
      });
    };
  </script>
</body>
</html>`;
  res.type('text/html').send(html);
});

module.exports = router;