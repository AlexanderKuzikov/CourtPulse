// CourtPulse — мониторинг доступности сайтов судов ГАС «Правосудие»
import { Scheduler } from './scheduler.ts';
import { startApi } from './api.ts';

const once = process.argv.includes('--once');
// Поддерживаем обе формы: --limit=5 и --limit 5
const limitIdx = process.argv.indexOf('--limit');
const limitArg = limitIdx >= 0 ? process.argv[limitIdx + 1] : process.argv.find(a => a.startsWith('--limit='))?.slice('--limit='.length);
const limit = limitArg ? Number(limitArg) : 0;
const sched = new Scheduler();
sched.start(once, limit);

if (!once) {
  startApi(sched);
  console.log('[pulse] мониторинг запущен (регион 59, интервал 15 мин)');
}

