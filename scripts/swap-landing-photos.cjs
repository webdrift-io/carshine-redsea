'use strict';
/**
 * Replace all unsplash photo URLs in index.html with local /assets/photos/*
 * files. Matches each unsplash photo-id to a context-appropriate local photo.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
let html = fs.readFileSync(INDEX, 'utf8');

// Map: unsplash photo-id → local photo (purpose-matched by section context)
// We match just the photo-ID portion; the query string varies so we only key on the ID.
const MAP_BY_ID = {
  'photo-1520340356584-f9917d1eea6f': {
    // hero variants — different w/q values map to different hero shots
    'w=900&q=86':  '/assets/photos/hero-mercedes-villa.jpg',
    'w=1500&q=86': '/assets/photos/hero-range-rover-marina.jpg',
    'w=1000&q=80': '/assets/photos/hero-bmw-poolside.jpg',
    'w=240&q=82':  '/assets/photos/hero-mercedes-villa.jpg'
  },
  'photo-1607860108855-64acf2078ed9': {
    'w=1000&q=80': '/assets/photos/gallery-paint-reflection.jpg',
    'w=700&q=80':  '/assets/photos/service-wheel-detail.jpg',
    'w=240&q=82':  '/assets/photos/service-wheel-detail.jpg',
    'w=900&q=80':  '/assets/photos/team-detailer-female.jpg'
  },
  'photo-1503376780353-7e6692767b70': {
    'w=1000&q=80': '/assets/photos/gallery-porsche-driveway.jpg',
    'w=240&q=82':  '/assets/photos/gallery-porsche-driveway.jpg'
  },
  'photo-1550355291-bbee04a92027': {
    'w=1000&q=80': '/assets/photos/gallery-aerial-marina.jpg'
  },
  'photo-1542362567-b07e54358753': {
    'w=1000&q=80': '/assets/photos/gallery-gwagon-villa.jpg',
    'w=700&q=80':  '/assets/photos/ops-dashboard-clean.jpg'
  },
  'photo-1619767886558-efdc259cde1a': {
    'w=700&q=80':  '/assets/photos/service-interior.jpg'
  },
  'photo-1616455164840-2f8c21d22bb5': {
    'w=700&q=80':  '/assets/photos/service-glass.jpg'
  },
  'photo-1603386329225-868f9b1ee6c9': {
    'w=700&q=80':  '/assets/photos/ops-ceramic-application.jpg',
    'w=240&q=82':  '/assets/photos/ops-ceramic-application.jpg'
  },
  'photo-1487754180451-c456f719a1fc': {
    'w=700&q=80':  '/assets/photos/ops-equipment-kit.jpg'
  },
  'photo-1556157382-97eda2d62296': {
    'w=900&q=80':  '/assets/photos/team-detailer-male.jpg'
  },
  'photo-1551836022-d5d88e9218df': {
    'w=900&q=80':  '/assets/photos/team-dispatch.jpg'
  },
  'photo-1500530855697-b586d89ba3ee': {
    'w=900&q=80':  '/assets/photos/area-elgouna-lagoon.jpg',
    'w=240&q=82':  '/assets/photos/gallery-landcruiser-desert.jpg'
  },
  'photo-1566073771259-6a8506099945': {
    'w=900&q=80':  '/assets/photos/area-hurghada-marina.jpg'
  },
  'photo-1540541338287-41700207dee6': {
    'w=900&q=80':  '/assets/photos/area-sahlhasheesh.jpg'
  },
  'photo-1572252009286-268acec5ca0a': {
    'w=900&q=80':  '/assets/photos/area-cairo-future.jpg'
  }
};

// Match any url containing the photo id + query string
const URL_RE = /https:\/\/images\.unsplash\.com\/(photo-[a-z0-9-]+)\?([^"'\s)]+)/g;
let replaced = 0;
const stillMissing = [];

html = html.replace(URL_RE, (full, photoId, query) => {
  const mapForId = MAP_BY_ID[photoId];
  if (!mapForId) {
    stillMissing.push(full);
    return full;
  }
  // Find the w=NNN&q=NN token in the query
  const wMatch = query.match(/w=(\d+)/);
  const qMatch = query.match(/q=(\d+)/);
  const key = `w=${wMatch ? wMatch[1] : ''}&q=${qMatch ? qMatch[1] : ''}`;
  const replacement = mapForId[key];
  if (!replacement) {
    // Fallback: first entry
    const fallback = Object.values(mapForId)[0];
    replaced++;
    return fallback;
  }
  replaced++;
  return replacement;
});

if (stillMissing.length) {
  console.warn(`WARN: ${stillMissing.length} unsplash URLs not in map:`);
  for (const u of [...new Set(stillMissing)]) console.warn('  ' + u);
}

fs.writeFileSync(INDEX, html);
console.log(`Replaced ${replaced} unsplash URLs with /assets/photos/* files.`);
console.log(`Remaining unsplash references: ${(html.match(/unsplash/g) || []).length}`);
console.log(`index.html size: ${(html.length / 1024).toFixed(1)} KB`);