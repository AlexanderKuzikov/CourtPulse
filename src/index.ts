// CourtPulse — мониторинг доступности сайтов судов ГАС «Правосудие»
import { Scheduler } from './scheduler.ts';
import { startApi } from './api.ts';

const once = process.argv.includes('--once');
const sched = new Scheduler();
sched.start(once);

if (!once) {
  startApi(sched);
  console.log('[pulse] мониторинг запущен (регион 59, интервал 15 мин)');
}

