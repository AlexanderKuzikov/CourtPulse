// HTTP API + раздача статики (без зависимостей, node:http)
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { CONFIG } from './config.ts';
import { loadState, readProbes, buildCourtRows } from './storage.ts';
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
};

const OK = new Set(['OK']);
const BAD = new Set(['DNS_FAIL', 'CONNECT_FAIL', 'TLS_FAIL', 'TIMEOUT', 'HTTP_ERR']);

export function startApi(sched: Scheduler): void {
  const courts = loadRegionCourts();

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const path = url.pathname;

    try {
      if (path === '/api/summary') return json(res, summary(courts));
      if (path === '/api/courts') return json(res, buildCourtRows(courts, loadState(), readProbes(1)));
      if (path === '/api/history') {
        const code = url.searchParams.get('code') ?? '';
        const days = Number(url.searchParams.get('days') ?? 7);
        return json(res, readProbes(days, code));
      }
      if (path === '/api/incidents') {
        const days = Number(url.searchParams.get('days') ?? 14);
        return json(res, sched['incidents'].filter(i => i.endTs === null || Date.now() - i.endTs < days * 86_400_000));
      }
      if (path.startsWith('/api/')) return json(res, { error: 'not found' }, 404);
      return staticFile(req, res, path);
    } catch (e) {
      return json(res, { error: String(e) }, 500);
    }
  });

  server.listen(CONFIG.port, () => {
    console.log(`[pulse] дашборд: http://127.0.0.1:${CONFIG.port}`);
  });
}

function summary(courts: ReturnType<typeof loadRegionCourts>) {
  const state = loadState();
  const probes = readProbes(1);
  const rows = buildCourtRows(courts, state, probes);

  const statusCounts: Record<string, number> = {};
  for (const r of rows) statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;

  const withData = rows.filter(r => r.probes24h > 0);
  const uptime24h = withData.length
    ? withData.reduce((a, r) => a + r.uptime24h, 0) / withData.length
    : 0;

  // Доступность за 7 дней (по пробам)
  const probes7 = readProbes(7);
  const ok7 = probes7.filter(p => OK.has(p.status)).length;
  const total7 = probes7.length;

  // Последняя волна
  const lastWave = rows.reduce((m, r) => Math.max(m, r.lastTs), 0);

  // Медиана отклика за 24ч
  const ms = probes.filter(p => p.totalMs > 0).map(p => p.totalMs).sort((a, b) => a - b);
  const medianMs = ms.length ? ms[Math.floor(ms.length / 2)] : 0;

  return {
    courtsTotal: rows.length,
    statusCounts,
    uptime24h,
    ok7: total7 ? ok7 / total7 : 0,
    probes7: total7,
    probes24h: probes.length,
    bad24h: probes.filter(p => BAD.has(p.status)).length,
    banned24h: probes.filter(p => p.status === 'BANNED').length,
    lastWave,
    medianMs,
    now: Date.now(),
  };
}

function json(res: import('node:http').ServerResponse, data: unknown, code = 200): void {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function staticFile(req: import('node:http').ServerResponse extends never ? never : import('node:http').ServerResponse, res: import('node:http').ServerResponse, path: string): void {
  void req;
  let rel = path === '/' ? '/index.html' : path;
  // защита от path traversal
  const file = join('public', rel);
  if (!file.startsWith(join('public'))) {
    res.writeHead(403); res.end();
    return;
  }
  try {
    const st = statSync(file);
    if (!st.isFile()) throw new Error('not file');
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
  }
}

