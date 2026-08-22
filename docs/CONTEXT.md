# CourtPulse — CONTEXT

> Последнее обновление: 2026-08-22

## Статус
| Компонент | Статус | Заметка |
|-----------|--------|---------|
| Ядро | ✅ обновлено | Таймауты 30/30/45с; проба `/modules.php?name=sud_delo` с валидацией тела (32КБ cap, `G1_PARTS__NAMESS`/`sud_delo` → OK, капча → BANNED, <500B → HTTP_ERR); bandetect BANNED-cooldown 45мин |
| Дашборд | ✅ проверен | /api/summary, /api/courts (183), /api/history?limit + rate-limit 60/мин/20k cap — 200 |
| Данные | ✅ | Ротация 30д на каждой волне, пустой ответ отсекается |
| Запуск | ⏸️ пауза до ручного старта | WAF-бан детект: `concurrency 4→2`, `interval 12→15мин`, `gap 2→3с`, `courtpulse.service` остановлен `06:40`, автозапуск отменён — старт вручную `sudo systemctl start courtpulse` после проверки разбана |
| Клиент | ✅ | Go+WebView `client/CourtPulseClient.exe` (2.3 МБ, `rsrc` иконка, `icon_windows.go`/`icon_other.go`) |
| Репо | ✅ | https://github.com/AlexanderKuzikov/CourtPulse (main) |

## Open-проблемы
| # | Priority | Описание |
|---|----------|----------|
| 1 | med | **BANNED-семантика не решена**: сейчас BANNED считается неудачей (ложные инциденты + заниженный uptime). Qwen рекомендует: для uptime «жив», для инцидентов — предохранитель 6 BANNED подряд. Ждёт решения пользователя |
| 2 | - | **Concurrency 2+cooldown** — откат 4→2 (волна ~39мин, WAF банил агрегат), wall-clock 12→15мин, gap 3с, BANNED-cooldown 45мин |
| 3 | low | Тесты из ревью Qwen (12 шт, node:test) не написаны — в qwen38-review-result.md |

## Журнал работ
| Дата | Изменение |
|------|-----------|
| 2026-08-12 | Идея: статистика доступности судов (после WAF-банов в CourtDesk). Написано ядро + дашборд + документация |
| 2026-08-12 | Отладка: добавлен `--limit N`; найден баг `req.end()` в probe.ts — пробы всегда TIMEOUT, волна «висела» 45 мин. Фикс: проба ~300мс, полная волна 181/181 OK за 222с. Мониторинг запущен в фоне |
| 2026-08-12 | **Ревью Qwen 3.8 Max применено** (qwen38-review-result.md): #1 try/finally + .catch в once (running не залипает); #2 streak-счётчик инцидентов (порог 3 честно); #3 абсолютный HTTP-дедлайн + destroy (нет утечки сокетов) + классификация ошибок (ECONNRESET≠TIMEOUT); С1 таймауты dns 10→5с, http 30→20с; С3 agent:false; С4 атомарная запись tmp+rename; С5 кэш API TTL 45с + инвалидация по волне; С7 path traversal через resolve+sep; С8 Fisher-Yates; Н1-Н13 (MIME, days clamp, medianMs только OK, --limit обе формы, getIncidents(), server.on('error'), понятная ошибка без courts.json, AGENTS.md .ts). Проверено: --once --limit=3 2× — 3/3 OK ~30с, state.json сохраняется по ходу |
| 2026-08-13 | Дашборд+ядро (вторая серия): `th` всегда по центру, uptime-полоска nowrap, uPlot оси в секундах, сортировка судов по типам и кодам, клиентская сортировка таблиц, фиксы модалок и KPI |
| 2026-08-21 | **Архитектура клиент-сервер & таймауты**: интервал изменен на 12 мин; таймауты подняты до 30с (connect/tls) и 45с (http); проба перенесена с главной `/` на реальный бэкенд поиска `/modules.php?name=sud_delo`; добавлена очистка логов старше 30 дней в `storage.ts`; в API добавлены CORS заголовки для внешних/локальных клиентов |
| 2026-08-21 | **Выделенный поддомен**: `courtpulse.135.106.192.125.nip.io → :8781` (Caddy reverse_proxy), клиент `client/main.go` (Go+WebView, `-H windowsgui`, иконка `icon.ico`→`rsrc`→`WM_SETICON`) |
| 2026-08-22 | **Code Review — исправления**: `probe.ts` — убран двойной `withTimeout` (утечка FD), сбор тела 32КБ+валидация (`G1_PARTS`/`sud_delo`→OK, капча→BANNED); `scheduler.ts` — `setInterval`→wall-clock `setTimeout` (12мин старт→старт), ротация на каждой волне; `api.ts` — rate-limit 60/мин+20k cap; `client` — build-теги `icon_windows.go`/`other.go`, убран `Bind` |
| 2026-08-22 | **WAF-бан — детект и откат**: `concurrency 4` дал эскалацию `BANNED 34→49→71→81, 0 OK` (300 проб `BANNED 128 42%`). Откат `concurrency 4→2`, `interval 12→15мин`, `gap 3с`, добавлен `bannedUntil 45мин` (синтетический `BANNED 429` без сети), стоп `courtpulse.service` 06:40. Автозапуск отменён по просьбе — ручной старт после проверки `curl -I` вечером. Деплой `src/*` на `sat` |

## Структура
```
см. AGENTS.md
```
```
