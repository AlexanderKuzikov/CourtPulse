// Загрузка справочника судов и выборка региона
import { readFileSync, existsSync } from 'node:fs';
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
  MS: 'Мировой', RS: 'Районный', OS: 'Краевой', AS: 'Арбитражный',
  VS: 'Верховный', KAS: 'Кассационный', GV: 'Гарнизонный', OV: 'Окружной',
  KV: 'Военный', AV: 'Апелляционный', KJ: 'Кассационный', AJ: 'Апелляционный',
  AA: 'Апелляционный', AO: 'Апелляционный', UD: 'Прочее',
};

// Порядок отображения: краевой, арбитражный, районные, участки
const TYPE_PRIORITY: Record<string, number> = {
  'Краевой': 0, 'Арбитражный': 1, 'Районный': 2, 'Мировой': 3,
};

/** Извлечь host из website: http://1.perm.msudrf.ru → 1.perm.msudrf.ru */
function hostFromWebsite(website: string): string {
  try { return new URL(website).hostname; } catch { return ''; }
}

export function loadRegionCourts(): CourtTarget[] {
  const path = `${CONFIG.dataDir}/courts.json`;
  if (!existsSync(path)) {
    throw new Error(`нет ${path} — положи справочник судов (копия из CourtDesk: packages/core/data/courts.json)`);
  }
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as { courts: RawCourt[] };
  const seen = new Set<string>();
  const out: CourtTarget[] = [];

  for (const c of raw.courts) {
    if (!c.code.startsWith(CONFIG.region)) continue;
    const host = hostFromWebsite(c.website);
    if (!host || !/\.(sudrf|msudrf|arbitr)\.ru$/.test(host)) continue;
    if (seen.has(host)) continue;   // дубли поддоменов
    seen.add(host);
    const courtType = COURT_TYPE_LABEL[c.court_type] ?? c.court_type;
    let name = c.name.replace(/^Судебный участок №/, 'Участок №');
    // У мировых и районных «Пермского края» в конце — мусор (арбитражный/областной — оставить)
    if (courtType === 'Мировой' || courtType === 'Районный') {
      name = name.replace(/\s+Пермского края$/, '');
    }
    out.push({ code: c.code, name, courtType, host, base: host.replace(/^[^.]+\./, '') });
  }

  out.sort((a, b) => (TYPE_PRIORITY[a.courtType] ?? 9) - (TYPE_PRIORITY[b.courtType] ?? 9) || a.code.localeCompare(b.code));
  return out;
}

