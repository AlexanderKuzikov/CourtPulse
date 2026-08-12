# CourtPulse — Instructions for AI Agents

Мониторинг доступности сайтов судов ГАС «Правосудие» (Пермский край). Node ≥22.6, TypeScript нативно (`node --experimental-strip-types`), НОЛЬ зависимостей (runtime и dev).

## Commands

- **start:** `npm start` — мониторинг + дашборд http://127.0.0.1:8781
- **once:** `npm run once` — одна волна проб и выход (диагностика)
- **dev:** `npm run dev` — watch-режим

## Conventions

- Runtime: Node ≥22.6, TS через type-stripping (без tsx, без сборки!)
- ESM: `"type": "module"`, импорты с `.js` расширением
- НОЛЬ зависимостей — не добавлять npm-пакеты без явной просьбы
- Стиль: без `any`, без `console.log` кроме логирования волн (допустимо)
- Коммиты в main напрямую, повелительное наклонение, ≤72 символа
- Коммитит только пользователь

## Structure

```
CourtPulse/
├── src/
│   ├── config.ts     # регион 59, интервал 15 мин, таймауты
│   ├── courts.ts     # фильтр справочника по региону
│   ├── probe.ts      # DNS → TCP → TLS → HTTP GET
│   ├── storage.ts    # JSONL-пробы, state, инциденты
│   ├── scheduler.ts  # волны проб + детект инцидентов
│   ├── api.ts        # HTTP API + статика (node:http)
│   └── index.ts      # точка входа
├── public/           # дашборд (vanilla JS + uPlot локально)
├── data/             # courts.json + probes/ + state + incidents
└── docs/             # CONTEXT.md, DECISIONS.md
```

## Do NOT touch

- `data/` — генерируется приложением
- WAF ГАС банит за rate-limit: НЕ повышать concurrency выше 2, НЕ снижать интервал без обсуждения

## Documentation rules

- После работы — обнови docs/CONTEXT.md
- Архитектурное решение — в docs/DECISIONS.md
- НЕ создавай новых .md без разрешения
