# CourtPulse — результат ревью Qwen 3.8 Max (2026-08-12, сессия по qwen38-review.md)

Полный текст ревью — в ответе сессии. Здесь — сводка для внедрения.

## Критичные баги
1. **scheduler.ts runWave**: нет try/finally — любой throw в воркере → `running=true` навсегда, мониторинг тихо умирает. В `--once` нет `.catch`.
2. **updateIncidents**: инцидент создаётся с первой неудачи (probes:1), порог 3 гейтит только console.log → история забита микро-инцидентами. Фикс: streak-счётчик, создание по порогу.
3. **probe.ts httpGet**: `req.setTimeout` — idle-таймаут (trickle-ответ не таймаутится, внешний withTimeout не уничтожает req → утечка сокетов); catch шага 4 мапит ЛЮБУЮ ошибку в TIMEOUT (причины врут). Фикс: абсолютный таймер + destroy, классификация по тексту ошибки.

## Средние (С1–С8)
С1 таймауты: http 30→20с, dns 10→5с (худшая проба 72→56с). С2 два коннекта на пробу — документировать. С3 keep-alive агента — `agent: false`. С4 неатомарные writeFileSync — tmp+rename. С5 нет кэша API (readProbes на каждый запрос, 300-700мс) — TTL-кэш 30-60с + инвалидация по волне. С6 BANNED считается неудачей — решить семантику. С7 path traversal: `file.startsWith(join('public'))` пропускает `public2` — фикс resolve+sep. С8 `sort(()=>Math.random()-.5)` — смещение — Fisher-Yates.

## Низкие (Н1–Н13)
Н1 мусорный тип staticFile. Н2 нет server.on('error'). Н3 MIME без woff2/map/txt + двойное чтение courts.json. Н4 sched['incidents'] — приватное поле. Н5 days=abc → NaN → дамп всей истории; clamp 1..31. Н6 medianMs считает TIMEOUT. Н7 --limit только в форме =N. Н8 jitter в --once. Н9 retention jsonl 90-180 дней. Н10 двойной DNS-резолв. Н11 нет лимита тела (2MB). Н12 нет data/courts.json → ENOENT. Н13 AGENTS.md пишет про .js импорты (должно .ts).

## Открытые вопросы (решения пользователя)
1. BANNED: неудача / нейтрален / «суд жив» для uptime? (Qwen рекомендует: uptime=жив, инциденты — отдельный предохранитель 6 BANNED подряд)
2. Concurrency 3-4 (пер-хост рейт не меняется, агрегейт ×1.5-2) — разрешить?
3. HTTP-таймаут 30→20с — главная >20с считается лежащей?
4. 3xx = OK подтвердить (уже так).
5. Retention .jsonl 90/180 дней — нужен сейчас?

## Волна (математика Qwen)
- Все живы: ~4 мин. Типично (~10% проблемных): ~6-7 мин. 30 судов лежат: ~21 мин (пропуск волн!). Все лежат: ~109 мин.
- Ускорение без WAF-риска: срез таймаутов (−22% на аварийной волне), абсолютный дедлайн, concurrency 3-4.

## Тесты (Qwen предлагает 12, node:test, ноль зависимостей)
classifyHttp, httpGet absolute timeout, httpGet bytes, incident threshold, incident recovery, streak reset, readProbes cutoff, buildCourtRows, staticFile traversal, loadState/loadIncidents resilience, appendProbe day rollover, loadRegionCourts.

## План внедрения (по ПРОВЕРКА Qwen)
1. Фиксы #1-3, С1, С4.
2. `npm run once -- --limit=5` — завершается, state.json обновился.
3. Полный прогон — 4-7 мин, 181 строка JSONL.
4. Инциденты: подменить host на несуществующий, 3 волны — инцидент только после 3-й.
5. Дашборд: curl summary/courts/incidents, статика, traversal-проверка.
6. Тесты: `node --test --experimental-strip-types test/`.
