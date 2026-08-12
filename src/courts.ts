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

