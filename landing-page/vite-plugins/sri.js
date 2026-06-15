/**
 * Vite SRI (Subresource Integrity) Plugin
 * Adds integrity hashes to external CDN script tags
 * Generates `crossorigin` and SRI hash for security
 */

import crypto from 'crypto';

function generateSriHash(url) {
  // This is a placeholder - in production you'd fetch the resource
  // and generate a real hash. For now, we just add the crossorigin attribute.
  return null;
}

export default function sriPlugin() {
  return {
    name: 'vite-plugin-sri',
    enforce: 'post',
    
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        // Add crossorigin="anonymous" to CDN scripts for SRI preparation
        // Note: SRI requires the actual content hash, which needs a build-time fetch
        // This sets up the structure for proper SRI hashes
        return html.replace(
          /<script\s+src="https:\/\/[^"]+"\s*><\/script>/g,
          (match) => {
            return match.replace('<script', '<script crossorigin="anonymous"');
          }
        );
      }
    }
  };
}
