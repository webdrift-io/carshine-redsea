/**
 * Vite i18n Plugin
 * Transforms `<%= var %>` template syntax in HTML files using i18n JSON
 * Generates per-language HTML output with proper meta tags
 *
 * Also injects a runtime i18n bridge (window.BOOKING_I18N) so the booking
 * result renderer can localize result-state copy without re-implementing
 * the language detection. The bridge only contains the `bookingStates`
 * subset — never the full bundle.
 */

import fs from 'fs';
import path from 'path';

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str) {
  return escapeHtml(str);
}

/**
 * Escape a JSON string so it can be embedded inside an HTML <script> tag.
 * Defends against `</script>` inside string literals and against Unicode
 * line/paragraph separators (which some browsers treat as a script
 * terminator). See https://html.spec.whatwg.org/multipage/scripting.html
 */
function escapeForScript(json) {
  return json
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\!--')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function interpolate(template, vars) {
  return template.replace(/<%=\s*([\w.]+)\s*%>/g, (match, key) => {
    const keys = key.split('.');
    let value = vars;
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        console.warn(`[i18n] Key not found: ${key}`);
        return match;
      }
    }
    return value;
  });
}

function loadI18n(lang) {
  const i18nPath = path.resolve(process.cwd(), `src/i18n/${lang}.json`);
  if (!fs.existsSync(i18nPath)) {
    throw new Error(`i18n file not found: ${i18nPath}`);
  }
  return JSON.parse(fs.readFileSync(i18nPath, 'utf8'));
}

/**
 * Build the runtime i18n bridge payload. Only the booking result subset
 * is exposed — never secrets, never the full i18n bundle, never the
 * landing-page hero / packages / FAQ copy.
 */
function buildRuntimeBridge(i18n) {
  const bookingStates = (i18n && i18n.bookingStates) || {};
  return {
    lang: i18n.lang,
    dir: i18n.dir,
    bookingStates
  };
}

function buildRuntimeBridgeScript(i18n) {
  const payload = buildRuntimeBridge(i18n);
  const json = escapeForScript(JSON.stringify(payload));
  return (
    `<script id="i18n-bridge" type="application/json">` +
    json +
    `</script>` +
    `<script>(function(){try{var b=document.getElementById('i18n-bridge');` +
    `if(b){window.BOOKING_I18N=JSON.parse(b.textContent||'{}');` +
    `window.dispatchEvent(new CustomEvent('booking-i18n:ready'));}}catch(e){` +
    `console.warn('[i18n] bridge parse failed',e);}})();</script>`
  );
}

function processI18nHtml(html, i18n) {
  let result = html;
  result = interpolate(result, i18n);
  result = result.replace(
    /<html\s+lang="[^"]*"\s+dir="[^"]*"/,
    `<html lang="${escapeAttr(i18n.lang)}" dir="${escapeAttr(i18n.dir)}"`
  );
  // Inject the runtime bridge just before </head>. The bridge is a
  // self-contained <script> pair that defines window.BOOKING_I18N.
  // We use a JSON <script> + tiny parser so we never need eval, and
  // so the data is accessible to non-script contexts (CSP-friendly).
  if (result.includes('</head>')) {
    result = result.replace('</head>', `${buildRuntimeBridgeScript(i18n)}</head>`);
  }
  return result;
}

export default function i18nPlugin(options = {}) {
  const { debug = false } = options;

  return {
    name: 'vite-plugin-i18n',
    enforce: 'pre',

    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const filename = ctx.filename || '';
        if (debug) console.log(`[i18n] transformIndexHtml: ${filename}`);

        // Match index.en.html, index.ar.html, index.de.html
        const match = filename.match(/index\.(\w+)\.html$/);
        if (!match) {
          if (debug) console.log(`[i18n] No language match for: ${filename}`);
          return html;
        }

        const lang = match[1];
        const i18n = loadI18n(lang);

        if (debug) console.log(`[i18n] Processing language: ${lang}`);

        return processI18nHtml(html, i18n);
      }
    }
  };
}
