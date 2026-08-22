// HTTP API + раздача статики (без зависимостей, node:http)
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, extname, resolve, sep } from 'node:path';
import { CONFIG } from './config.ts';
import { loadState, readProbes, buildCourtRows, type Incident } from './storage.ts';
import { loadRegionCourts } from './courts.ts';
import type { Scheduler } from './scheduler.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

const OK = new Set(['OK']);
const BAD = new Set(['DNS_FAIL', 'CONNECT_FAIL', 'TLS_FAIL', 'TIMEOUT', 'HTTP_ERR']);

// Кэш API: UI обновляется раз в 60с — кэш почти всегда попадает
let cache: { ts: number; summary: unknown; courts: unknown } | null = null;
const CACHE_TTL_MS = 45_000;

function getCached<T>(key: 'summary' | 'courts', build: () => T): T {
  if (!cache || Date.now() - cache.ts > CACHE_TTL_MS) {
    cache = { ts: Date.now(), summary: null, courts: null } as typeof cache;
  }
  if (cache[key] == null) cache[key] = build() as never;
  return cache[key] as T;
}

// Простой in-memory rate-limit: 60 req/мин на IP для тяжёлых /api/history
const rl = new Map<string, number[]>();
function rateLimitOk(ip: string, limit = 60, windowMs = 60_000): boolean {
  const now = Date.now();
  const arr = (rl.get(ip) ?? []).filter(t => now - t < windowMs);
  if (arr.length >= limit) { rl.set(ip, arr); return false; }
  arr.push(now); rl.set(ip, arr);
  if (rl.size > 500) { // защита от разрастания
    const first = rl.keys().next().value as string;
    rl.delete(first);
  }
  return true;
}

export function startApi(sched: Scheduler): void {
  const courts = loadRegionCourts();

  const server = createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      });
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const path = url.pathname;

    try {
      if (path === '/api/summary') return json(res, getCached('summary', () => summary(courts)));
      if (path === '/api/courts') return json(res, getCached('courts', () => buildCourtRows(courts, loadState(), readProbes(1))));
      if (path === '/api/history') {
        const ip = req.socket.remoteAddress ?? 'unknown';
        if (!rateLimitOk(ip)) return json(res, { error: 'rate limited' }, 429);
        const code = url.searchParams.get('code') ?? '';
        const days = clampDays(url.searchParams.get('days'));
        const limitRaw = Number(url.searchParams.get('limit') ?? 0);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 20_000) : 0;
        let rows = readProbes(days, code);
        if (limit && rows.length > limit) rows = rows.slice(-limit);
        // жёсткий потолок без limit — защита от 100 МБ ответа
        if (!limit && rows.length > 20_000) rows = rows.slice(-20_000);
        return json(res, rows);
      }
      if (path === '/api/incidents') {
        const days = clampDays(url.searchParams.get('days'));
        return json(res, sched.getIncidents().filter(i => i.endTs === null || Date.now() - i.endTs < days * 86_400_000));
      }
      if (path.startsWith('/api/')) return json(res, { error: 'not found' }, 404);
      return staticFile(res, path);
    } catch (e) {
      return json(res, { error: String(e) }, 500);
    }
  });

  server.on('error', (e: NodeJS.ErrnoException) => {
    console.error(`[pulse] API: ${e.message}`);
    process.exit(1);
  });

  server.listen(CONFIG.port, () => {
    console.log(`[pulse] дашборд: http://127.0.0.1:${CONFIG.port}`);
  });
}

/** Инвалидация кэша в конце волны */
export function invalidateApiCache(): void {
  cache = null;
}

function clampDays(raw: string | null): number {
  const n = Number(raw ?? 7);
  if (!Number.isFinite(n)) return 7;
  return Math.min(Math.max(1, Math.floor(n)), 31);
}

function summary(courts: ReturnType<typeof loadRegionCourts>) {
  const state = loadState();
  // Читаем 7 дней один раз и выводим из них 24-часовые метрики (без двойного чтения)
  const probes7 = readProbes(7);
  const cutoff24h = Date.now() - 86_400_000;
  const probes24 = probes7.filter(p => p.ts >= cutoff24h);
  const rows = buildCourtRows(courts, state, probes24);

  const statusCounts: Record<string, number> = {};
  for (const r of rows) statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;

  const withData = rows.filter(r => r.probes24h > 0);
  const uptime24h = withData.length
    ? withData.reduce((a, r) => a + r.uptime24h, 0) / withData.length
    : 0;

  // Доступность за 7 дней (по пробам)
  const ok7 = probes7.filter(p => OK.has(p.status)).length;
  const total7 = probes7.length;

  // Последняя волна
  const lastWave = rows.reduce((m, r) => Math.max(m, r.lastTs), 0);

  // Медиана отклика за 24ч — только живые пробы (иначе TIMEOUT завышают)
  const ms = probes24.filter(p => p.status === 'OK' && p.totalMs > 0).map(p => p.totalMs).sort((a, b) => a - b);
  const medianMs = ms.length ? ms[Math.floor(ms.length / 2)] : 0;

  return {
    courtsTotal: rows.length,
    statusCounts,
    uptime24h,
    ok7: total7 ? ok7 / total7 : 0,
    probes7: total7,
    probes24h: probes24.length,
    bad24h: probes24.filter(p => BAD.has(p.status)).length,
    banned24h: probes24.filter(p => p.status === 'BANNED').length,
    lastWave,
    medianMs,
    now: Date.now(),
  };
}

function json(res: import('node:http').ServerResponse, data: unknown, code = 200): void {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  });
  res.end(JSON.stringify(data));
}

/** Раздача статики с защитой от path traversal (resolve + префикс с sep) */
function staticFile(res: import('node:http').ServerResponse, path: string): void {
  const rel = path === '/' ? '/index.html' : path;
  const pub = resolve('public');
  const file = resolve(join(pub, rel));
  if (file !== pub && !file.startsWith(pub + sep)) {
    res.writeHead(403); res.end();
    return;
  }
  try {
    const st = statSync(file);
    if (!st.isFile()) throw new Error('not file');
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
  }
}
