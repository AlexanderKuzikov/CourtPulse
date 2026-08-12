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

