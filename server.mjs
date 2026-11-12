#!/usr/bin/env node
// dsh-plugin-sql-runner — consultas SQL sobre SQLite local.
// Tools: status, tables, query.

import path from 'node:path';
import os from 'node:os';
import { existsSync, mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const VERSION = '0.1.0';
const DSH_HOME = (() => {
  const v = process.env.DSH_HOME && process.env.DSH_HOME.trim();
  return v || path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.dsh');
})();
const CONFIG_FILE = path.join(DSH_HOME, 'sql-runner', 'config.json');
const CACHE_DIR = path.join(DSH_HOME, 'cache', 'sql-runner');
const READ_ONLY = String(process.env.DSH_SQLRUN_MODE || '').toLowerCase() === 'read-only';
const MAX_ROWS = 1000;
const READONLY_SQL = /^\s*(SELECT|PRAGMA|EXPLAIN|WITH)\b/i;
const log = (m) => process.stderr.write(`[sqlrun] ${m}\n`);

function loadConfig() { try { if (existsSync(CONFIG_FILE)) return { allowedPaths: [], ...(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) || {}) }; } catch { /* defaults */ } return { allowedPaths: [] }; }
function allowedRoots() { const configured = loadConfig().allowedPaths; return (Array.isArray(configured) && configured.length ? configured : [process.env.USERPROFILE || process.env.HOME || os.homedir()]).map((item) => path.resolve(item)); }
function isAllowed(target) { const resolved = path.resolve(target); return allowedRoots().some((root) => resolved === root || resolved.startsWith(root + path.sep)); }
function openDb(file, readOnly) {
  const resolved = path.resolve(file);
  if (!existsSync(resolved)) throw new Error(`base de datos no existe: ${resolved}`);
  if (!isAllowed(resolved)) throw new Error(`ruta no permitida (revisa allowedPaths): ${resolved}`);
  return new DatabaseSync(resolved, { readOnly });
}
function closeDb(db) { try { db.close(); } catch { /* ignora */ } }
function textResult(text) { return { content: [{ type: 'text', text }] }; }

function buildInstructions() {
  return [
    'SQL Runner: consultas SQL sobre SQLite local (node:sqlite).',
    '',
    'Herramientas: status, tables, query.',
    '',
    'Reglas:',
    '- Lectura libre (SELECT/PRAGMA/EXPLAIN/WITH). Escrituras requieren confirm:true y no funcionan en read-only.',
    '- Límite de filas devueltas: ' + MAX_ROWS + '.',
    '- Cierra la base siempre; respeta allowedPaths.',
    '- Reporta filas/cambios reales; no inventes resultados.',
  ].join('\n');
}

function buildServer() {
  const server = new McpServer({ name: 'dsh-plugin-sql-runner', version: VERSION }, { capabilities: { tools: {} }, instructions: buildInstructions() });
  server.registerTool('status', { title: 'Estado', description: 'Rutas permitidas y modo.', inputSchema: z.object({}) }, async () => textResult([`Rutas permitidas: ${allowedRoots().join(', ')}`, `Filas máx: ${MAX_ROWS}`, `Modo: ${READ_ONLY ? 'read-only' : 'normal'}`].join('\n')));
  server.registerTool('tables', { title: 'Listar tablas', description: 'Tablas y columnas de la base.', inputSchema: z.object({ path: z.string().min(2) }) }, async (args) => {
    const db = openDb(args.path, true);
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
      if (tables.length === 0) return textResult('Sin tablas.');
      const lines = [];
      for (const table of tables) {
        const columns = db.prepare(`PRAGMA table_info(${JSON.stringify(table.name)})`).all();
        lines.push(`- ${table.name}: ${columns.map((column) => `${column.name} ${column.type || ''}`.trim()).join(', ')}`);
      }
      return textResult(lines.join('\n'));
    } finally { closeDb(db); }
  });
  server.registerTool('query', { title: 'Ejecutar SQL', description: 'SELECT (libre) o escritura (confirm:true).', inputSchema: z.object({ path: z.string().min(2), sql: z.string().min(1).max(20000), params: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).max(50).optional(), limit: z.number().int().min(1).max(MAX_ROWS).optional(), confirm: z.boolean().optional() }) }, async (args) => {
    const isRead = READONLY_SQL.test(args.sql);
    if (!isRead && READ_ONLY) throw new Error('modo read-only: escrituras deshabilitadas');
    if (!isRead && args.confirm !== true) throw new Error('escritura SQL requiere confirm:true y pedido explícito');
    if (!isRead && /^\s*(ATTACH|DETACH)\b/i.test(args.sql)) throw new Error('ATTACH/DETACH no permitido');
    const db = openDb(args.path, isRead);
    try {
      const statement = db.prepare(args.sql);
      const params = args.params || [];
      if (isRead) {
        const rows = statement.all(...params);
        const limited = rows.slice(0, args.limit ?? 200);
        return textResult([`Filas: ${rows.length}${rows.length > limited.length ? ` (mostrando ${limited.length})` : ''}`, '', JSON.stringify(limited, null, 2)].join('\n'));
      }
      const result = statement.run(...params);
      return textResult(JSON.stringify({ changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid !== undefined ? String(result.lastInsertRowid) : null }, null, 2));
    } catch (error) { throw new Error(`SQL error: ${error.message}`); }
    finally { closeDb(db); }
  });
  return server;
}

try { mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* ignora */ }
log(`modo: ${READ_ONLY ? 'read-only' : 'normal'}`);
serveStdio(buildServer, { onerror: (e) => log(`serveStdio: ${e.message}`) });
process.on('uncaughtException', (e) => log(`excepción: ${e.message}`));
process.on('unhandledRejection', (e) => log(`rechazo: ${e && e.message ? e.message : String(e)}`));
