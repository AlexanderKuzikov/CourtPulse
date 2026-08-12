// Оркестратор: волны проб каждые 15 минут + детект инцидентов
import { CONFIG } from './config.ts';
import { loadRegionCourts, type CourtTarget } from './courts.ts';
import { probeCourt, type ProbeResult } from './probe.ts';
import {
  appendProbe, ensureDirs, loadIncidents, loadState, saveIncidents, saveState,
  type Incident,
} from './storage.ts';
import { invalidateApiCache } from './api.ts';

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
      void this.runWave(!once).then(s => {
        console.log(`[pulse] done: ${JSON.stringify(s)}`);
        this.saveAll();
        process.exit(0);
      }).catch(e => {
        console.error('[pulse] волна упала:', e);
        this.saveAll();
        process.exit(1);
      });
      return;
    }

    void this.runWave(false);
    setInterval(() => void this.runWave(false), CONFIG.probeIntervalMs);
  }

  private async runWave(skipJitter = false): Promise<RunStats> {
    if (this.running) {
      console.warn('[pulse] волна пропущена: предыдущая ещё идёт');
      return { ok: 0, bad: 0, banned: 0, total: 0, ms: 0 };
    }
    this.running = true;
    try {
      const t0 = Date.now();
      const stats: RunStats = { ok: 0, bad: 0, banned: 0, total: 0, ms: 0 };

      // jitter, чтобы волны не шли ровно в один момент (не в --once)
      if (!skipJitter) await sleep(Math.random() * CONFIG.jitterMaxMs);

      const queue = shuffle([...this.courts]);
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
          saveState(this.state);
          this.onProbe?.(probe, court);
          this.updateIncidents(court, probe);
          await sleep(CONFIG.gapMinMs);
        }
      };

      const workers = Array.from({ length: CONFIG.concurrency }, () => worker());
      await Promise.all(workers);

      stats.ms = Date.now() - t0;
      this.saveAll();
      invalidateApiCache();
      console.log(`[pulse] волна: ${stats.total} судов, ok=${stats.ok}, banned=${stats.banned}, bad=${stats.bad}, ${stats.ms}мс`);
      return stats;
    } finally {
      this.running = false;
    }
  }

  /** Streak-счётчик: инцидент создаётся только после ≥ threshold неудач подряд */
  private streak = new Map<string, { count: number; first: ProbeResult }>();

  private updateIncidents(court: CourtTarget, probe: ProbeResult): void {
    const open = this.incidents.find(i => i.code === court.code && i.endTs === null);

    if (probe.status === 'OK') {
      this.streak.delete(court.code);
      if (open) { open.endTs = probe.ts; saveIncidents(this.incidents); }
      return;
    }

    const s = this.streak.get(court.code);
    const count = (s?.count ?? 0) + 1;
    this.streak.set(court.code, { count, first: s?.first ?? probe });

    if (open) { open.probes = count; return; }

    if (count >= CONFIG.incidentsThreshold) {
      const first = s?.first ?? probe;
      this.incidents.push({
        code: court.code, host: court.host, name: court.name,
        startTs: first.ts, endTs: null, reason: first.status, probes: count,
      });
      saveIncidents(this.incidents);
      console.log(`[pulse] ИНЦИДЕНТ: ${court.name} (${court.host}) — ${first.status}, ${count} проб`);
    }
  }

  private saveAll(): void {
    saveState(this.state);
    saveIncidents(this.incidents.filter(i => i.endTs === null || Date.now() - i.endTs < 30 * 86_400_000));
  }

  getIncidents(): Incident[] {
    return this.incidents;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Fisher–Yates (без смещения Math.random-сортировки) */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

