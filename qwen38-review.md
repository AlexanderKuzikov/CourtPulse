Ты работаешь в одиночном режиме глубокого анализа.
НЕ используй никакие инструменты, не звони функциям, не обращайся к сети.
Верни ОДИН финальный ответ. Требуемая глубина: 6 (1 — бегло, 10 — экстремально).

── КОНТЕКСТ ──
CourtPulse — мониторинг доступности сайтов судов ГАС «Правосудие» (Пермский край, регион 59). Node ≥22.6, TypeScript нативно (`--experimental-strip-types`), НОЛЬ зависимостей. Проба каждого суда: DNS → TCP(443) → TLS (rejectUnauthorized:false — кривые сертификаты ГАС) → HTTP GET `/` (капчи на главной нет). Волны проб каждые 15 мин, concurrency 2, jitter ≤30с, gap 2с. 181 суд (146 мировых + 34 районных + областной + арбитражный). Статусы: OK / BANNED (403/429) / HTTP_ERR / DNS_FAIL / CONNECT_FAIL / TLS_FAIL / TIMEOUT. Хранилище: data/probes/YYYY-MM-DD.jsonl (проба-строка), state.json (последние статусы), incidents.json (≥3 неудач подряд = инцидент). API node:http (:8781) + статика. Дашборд vanilla JS + uPlot (public/, в ревью не входит — только src/).

── ИСТОРИЯ ──
v0.1 (2026-08-12) написан «вслепую», первая волна --once зависла: HTTP-запрос не отправлялся (в httpGet не вызывался req.end() → запрос висел до таймаута; 22 из 55 первых проб — TIMEOUT, медиана OK 430мс). Уже исправлено в коммите 8a0ee2c: добавлен req.end(), флаг --limit N для отладки, правки index/scheduler. Код ниже — ПОСЛЕ фикса, но ещё ни разу не прогонялся полной волной. Твоя задача — найти ВСЁ остальное, включая ошибки, которые фикс не покрыл.

── КОД (весь src, актуальный) ──

=== api.ts (4.2 KB) ===
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


=== config.ts (1 KB) ===
// Конфигурация CourtPulse
export const CONFIG = {
  region: '59',            // Пермский край (первые 2 символа кода суда)
  probeIntervalMs: 15 * 60 * 1000, // проверка каждого суда раз в 15 минут
  concurrency: 2,          // параллельных проб (WAF ГАС банит за rate-limit!)
  jitterMaxMs: 30_000,     // случайная задержка перед волной
  gapMinMs: 2_000,         // минимум между стартами проб
  port: 8781,
  dataDir: 'data',
  incidentsThreshold: 3,   // N подряд неудач = инцидент
  // Таймауты этапов пробы (WAF тормозит до 1-2 минут — но главная отвечает быстрее)
  dnsTimeoutMs: 10_000,
  connectTimeoutMs: 15_000,
  tlsTimeoutMs: 15_000,
  httpTimeoutMs: 30_000,
  userAgent: 'CourtPulse/0.1 (+https://github.com/AlexanderKuzikov/CourtPulse)',
} as const;

=== courts.ts (2 KB) ===
// Загрузка справочника судов и выборка региона
import { readFileSync } from 'node:fs';
import { CONFIG } from './config.ts';

export type CourtTarget = {
  code: string;
  name: string;
  courtType: string;
  host: string;        // полный host, напр. "1.perm.msudrf.ru"
  base: string;        // "perm.msudrf.ru" — для логики/группировки
};

type RawCourt = {
  code: string;
  name: string;
  court_type: string;
  website: string;
};

const COURT_TYPE_LABEL: Record<string, string> = {
  MS: 'Мировой', RS: 'Районный', OS: 'Областной', AS: 'Арбитражный',
  VS: 'Верховный', KAS: 'Кассационный', GV: 'Гарнизонный', OV: 'Окружной',
  KV: 'Военный', AV: 'Апелляционный', KJ: 'Кассационный', AJ: 'Апелляционный',
  AA: 'Апелляционный', AO: 'Апелляционный', UD: 'Прочее',
};

/** Извлечь host из website: http://1.perm.msudrf.ru → 1.perm.msudrf.ru */
function hostFromWebsite(website: string): string {
  try { return new URL(website).hostname; } catch { return ''; }
}

export function loadRegionCourts(): CourtTarget[] {
  const raw = JSON.parse(readFileSync(`${CONFIG.dataDir}/courts.json`, 'utf-8')) as { courts: RawCourt[] };
  const seen = new Set<string>();
  const out: CourtTarget[] = [];

  for (const c of raw.courts) {
    if (!c.code.startsWith(CONFIG.region)) continue;
    const host = hostFromWebsite(c.website);
    if (!host || !/\.(sudrf|msudrf)\.ru$/.test(host)) continue;
    if (seen.has(host)) continue;   // дубли поддоменов
    seen.add(host);
    out.push({
      code: c.code,
      name: c.name.replace(/^Судебный участок №/, 'Участок №'),
      courtType: COURT_TYPE_LABEL[c.court_type] ?? c.court_type,
      host,
      base: host.replace(/^[^.]+\./, ''),
    });
  }

  out.sort((a, b) => a.code.localeCompare(b.code));
  return out;
}


=== index.ts (0.6 KB) ===
// CourtPulse — мониторинг доступности сайтов судов ГАС «Правосудие»
import { Scheduler } from './scheduler.ts';
import { startApi } from './api.ts';

const once = process.argv.includes('--once');
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : 0;
const sched = new Scheduler();
sched.start(once, limit);

if (!once) {
  startApi(sched);
  console.log('[pulse] мониторинг запущен (регион 59, интервал 15 мин)');
}


=== probe.ts (4.5 KB) ===
// Проба доступности: DNS → TCP → TLS → HTTP GET главной страницы
import { lookup } from 'node:dns/promises';
import { connect as tlsConnect } from 'node:tls';
import { connect as netConnect, type Socket } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { CONFIG } from './config.ts';

export type ProbeStatus =
  | 'OK' | 'BANNED' | 'HTTP_ERR'
  | 'DNS_FAIL' | 'CONNECT_FAIL' | 'TLS_FAIL' | 'TIMEOUT';

export type ProbeResult = {
  ts: number;
  code: string;
  host: string;
  status: ProbeStatus;
  httpCode: number | null;
  dnsMs: number | null;
  connectMs: number | null;
  tlsMs: number | null;
  totalMs: number;
  bytes: number | null;
};

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); })
     .catch(e => { clearTimeout(t); reject(e); });
  });
}

function tcpConnect(host: string, port: number, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = netConnect({ host, port });
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('connect timeout')); }, timeoutMs);
    sock.once('connect', () => { clearTimeout(timer); resolve(sock); });
    sock.once('error', e => { clearTimeout(timer); reject(e); });
  });
}

function tlsHandshake(sock: Socket, host: string, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const tlsSock = tlsConnect({ socket: sock, servername: host, rejectUnauthorized: false });
    const timer = setTimeout(() => { tlsSock.destroy(); reject(new Error('tls timeout')); }, timeoutMs);
    tlsSock.once('secureConnect', () => { clearTimeout(timer); resolve(tlsSock); });
    tlsSock.once('error', e => { clearTimeout(timer); reject(e); });
  });
}

function httpGet(host: string, port: number, timeoutMs: number, tls: boolean): Promise<{ code: number; bytes: number }> {
  const fn = tls ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = fn({
      host, port, path: '/', method: 'GET',
      headers: {
        'User-Agent': CONFIG.userAgent,
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'ru,en;q=0.8',
      },
      rejectUnauthorized: false,
    }, res => {
      let bytes = 0;
      res.on('data', c => { bytes += c.length; });
      res.on('end', () => resolve({ code: res.statusCode ?? 0, bytes }));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('http timeout')));
    req.on('error', reject);
    req.end();
  });
}

export async function probeCourt(code: string, host: string): Promise<ProbeResult> {
  const start = Date.now();
  const base: Omit<ProbeResult, 'status' | 'totalMs'> = {
    ts: start, code, host,
    httpCode: null, dnsMs: null, connectMs: null, tlsMs: null, bytes: null,
  };

  // 1. DNS
  try {
    const dnsStart = Date.now();
    const addr = await withTimeout(lookup(host), CONFIG.dnsTimeoutMs, 'dns');
    base.dnsMs = Date.now() - dnsStart;
    void addr;
  } catch {
    return { ...base, status: 'DNS_FAIL', totalMs: Date.now() - start };
  }

  // 2. TCP
  let sock: Socket;
  try {
    const cStart = Date.now();
    sock = await withTimeout(tcpConnect(host, 443, CONFIG.connectTimeoutMs), CONFIG.connectTimeoutMs + 500, 'tcp');
    base.connectMs = Date.now() - cStart;
  } catch {
    return { ...base, status: 'CONNECT_FAIL', totalMs: Date.now() - start };
  }

  // 3. TLS (кривые сертификаты ГАС — rejectUnauthorized:false)
  try {
    const tStart = Date.now();
    const tlsSock = await withTimeout(tlsHandshake(sock, host, CONFIG.tlsTimeoutMs), CONFIG.tlsTimeoutMs + 500, 'tls');
    base.tlsMs = Date.now() - tStart;
    tlsSock.destroy();
  } catch {
    sock.destroy();
    return { ...base, status: 'TLS_FAIL', totalMs: Date.now() - start };
  }

  // 4. HTTP GET /
  try {
    const h = await withTimeout(httpGet(host, 443, CONFIG.httpTimeoutMs, true), CONFIG.httpTimeoutMs + 500, 'http');
    base.httpCode = h.code;
    base.bytes = h.bytes;
    const status: ProbeStatus =
      h.code === 403 || h.code === 429 ? 'BANNED'
      : h.code >= 200 && h.code < 400 ? 'OK'
      : 'HTTP_ERR';
    return { ...base, status, totalMs: Date.now() - start };
  } catch {
    return { ...base, status: 'TIMEOUT', totalMs: Date.now() - start };
  }
}


=== scheduler.ts (3.9 KB) ===
// Оркестратор: волны проб каждые 15 минут + детект инцидентов
import { CONFIG } from './config.ts';
import { loadRegionCourts, type CourtTarget } from './courts.ts';
import { probeCourt, type ProbeResult } from './probe.ts';
import {
  appendProbe, ensureDirs, loadIncidents, loadState, saveIncidents, saveState,
  type Incident,
} from './storage.ts';

type RunStats = { ok: number; bad: number; banned: number; total: number; ms: number };

export class Scheduler {
  courts: CourtTarget[] = [];
  private state = loadState();
  private incidents = loadIncidents();
  private running = false;
  onProbe?: (p: ProbeResult, court: CourtTarget) => void;

  start(once = false, limit = 0): void {
    ensureDirs();
    this.courts = loadRegionCourts();
    if (limit > 0) this.courts = this.courts.slice(0, limit);
    console.log(`[pulse] регион ${CONFIG.region}: ${this.courts.length} судов, интервал ${CONFIG.probeIntervalMs / 60000} мин`);

    if (once) {
      void this.runWave().then(s => {
        console.log(`[pulse] done: ${JSON.stringify(s)}`);
        this.saveAll();
        process.exit(0);
      });
      return;
    }

    void this.runWave();
    setInterval(() => void this.runWave(), CONFIG.probeIntervalMs);
  }

  private async runWave(): Promise<RunStats> {
    if (this.running) return { ok: 0, bad: 0, banned: 0, total: 0, ms: 0 };
    this.running = true;
    const t0 = Date.now();
    const stats: RunStats = { ok: 0, bad: 0, banned: 0, total: 0, ms: 0 };

    // jitter, чтобы волны не шли ровно в один момент
    await sleep(Math.random() * CONFIG.jitterMaxMs);

    const queue = [...this.courts].sort(() => Math.random() - 0.5);
    let idx = 0;

    const worker = async (): Promise<void> => {
      while (idx < queue.length) {
        const court = queue[idx++];
        if (!court) continue;
        const probe = await probeCourt(court.code, court.host);
        stats.total++;
        if (probe.status === 'OK') stats.ok++;
        else if (probe.status === 'BANNED') stats.banned++;
        else stats.bad++;

        appendProbe(probe);
        this.state[court.code] = {
          status: probe.status, ts: probe.ts,
          httpCode: probe.httpCode, totalMs: probe.totalMs,
        };
        this.onProbe?.(probe, court);
        this.updateIncidents(court, probe);
        await sleep(CONFIG.gapMinMs);
      }
    };

    const workers = Array.from({ length: CONFIG.concurrency }, () => worker());
    await Promise.all(workers);

    stats.ms = Date.now() - t0;
    this.saveAll();
    console.log(`[pulse] волна: ${stats.total} судов, ok=${stats.ok}, banned=${stats.banned}, bad=${stats.bad}, ${stats.ms}мс`);
    this.running = false;
    return stats;
  }

  /** Неудачные пробы подряд ≥ threshold → инцидент */
  private updateIncidents(court: CourtTarget, probe: ProbeResult): void {
    const ok = probe.status === 'OK';
    let inc = this.incidents.find(i => i.code === court.code && i.endTs === null);

    if (ok) {
      if (inc) {
        inc.endTs = probe.ts;
        saveIncidents(this.incidents);
      }
      return;
    }

    if (!inc) {
      // начинаем отсчёт с 1 (данная проба)
      this.incidents.push({
        code: court.code, host: court.host, name: court.name,
        startTs: probe.ts, endTs: null, reason: probe.status, probes: 1,
      });
      return;
    }
    inc.probes++;
    if (inc.probes >= CONFIG.incidentsThreshold) {
      console.log(`[pulse] ИНЦИДЕНТ: ${court.name} (${court.host}) — ${inc.reason}, ${inc.probes} проб`);
    }
  }

  private saveAll(): void {
    saveState(this.state);
    saveIncidents(this.incidents.filter(i => i.endTs === null || Date.now() - i.endTs < 30 * 86_400_000));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}


=== storage.ts (3.7 KB) ===
// Хранилище: JSONL-пробы по дням, снапшот последних статусов, инциденты
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG } from './config.ts';
import type { ProbeResult } from './probe.ts';
import type { CourtTarget } from './courts.ts';

export type Incident = {
  code: string;
  host: string;
  name: string;
  startTs: number;
  endTs: number | null;
  reason: string;          // первый статус-причина
  probes: number;          // сколько подряд неудач
};

const probesDir = () => join(CONFIG.dataDir, 'probes');
const statePath = () => join(CONFIG.dataDir, 'state.json');
const incidentsPath = () => join(CONFIG.dataDir, 'incidents.json');

export function ensureDirs(): void {
  mkdirSync(probesDir(), { recursive: true });
}

export function appendProbe(p: ProbeResult): void {
  const day = new Date(p.ts).toISOString().slice(0, 10);
  appendFileSync(join(probesDir(), `${day}.jsonl`), JSON.stringify(p) + '\n', 'utf-8');
}

// ─── Снапшот последних статусов (для быстрого /api/courts) ───
type State = Record<string, { status: string; ts: number; httpCode: number | null; totalMs: number }>;

export function loadState(): State {
  try { return JSON.parse(readFileSync(statePath(), 'utf-8')) as State; }
  catch { return {}; }
}

export function saveState(s: State): void {
  writeFileSync(statePath(), JSON.stringify(s), 'utf-8');
}

// ─── Инциденты ───
export function loadIncidents(): Incident[] {
  try { return JSON.parse(readFileSync(incidentsPath(), 'utf-8')) as Incident[]; }
  catch { return []; }
}

export function saveIncidents(inc: Incident[]): void {
  writeFileSync(incidentsPath(), JSON.stringify(inc), 'utf-8');
}

/** Прочитать пробы за N дней, опционально по одному суду */
export function readProbes(days: number, code?: string): ProbeResult[] {
  const out: ProbeResult[] = [];
  const cutoff = Date.now() - days * 86_400_000;
  for (const f of readdirSync(probesDir())) {
    if (!f.endsWith('.jsonl')) continue;
    const day = f.slice(0, 10);
    if (new Date(day + 'T00:00:00Z').getTime() < cutoff - 86_400_000) continue;
    const lines = readFileSync(join(probesDir(), f), 'utf-8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const p = JSON.parse(line) as ProbeResult;
        if (p.ts < cutoff) continue;
        if (code && p.code !== code) continue;
        out.push(p);
      } catch { /* битая строка — пропускаем */ }
    }
  }
  return out;
}

// ─── Текущий список судов с агрегатами ───
export type CourtRow = CourtTarget & {
  status: string;
  lastTs: number;
  httpCode: number | null;
  totalMs: number;
  uptime24h: number;       // доля OK за 24ч, 0..1
  probes24h: number;
  down24h: number;
};

export function buildCourtRows(courts: CourtTarget[], state: State, probes: ProbeResult[]): CourtRow[] {
  const byCode = new Map<string, ProbeResult[]>();
  for (const p of probes) {
    const arr = byCode.get(p.code) ?? [];
    arr.push(p);
    byCode.set(p.code, arr);
  }
  return courts.map(c => {
    const s = state[c.code];
    const ps = byCode.get(c.code) ?? [];
    const ok = ps.filter(p => p.status === 'OK').length;
    return {
      ...c,
      status: s?.status ?? 'UNKNOWN',
      lastTs: s?.ts ?? 0,
      httpCode: s?.httpCode ?? null,
      totalMs: s?.totalMs ?? 0,
      uptime24h: ps.length ? ok / ps.length : 0,
      probes24h: ps.length,
      down24h: ps.length - ok,
    };
  });
}



── ЗАДАЧА ──
Проведи полное ревью кода (весь src/ ниже): корректность, надёжность, производительность волны, обработка ошибок, граничные случаи, безопасность, соответствие цели (незаметный для WAF мониторинг). Особое внимание:
1. **Волна**: реальная длительность при 181 суде (concurrency 2, gap 2с, jitter ≤30с, таймауты до 30с) — оцени математически. Узкие места: лежащие суды съедают 30с×N на слоте — как не блокировать очередь (не должен ли concurrency учитывать занятые слоты?)? Нужен ли gap при сокетном пуле? Можно ли concurrency 3-4 без WAF-риска? Что делать с волной при рестарте процесса (потерянный прогресс — checkpoint/resume)?
2. **--limit**: проверь реализацию (index.ts, scheduler.ts) — работает ли честно, не ломает ли счётчики/состояние.
3. **probe.ts**: 
   - httpGet: req.end() теперь есть — но проверь: res без 'end' при обрыве (aborted), res.on('error') после resolve (двойной resolve — Promise уже resolved, безопасно?), отсутствие лимита размера тела (память при огромном ответе), отсутствие res.resume при больших ответах, redirects (301/302 → HTTP_ERR — следовать ли 1 раз?), сжатие (gzip не просим — норм), req.destroy при timeout (сокет убит?).
   - Таймауты: DNS 10с, TCP 15с, TLS 15с, HTTP 30с + обёртки withTimeout с +500мс — не двойные ли таймауты (tcpConnect уже сам таймаутит, withTimeout дублирует)? Сокеты/таймеры при каждом таймауте — утечки?
   - TLS: tlsHandshake берёт sock, при ошибке — sock.destroy() в catch — а успешный tlsSock: destroyed в try — норм? rejectUnauthorized:false — осознанно (ГАС). TLS-сертификат не проверяем — это ок для мониторинга?
   - Порядок фаз: totalMs = весь прогон; dnsMs/connectMs/tlsMs — по фазам; но HTTP-время не отделено (totalMs включает его) — ок?
4. **scheduler.ts**: 
   - Инциденты: updateIncidents — при BANNED это «неудача»? (BANNED = суд жив, но нас банит — в uptime он должен идти как bad?); при восстановлении между неудачами счётчик сбрасывается? (сейчас: ok → закрывает инцидент; но если 1-я проба неудача (probes=1), 2-я ok — инцидент закрыт с probes=1, порог 3 не достигается — так и задумано?); инцидент с endTs=null в loadIncidents после рестарта — ок?
   - running флаг: если worker бросил исключение (probeCourt кидает? — нет, всегда resolve), но при неожиданной ошибке в updateIncidents/appendProbe — Promise.all reject → running навсегда true → волны прекратятся. Нужен try/finally?
   - saveAll в конце волны: при падении процесса — потеря state (не инкрементально). Стоит ли сохранять state после каждой пробы (181 запись/волну — JSON 50КБ — дорого?) или после каждой пробы только в файл-черновик?
   - setInterval перекрытие: если волна дольше интервала (45 мин > 15 мин) — что происходит (running guard есть)? Накопление интервалов?
5. **storage.ts**: readProbes читает все дни подряд в память (месяц = 181 суд × 96/день × 30 = ~520K JSON-парсов — долго для /api/courts при каждом запросе?). Агрегация на каждый HTTP-запрос (нет кэша) — при автообновлении UI каждые 60с это терпимо? Смена дня: appendProbe пишет в файл текущего дня — файл создаётся append'ом (норм). Битые строки — пропускаются. buildCourtRows: деление на 0 при ps.length=0 — uptime24h=0 — норм? 
6. **api.ts**: path traversal: join('public', rel) с rel='../..' — join нормализует, но file.startsWith(join('public')) — для 'public2'? Проверь: join('public','../src/x') = 'src/x' — startsWith('public') = false → 403 — ок, но корректна ли проверка префикса (publicity)? Типы: странный дженерик в staticFile — поправь. readProbes(1) на /api/courts и readProbes(7) на /api/summary — два полных чтения на запрос — кэш? 
7. **config.ts**: значения — интервал 15 мин, concurrency 2 — сбалансированы? dns 10с мал для лежащих? 
8. **Главное**: что сломается в первый день (пустые data/, первый запуск без probes — читается ли пустой state.json — есть catch?), что сломается через месяц (размер файлов, incidents растёт — prune есть в saveAll: 30 дней), что при рестарте посреди волны.
9. **Тесты**: предложи 8-12 unit-тестов на node:test (без зависимостей): классификация статусов, инциденты (порог, восстановление), таймауты, path traversal, агрегация uptime, день смены.

── ФОРМАТ ОТВЕТА (строго) ──
1) КРИТИЧНЫЕ БАГИ — таблица: # | файл:строка | проблема | последствие | фикс (кодом)
2) СРЕДНИЕ/НИЗКИЕ — таблица по той же схеме
3) ВОЛНА: расчёт длительности, ускорение без WAF-риска, resume после рестарта
4) STATE/ИНЦИДЕНТЫ: фиксы сохранения и счётчиков
5) ПРОИЗВОДИТЕЛЬНОСТЬ API: кэширование, размеры
6) ТЕСТЫ: список (имя; что проверяет; ключевые кейсы)
РЕКОМЕНДАЦИЯ: <с чего начать, 1-2 строки>
ОТКРЫТЫЕ ВОПРОСЫ: <что уточнить>
Ничего, кроме этого формата.

── СОХРАНЕНИЕ РЕЗУЛЬТАТА (обязательный последний раздел ответа) ──
Заверши ответ разделом «СОХРАНЕНИЕ РЕЗУЛЬТАТА» в строгом формате:
1) ФАЙЛЫ — таблица: Имя файла (латиница, с расширением) | Куда положить (путь относительно корня проекта) | Что вставить (какой раздел ответа). Все файлы — UTF-8.
2) ОТЧЁТ — 3-5 строк: что сделано, главные решения, на что обратить внимание.
3) ПРОВЕРКА — конкретные шаги: как пользователь проверит результат.
