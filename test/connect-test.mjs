// Test end-to-end de sql-runner con SQLite local.
import path from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const packageDir = path.resolve(import.meta.dirname, '..');
const tmpDir = path.join(packageDir, 'test', 'tmp');
rmSync(tmpDir, { recursive: true, force: true });
const home = path.join(tmpDir, 'dsh-home');
mkdirSync(path.join(home, 'sql-runner'), { recursive: true });
writeFileSync(path.join(home, 'sql-runner', 'config.json'), JSON.stringify({ allowedPaths: [tmpDir] }), 'utf8');
const dbFile = path.join(tmpDir, 'demo.db');
const db = new DatabaseSync(dbFile);
db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);');
db.exec("INSERT INTO users (name) VALUES ('Ana'), ('Luis');");
db.close();

function makeClient(extraEnv = {}) {
  const entry = process.env.SQLRUN_SERVER ? path.resolve(process.env.SQLRUN_SERVER) : path.join(packageDir, 'server.mjs');
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { SystemRoot: process.env.SystemRoot || 'C:\\Windows', PATH: process.env.PATH, USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME || process.env.USERPROFILE, TEMP: process.env.TEMP, TMP: process.env.TMP, DSH_HOME: home, ...extraEnv }, stderr: 'pipe' });
  transport.stderr?.on('data', (c) => process.stderr.write(`[server] ${c}`));
  const client = new Client({ name: 'sqlrun-test', version: '1.0.0' }, { capabilities: {}, versionNegotiation: { mode: 'auto' } });
  return client.connect(transport).then(() => ({ client, transport }));
}
const textOf = (r) => (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');

const { client, transport } = await makeClient();
console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
console.log('--- status ---'); console.log(textOf(await client.callTool({ name: 'status', arguments: {} })));
const tables = textOf(await client.callTool({ name: 'tables', arguments: { path: dbFile } }));
console.log('--- tables ---'); console.log(tables);
console.log('tabla users y columnas:', tables.includes('users') && tables.includes('id INTEGER') && tables.includes('name TEXT'));
const select = textOf(await client.callTool({ name: 'query', arguments: { path: dbFile, sql: 'SELECT * FROM users ORDER BY id' } }));
console.log('--- select ---'); console.log(select);
console.log('filas 2 y Ana:', select.includes('Filas: 2') && select.includes('Ana'));
const writeNoConfirm = await client.callTool({ name: 'query', arguments: { path: dbFile, sql: "INSERT INTO users (name) VALUES ('Nuevo')" } });
console.log('escritura sin confirm isError:', writeNoConfirm.isError === true);
const inserted = textOf(await client.callTool({ name: 'query', arguments: { path: dbFile, sql: 'INSERT INTO users (name) VALUES (?)', params: ['Nuevo'], confirm: true } }));
console.log('--- insert ---'); console.log(inserted);
console.log('insert 1 cambio:', inserted.includes('"changes": 1'));
const count = textOf(await client.callTool({ name: 'query', arguments: { path: dbFile, sql: 'SELECT COUNT(*) AS total FROM users' } }));
console.log('total 3:', count.includes('"total": 3'));
const outside = await client.callTool({ name: 'query', arguments: { path: 'C:\\Windows\\x.db', sql: 'SELECT 1' } });
console.log('ruta fuera isError:', outside.isError === true);
const badSql = await client.callTool({ name: 'query', arguments: { path: dbFile, sql: 'SELECT * FROM no_existe' } });
console.log('sql inválido isError:', badSql.isError === true);
await client.close(); try { await transport.close?.(); } catch {}
const { client: roClient, transport: roTransport } = await makeClient({ DSH_SQLRUN_MODE: 'read-only' });
const roWrite = await roClient.callTool({ name: 'query', arguments: { path: dbFile, sql: "INSERT INTO users (name) VALUES ('X')", confirm: true } });
console.log('read-only escritura isError:', roWrite.isError === true);
await roClient.close(); try { await roTransport.close?.(); } catch {}
console.log('OK');
