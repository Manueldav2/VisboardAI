// Durable meeting storage in real SQLite (sql.js / WASM — no native build).
// The DB lives at <userData>/gideon.db; we hold it in memory and flush to disk
// (debounced) on every change. Replaces the fragile ~5MB localStorage store.
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const os = require('os');
const initSqlJs = require('sql.js');

let db = null, dbPath = null, saveTimer = null;
function dlog(...a) { try { fs.appendFileSync(path.join(os.tmpdir(), 'gideon-db.log'), `[${new Date().toISOString()}] ${a.join(' ')}\n`); } catch {} }

async function initDb() {
  if (db) return;
  dlog('initDb start');
  const wasmPath = path.join(path.dirname(require.resolve('sql.js')), 'sql-wasm.wasm');
  dlog('wasmPath', wasmPath, 'exists', fs.existsSync(wasmPath));
  const SQL = await initSqlJs({ wasmBinary: fs.readFileSync(wasmPath) });
  dlog('sql.js loaded');
  dbPath = path.join(app.getPath('userData'), 'gideon.db');
  dlog('dbPath', dbPath);
  try {
    db = fs.existsSync(dbPath) ? new SQL.Database(fs.readFileSync(dbPath)) : new SQL.Database();
  } catch { db = new SQL.Database(); }
  db.run(`CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,
    title TEXT, date INTEGER, updated INTEGER, lines INTEGER,
    snippet TEXT, body TEXT, data TEXT
  );`);
  flush();
}

function flush() {
  if (!db || !dbPath) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(dbPath, Buffer.from(db.export())); } catch (e) { dlog('flush ERROR', String(e)); }
  }, 300);
}

function bodyText(n) {
  const lines = (n.lines || []).map((l) => l.text).join(' ');
  return [n.title || '', n.notes || '', n.enhanced || '', lines].join('\n').slice(0, 400000);
}
function snippetText(n) {
  const s = (n.enhanced || n.notes || (n.lines || []).map((l) => l.text).join(' ') || '')
    .replace(/[#*`\n]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.slice(0, 120);
}

function upsert(n) {
  if (!db || !n || !n.id) return;
  db.run(
    `INSERT OR REPLACE INTO meetings (id,title,date,updated,lines,snippet,body,data) VALUES (?,?,?,?,?,?,?,?)`,
    [n.id, n.title || '', n.date || 0, n.updated || Date.now(), (n.lines || []).length, snippetText(n), bodyText(n), JSON.stringify(n)]
  );
  flush();
}

function rowsToMeta(res) {
  if (!res || !res[0]) return [];
  return res[0].values.map(([id, title, date, updated, lines, snippet]) => ({ id, title, date, updated, lines, snippet }));
}
function listMeta() {
  return rowsToMeta(db.exec(`SELECT id,title,date,updated,lines,snippet FROM meetings ORDER BY COALESCE(updated,date) DESC`));
}
function search(q) {
  q = (q || '').trim();
  if (!q) return listMeta();
  const stmt = db.prepare(`SELECT id,title,date,updated,lines,snippet FROM meetings WHERE body LIKE ? ORDER BY COALESCE(updated,date) DESC`);
  stmt.bind([`%${q}%`]);
  const rows = [];
  while (stmt.step()) { const [id, title, date, updated, lines, snippet] = stmt.get(); rows.push({ id, title, date, updated, lines, snippet }); }
  stmt.free();
  return rows;
}
function get(id) {
  const stmt = db.prepare(`SELECT data FROM meetings WHERE id=?`);
  stmt.bind([id]);
  let out = null;
  if (stmt.step()) { try { out = JSON.parse(stmt.get()[0]); } catch {} }
  stmt.free();
  return out;
}
function remove(id) { if (db) { db.run(`DELETE FROM meetings WHERE id=?`, [id]); flush(); } }
function importAll(notes) { for (const n of notes || []) if (n && n.id) upsert(n); }
function count() { const r = db.exec(`SELECT COUNT(*) FROM meetings`); return r[0] ? r[0].values[0][0] : 0; }

module.exports = { initDb, upsert, listMeta, search, get, remove, importAll, count };
