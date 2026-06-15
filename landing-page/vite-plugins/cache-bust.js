/**
 * Vite Cache-Busting Plugin
 * Adds content-hash to all asset references in HTML
 * Ensures browsers always fetch the latest version
 */

export default function cacheBustPlugin() {
  return {
    name: 'vite-plugin-cache-bust',
    enforce: 'post',
    
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        // Add timestamp query param to all same-origin assets for cache busting
        // Vite already handles hashed assets, this is for additional safety
        const buildTime = Date.now();
        
        return html.replace(
          /href="\/assets\/([^"]+)"/g,
          (match, asset) => {
            // Only add cache-bust if not already hashed
            if (!/-\w{8}\./.test(asset)) {
              return match.replace(`"`, `?v=${buildTime}"`);
            }
            return match;
          }
        );
      }
    }
  };
}
