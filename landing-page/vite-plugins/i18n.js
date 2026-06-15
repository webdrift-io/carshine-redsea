/**
 * Vite i18n Plugin
 * Transforms `<%= var %>` template syntax in HTML files using i18n JSON
 * Generates per-language HTML output with proper meta tags
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

function processI18nHtml(html, i18n) {
  let result = html;
  result = interpolate(result, i18n);
  result = result.replace(
    /<html\s+lang="[^"]*"\s+dir="[^"]*"/,
    `<html lang="${escapeAttr(i18n.lang)}" dir="${escapeAttr(i18n.dir)}"`
  );
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
