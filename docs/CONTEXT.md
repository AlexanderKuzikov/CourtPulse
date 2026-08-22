# CourtPulse — CONTEXT

> Последнее обновление: 2026-08-22

## Статус
| Компонент | Статус | Заметка |
|-----------|--------|---------|
| Ядро | ✅ обновлено | Таймауты увеличены (connect/tls 30с, http 45с); интервал 12 мин; проба переведена на модуль поиска `/modules.php?name=sud_delo`; добавлена автоматическая ротация `.jsonl` логов за 30 дней; CORS в API для архитектуры клиент-сервер |
| Дашборд | ✅ проверен | /api/summary, /api/courts (183), /api/history, статика uPlot — 200 |
| Данные | ✅ | Валидация тела поиска (G1_PARTS__NAMESS/sud_delo), cap 32КБ, капча → BANNED |
| Запуск | ✅ | Деплой на `sat` (`courtpulse.135.106.192.125.nip.io` → 8781, `courtpulse.service`) — интервал 12 мин, дрейф-фикс `setTimeout`, ротация 30д на каждой волне |
| Клиент | ✅ | Go+WebView `client/CourtPulseClient.exe` (2.3 МБ, `rsrc` иконка, build-теги `icon_windows/other.go`) |
| Репо | ✅ | https://github.com/AlexanderKuzikov/CourtPulse (main) |

## Open-проблемы
| # | Priority | Описание |
|---|----------|----------|
| 1 | med | **BANNED-семантика не решена**: сейчас BANNED считается неудачей (ложные инциденты + заниженный uptime). Qwen рекомендует: для uptime «жив», для инцидентов — предохранитель 6 BANNED подряд. Ждёт решения пользователя |
| 2 | - | **Concurrency 4** — применено (волна 39мин → ~6мин, пер-хост 1 req/12мин) |
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
| 2026-08-22 | **Code Review — исправления**: `probe.ts` — убран двойной `withTimeout` (утечка FD), добавлен сбор тела 32КБ+валидация маркеров поиска/капчи (200 без формы → HTTP_ERR, captcha → BANNED); `scheduler.ts` — `setInterval`→рекурсивный `setTimeout` (нет дрейфа/наложения волн), ротация на каждой волне; `api.ts` — rate-limit 60/мин на `/api/history`, потолок 20k строк + `?limit=`; `storage.ts` — удалён неиспользуемый импорт; `client` — build-теги `icon_windows.go/other.go`, убран мёртвый `Bind`; `docs/CONTEXT` — дубль `см. AGENTS.md`. Деплой на `sat` + проверка `curl /api/summary` |

## Структура
```
см. AGENTS.md
```
```
