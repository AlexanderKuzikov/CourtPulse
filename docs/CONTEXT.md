# CourtPulse — CONTEXT

> Последнее обновление: 2026-08-22

## Статус
| Компонент | Статус | Заметка |
|-----------|--------|---------|
| Ядро | ✅ обновлено | Таймауты 30/30/45с; проба `→/modules.php?name=sud_delo` (`arbitr→/`) с 301-follow `*.perm.sudrf.ru→*--perm` (dzerjin/oblsud), валидация 32КБ cap (`G1_PARTS`/`sud_delo`→OK, капча `msudrf→OK`/иначе `BANNED`, <500B→HTTP_ERR); cooldown 45мин |
| Дашборд | ✅ адаптив | Y-ось `c e j b o [`→`0-100%`, `chart7.setData`/мин, мобильный `375px` компакт: `KPI` `6×4/5×4`, `Суд+Статус` только (без скролла, `Отклик` скрыт), `183/183 OK` после wipe |
| Данные | ✅ обнулены | Чистый старт 15:56 UTC — бэкап `/tmp/courtpulse_backup_20260822.tar.gz` (876К), `rm probes/*.jsonl state/incidents` на `sat`+локально, `UNKNOWN 183` до первой волны |
| Запуск | ✅ запущен | `courtpulse.service` `active` 15:56 UTC (рестарт после wipe), `interval 15мин/2/3с`, `cooldown 45мин` |
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
| 2026-08-22 | **WAF-бан — детект и откат**: `concurrency 4` дал эскалацию `BANNED 34→49→71→81, 0 OK` (300 проб `BANNED 128 42%`). Откат `concurrency 4→2`, `interval 12→15мин`, `gap 3с`, добавлен `bannedUntil 45мин`, стоп 06:40 — ручной старт после `curl -I` вечером |
| 2026-08-22 | **Районные/краевой/арбитраж и график**: `probe.ts` `301 dzerjin.perm→dzerjin--perm` (все `*.perm.sudrf.ru`), `arbitr.ru→/` (404→200), `httpGetFollow` 3 редиректа; `public/app.js` фикс Y-оси `[object Object]%`→`c e j b o [` путем `(u,vals)=>vals.map`, `renderChart7` теперь `setData` каждую минуту (было разово). Деплой `sat` — `155 OK` 20:48, Playwright скрин |
| 2026-08-22 | **Чистый старт**: замусоренные данные 12-22.08 (`TIMEOUT` баг, 301, arbitr, `concurrency 4` бан) обнулены — `stop → tar czf /tmp/courtpulse_backup_20260822.tar.gz (876К) → rm probes/*.jsonl state/incidents` на `sat`+локально, `restart 15:56 UTC` (`UNKNOWN 183` → первая волна ~16:05, `183 OK` 21:19) |
| 2026-08-22 | **Мобильный адаптив — компакт**: `public/style.css` `1200→4col, 768→4col/6px, 560→2col`, `KPI` `padding 10×16→6×4, gap 12→6, font 12→9/15px, min-height 2.8→2.2em`, `Суды` `Суд+Статус` только (скрыты `Тип/Uptime/Пробы/Падения/Отклик/Последняя`, `width 68/32%`, `table-layout:fixed` без скролла). Playwright `375×812`/`1280` скрины |

## Структура
```
см. AGENTS.md
```
```
