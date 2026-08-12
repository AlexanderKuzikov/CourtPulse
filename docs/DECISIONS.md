# CourtPulse — DECISIONS

<!-- Append-only. Формат фиксирован. -->

## 2026-08-12: ADR-001 — Ноль зависимостей, TS через type-stripping

**Контекст:** Утилита для мониторинга судов. Node 22.6+ уже умеет TS нативно.

**Решение:** Node `--experimental-strip-types`, ноль npm-зависимостей (runtime и dev). API на `node:http`, UI vanilla + uPlot (локальный файл из SerpWatcher).

**Альтернативы:** tsx + typescript (build-шаг); Express (зависимость).

**Trade-off:** Теряем типы в рантайме (strip — не typecheck), но утилита маленькая, запускается без node_modules.

## 2026-08-12: ADR-002 — Вежливая волна проб

**Контекст:** WAF ГАС банит IP по rate-limit (403/429, из CourtDesk).

**Решение:** Волна каждые 15 мин, concurrency 2, jitter ≤30 с, минимум 2 с между стартами проб. 181 суд × 96 проб/сутки ≈ 17K запросов/день на регион — безопасно.

**Trade-off:** Инциденты короче 15 мин не видны. Приемлемо — баны WAF длятся часами.
