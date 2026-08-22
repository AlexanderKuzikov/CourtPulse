// Хранилище: JSONL-пробы по дням, снапшот последних статусов, инциденты
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
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

/** Атомарная запись JSON: tmp + rename — крэш посреди записи не портит файл */
function writeJsonAtomic(file: string, data: unknown): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data), 'utf-8');
  renameSync(tmp, file);
}

export function ensureDirs(): void {
  mkdirSync(probesDir(), { recursive: true });
  cleanupOldProbes(30);
}

export function cleanupOldProbes(maxDays = 30): void {
  try {
    const cutoff = Date.now() - maxDays * 86_400_000;
    for (const f of readdirSync(probesDir())) {
      if (!f.endsWith('.jsonl')) continue;
      const day = f.slice(0, 10);
      const fileTime = new Date(day + 'T00:00:00Z').getTime();
      if (fileTime < cutoff) {
        unlinkSync(join(probesDir(), f));
      }
    }
  } catch { /* ignore */ }
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
  writeJsonAtomic(statePath(), s);
}

// ─── Инциденты ───
export function loadIncidents(): Incident[] {
  try { return JSON.parse(readFileSync(incidentsPath(), 'utf-8')) as Incident[]; }
  catch { return []; }
}

export function saveIncidents(inc: Incident[]): void {
  writeJsonAtomic(incidentsPath(), inc);
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

