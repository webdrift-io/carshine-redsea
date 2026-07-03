'use strict';

const crypto = require('crypto');
const database = require('../database');

const { db } = database;

function nowIso() {
  return new Date().toISOString();
}

function genId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function cleanText(value, max = 1000) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

function requireText(value, field, max = 1000) {
  const s = cleanText(value, max);
  if (!s) {
    const err = new Error(`${field} is required`);
    err.status = 400;
    throw err;
  }
  return s;
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch (_e) { return fallback; }
}

function mapLead(row) {
  return row ? {
    id: row.id,
    source: row.source,
    name: row.name,
    email: row.email,
    phone: row.phone,
    area: row.area,
    interest: row.interest,
    intent: row.intent,
    status: row.status,
    priority: row.priority,
    notes: row.notes,
    nextFollowUpAt: row.next_follow_up_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } : null;
}

function mapContact(row) {
  return row ? {
    id: row.id,
    leadId: row.lead_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    message: row.message,
    status: row.status,
    followUpNotes: row.follow_up_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } : null;
}

function mapJoin(row) {
  return row ? {
    id: row.id,
    leadId: row.lead_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    roleType: row.role_type,
    message: row.message,
    status: row.status,
    adminNotes: row.admin_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } : null;
}

function mapFollowUp(row) {
  return row ? {
    id: row.id,
    leadId: row.lead_id,
    customerId: row.customer_id,
    title: row.title,
    channel: row.channel,
    status: row.status,
    dueAt: row.due_at,
    completedAt: row.completed_at,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } : null;
}

function mapMedia(row) {
  return row ? {
    id: row.id,
    title: row.title,
    topic: row.topic,
    platform: row.platform,
    caption: row.caption,
    hashtags: parseJson(row.hashtags, []),
    assetUrl: row.asset_url,
    status: row.status,
    provider: row.provider,
    meta: parseJson(row.meta, {}),
    scheduledAt: row.scheduled_at,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } : null;
}

function createLead(input = {}) {
  const ts = nowIso();
  const lead = {
    id: genId('lead'),
    source: cleanText(input.source, 40) || 'manual',
    name: cleanText(input.name, 160),
    email: cleanText(input.email, 180),
    phone: cleanText(input.phone, 80),
    area: cleanText(input.area, 120),
    interest: cleanText(input.interest, 160),
    intent: cleanText(input.intent, 240),
    status: cleanText(input.status, 40) || 'new',
    priority: cleanText(input.priority, 40) || 'normal',
    notes: cleanText(input.notes, 2000),
    nextFollowUpAt: cleanText(input.nextFollowUpAt || input.next_follow_up_at, 80)
  };
  db.prepare(`
    INSERT INTO business_leads
    (id, source, name, email, phone, area, interest, intent, status, priority, notes, next_follow_up_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(lead.id, lead.source, lead.name, lead.email, lead.phone, lead.area, lead.interest, lead.intent,
    lead.status, lead.priority, lead.notes, lead.nextFollowUpAt, ts, ts);
  return getLead(lead.id);
}

function listLeads(filters = {}) {
  const clauses = [];
  const params = [];
  if (filters.status) { clauses.push('status = ?'); params.push(String(filters.status)); }
  if (filters.q) {
    const q = `%${String(filters.q).trim().replace(/[%_]/g, '')}%`;
    clauses.push('(name LIKE ? OR email LIKE ? OR phone LIKE ? OR interest LIKE ? OR intent LIKE ?)');
    params.push(q, q, q, q, q);
  }
  const limit = Math.min(parseInt(filters.limit, 10) || 100, 500);
  const sql = `SELECT * FROM business_leads ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY created_at DESC LIMIT ?`;
  return db.prepare(sql).all(...params, limit).map(mapLead);
}

function getLead(id) {
  return mapLead(db.prepare('SELECT * FROM business_leads WHERE id = ?').get(id));
}

function updateLead(id, input = {}) {
  const existing = getLead(id);
  if (!existing) return null;
  const next = { ...existing, ...input };
  const ts = nowIso();
  db.prepare(`
    UPDATE business_leads SET source = ?, name = ?, email = ?, phone = ?, area = ?, interest = ?,
      intent = ?, status = ?, priority = ?, notes = ?, next_follow_up_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    cleanText(next.source, 40) || 'manual',
    cleanText(next.name, 160),
    cleanText(next.email, 180),
    cleanText(next.phone, 80),
    cleanText(next.area, 120),
    cleanText(next.interest, 160),
    cleanText(next.intent, 240),
    cleanText(next.status, 40) || 'new',
    cleanText(next.priority, 40) || 'normal',
    cleanText(next.notes, 2000),
    cleanText(next.nextFollowUpAt || next.next_follow_up_at, 80),
    ts,
    id
  );
  return getLead(id);
}

function deleteLead(id) {
  return db.prepare('DELETE FROM business_leads WHERE id = ?').run(id).changes > 0;
}

function createContactSubmission(input = {}) {
  const ts = nowIso();
  const contact = {
    id: genId('contact'),
    name: requireText(input.name, 'name', 160),
    email: cleanText(input.email, 180),
    phone: cleanText(input.phone, 80),
    message: requireText(input.message, 'message', 3000)
  };
  const lead = createLead({
    source: 'contact_form',
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    intent: contact.message.slice(0, 240),
    status: 'new',
    notes: contact.message
  });
  db.prepare(`
    INSERT INTO contact_submissions
    (id, lead_id, name, email, phone, message, status, follow_up_notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'new', NULL, ?, ?)
  `).run(contact.id, lead.id, contact.name, contact.email, contact.phone, contact.message, ts, ts);
  return getContact(contact.id);
}

function listContacts(filters = {}) {
  const clauses = [];
  const params = [];
  if (filters.status) { clauses.push('status = ?'); params.push(String(filters.status)); }
  if (filters.q) {
    const q = `%${String(filters.q).trim().replace(/[%_]/g, '')}%`;
    clauses.push('(name LIKE ? OR email LIKE ? OR phone LIKE ? OR message LIKE ?)');
    params.push(q, q, q, q);
  }
  const limit = Math.min(parseInt(filters.limit, 10) || 100, 500);
  return db.prepare(`SELECT * FROM contact_submissions ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY created_at DESC LIMIT ?`).all(...params, limit).map(mapContact);
}

function getContact(id) {
  return mapContact(db.prepare('SELECT * FROM contact_submissions WHERE id = ?').get(id));
}

function updateContact(id, input = {}) {
  const existing = getContact(id);
  if (!existing) return null;
  const ts = nowIso();
  db.prepare(`
    UPDATE contact_submissions SET status = ?, follow_up_notes = ?, updated_at = ? WHERE id = ?
  `).run(cleanText(input.status, 40) || existing.status, cleanText(input.followUpNotes || input.follow_up_notes, 2000), ts, id);
  if (existing.leadId && input.status) updateLead(existing.leadId, { status: input.status, notes: input.followUpNotes || existing.followUpNotes });
  return getContact(id);
}

function createJoinRequest(input = {}) {
  const ts = nowIso();
  const req = {
    id: genId('join'),
    name: requireText(input.name, 'name', 160),
    email: cleanText(input.email, 180),
    phone: cleanText(input.phone, 80),
    roleType: cleanText(input.roleType || input.role_type, 80) || 'team',
    message: cleanText(input.message, 3000)
  };
  const lead = createLead({
    source: 'join_request',
    name: req.name,
    email: req.email,
    phone: req.phone,
    interest: req.roleType,
    intent: req.message,
    status: 'new'
  });
  db.prepare(`
    INSERT INTO join_requests
    (id, lead_id, name, email, phone, role_type, message, status, admin_notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'new', NULL, ?, ?)
  `).run(req.id, lead.id, req.name, req.email, req.phone, req.roleType, req.message, ts, ts);
  return getJoinRequest(req.id);
}

function listJoinRequests(filters = {}) {
  const clauses = [];
  const params = [];
  if (filters.status) { clauses.push('status = ?'); params.push(String(filters.status)); }
  if (filters.q) {
    const q = `%${String(filters.q).trim().replace(/[%_]/g, '')}%`;
    clauses.push('(name LIKE ? OR email LIKE ? OR phone LIKE ? OR role_type LIKE ? OR message LIKE ?)');
    params.push(q, q, q, q, q);
  }
  const limit = Math.min(parseInt(filters.limit, 10) || 100, 500);
  return db.prepare(`SELECT * FROM join_requests ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY created_at DESC LIMIT ?`).all(...params, limit).map(mapJoin);
}

function getJoinRequest(id) {
  return mapJoin(db.prepare('SELECT * FROM join_requests WHERE id = ?').get(id));
}

function updateJoinRequest(id, input = {}) {
  const existing = getJoinRequest(id);
  if (!existing) return null;
  const ts = nowIso();
  db.prepare('UPDATE join_requests SET status = ?, admin_notes = ?, updated_at = ? WHERE id = ?')
    .run(cleanText(input.status, 40) || existing.status, cleanText(input.adminNotes || input.admin_notes, 2000), ts, id);
  if (existing.leadId && input.status) updateLead(existing.leadId, { status: input.status, notes: input.adminNotes || existing.adminNotes });
  return getJoinRequest(id);
}

function createFollowUp(input = {}) {
  const ts = nowIso();
  const id = genId('fu');
  db.prepare(`
    INSERT INTO follow_ups
    (id, lead_id, customer_id, title, channel, status, due_at, completed_at, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'open', ?, NULL, ?, ?, ?)
  `).run(id, cleanText(input.leadId || input.lead_id, 80), cleanText(input.customerId || input.customer_id, 80),
    requireText(input.title, 'title', 200), cleanText(input.channel, 40) || 'whatsapp',
    cleanText(input.dueAt || input.due_at, 80), cleanText(input.notes, 2000), ts, ts);
  return getFollowUp(id);
}

function listFollowUps(filters = {}) {
  const clauses = [];
  const params = [];
  if (filters.status) { clauses.push('status = ?'); params.push(String(filters.status)); }
  const limit = Math.min(parseInt(filters.limit, 10) || 100, 500);
  return db.prepare(`SELECT * FROM follow_ups ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY COALESCE(due_at, created_at) ASC LIMIT ?`).all(...params, limit).map(mapFollowUp);
}

function getFollowUp(id) {
  return mapFollowUp(db.prepare('SELECT * FROM follow_ups WHERE id = ?').get(id));
}

function updateFollowUp(id, input = {}) {
  const existing = getFollowUp(id);
  if (!existing) return null;
  const status = cleanText(input.status, 40) || existing.status;
  const completedAt = status === 'done' ? (existing.completedAt || nowIso()) : null;
  const ts = nowIso();
  db.prepare(`
    UPDATE follow_ups SET title = ?, channel = ?, status = ?, due_at = ?, completed_at = ?, notes = ?, updated_at = ?
    WHERE id = ?
  `).run(
    cleanText(input.title, 200) || existing.title,
    cleanText(input.channel, 40) || existing.channel,
    status,
    cleanText(input.dueAt || input.due_at, 80) || existing.dueAt,
    completedAt,
    cleanText(input.notes, 2000) || existing.notes,
    ts,
    id
  );
  return getFollowUp(id);
}

function createMedia(input = {}) {
  const ts = nowIso();
  const id = genId('media');
  const platform = cleanText(input.platform, 40) || 'instagram';
  const topic = cleanText(input.topic, 160) || 'premium mobile car wash';
  const title = cleanText(input.title, 180) || `${platform} content: ${topic}`;
  const caption = cleanText(input.caption, 3000) || buildDraftCaption(platform, topic);
  const hashtags = Array.isArray(input.hashtags) ? input.hashtags : defaultHashtags(platform);
  db.prepare(`
    INSERT INTO generated_media
    (id, title, topic, platform, caption, hashtags, asset_url, status, provider, meta, scheduled_at, approved_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `).run(id, title, topic, platform, caption, JSON.stringify(hashtags), cleanText(input.assetUrl || input.asset_url, 500),
    cleanText(input.status, 40) || 'draft', cleanText(input.provider, 80) || 'manual',
    JSON.stringify(input.meta || {}), cleanText(input.scheduledAt || input.scheduled_at, 80), ts, ts);
  return getMedia(id);
}

function buildDraftCaption(platform, topic) {
  const base = `CarShine Red Sea brings ${topic} directly to your car in El Gouna, Hurghada, and Sahl Hasheesh. Book a clean, premium wash with fast WhatsApp support.`;
  if (platform === 'tiktok') return `${base}\n\nShort video idea: before/after detail shot, water-bead close-up, final reveal.`;
  if (platform === 'facebook') return `${base}\n\nMessage us today to reserve your next wash.`;
  return `${base}\n\nSave this post for your next wash day.`;
}

function defaultHashtags(platform) {
  const common = ['CarShineRedSea', 'ElGouna', 'Hurghada', 'SahlHasheesh', 'MobileCarWash'];
  return platform === 'tiktok' ? [...common, 'CarTok', 'BeforeAfter'] : common;
}

function listMedia(filters = {}) {
  const clauses = [];
  const params = [];
  if (filters.status) { clauses.push('status = ?'); params.push(String(filters.status)); }
  if (filters.platform) { clauses.push('platform = ?'); params.push(String(filters.platform)); }
  const limit = Math.min(parseInt(filters.limit, 10) || 100, 500);
  return db.prepare(`SELECT * FROM generated_media ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY created_at DESC LIMIT ?`).all(...params, limit).map(mapMedia);
}

function getMedia(id) {
  return mapMedia(db.prepare('SELECT * FROM generated_media WHERE id = ?').get(id));
}

function updateMedia(id, input = {}) {
  const existing = getMedia(id);
  if (!existing) return null;
  const status = cleanText(input.status, 40) || existing.status;
  const approvedAt = status === 'approved' ? (existing.approvedAt || nowIso()) : existing.approvedAt;
  const ts = nowIso();
  db.prepare(`
    UPDATE generated_media SET title = ?, topic = ?, platform = ?, caption = ?, hashtags = ?, asset_url = ?,
      status = ?, provider = ?, meta = ?, scheduled_at = ?, approved_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    cleanText(input.title, 180) || existing.title,
    cleanText(input.topic, 160) || existing.topic,
    cleanText(input.platform, 40) || existing.platform,
    cleanText(input.caption, 3000) || existing.caption,
    JSON.stringify(Array.isArray(input.hashtags) ? input.hashtags : existing.hashtags),
    cleanText(input.assetUrl || input.asset_url, 500) || existing.assetUrl,
    status,
    cleanText(input.provider, 80) || existing.provider,
    JSON.stringify(input.meta || existing.meta || {}),
    cleanText(input.scheduledAt || input.scheduled_at, 80) || existing.scheduledAt,
    approvedAt,
    ts,
    id
  );
  return getMedia(id);
}

function deleteMedia(id) {
  return db.prepare('DELETE FROM generated_media WHERE id = ?').run(id).changes > 0;
}

function getSummary() {
  const scalar = (sql, params = []) => Number(db.prepare(sql).get(...params)?.n || 0);
  return {
    leads: scalar('SELECT COUNT(*) AS n FROM business_leads'),
    openLeads: scalar("SELECT COUNT(*) AS n FROM business_leads WHERE status NOT IN ('won','lost','closed')"),
    contacts: scalar('SELECT COUNT(*) AS n FROM contact_submissions'),
    newContacts: scalar("SELECT COUNT(*) AS n FROM contact_submissions WHERE status = 'new'"),
    joinRequests: scalar('SELECT COUNT(*) AS n FROM join_requests'),
    openFollowUps: scalar("SELECT COUNT(*) AS n FROM follow_ups WHERE status = 'open'"),
    mediaDrafts: scalar("SELECT COUNT(*) AS n FROM generated_media WHERE status = 'draft'")
  };
}

module.exports = {
  createLead,
  listLeads,
  getLead,
  updateLead,
  deleteLead,
  createContactSubmission,
  listContacts,
  updateContact,
  createJoinRequest,
  listJoinRequests,
  updateJoinRequest,
  createFollowUp,
  listFollowUps,
  updateFollowUp,
  createMedia,
  listMedia,
  updateMedia,
  deleteMedia,
  getSummary
};
