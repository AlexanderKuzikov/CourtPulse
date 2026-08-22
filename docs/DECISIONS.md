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

## 2026-08-22: ADR-003 — Валидация тела поиска и BANNED-cooldown

**Контекст:** `GET /modules.php?name=sud_delo` отдаёт 200 даже с заглушкой; `concurrency 4` вызвал эскалацию `BANNED 34→81, 0 OK`.

**Решение:** Валидация тела (32КБ cap): `G1_PARTS__NAMESS`/`sud_delo`/`name_op` → OK, `captcha/kcaptcha/проверочный код` → BANNED, `<500B/без маркера` → HTTP_ERR. `concurrency 2`, `interval 15мин`, `gap 3с`, `bannedUntil 45мин` (3 волны, синтетический `BANNED 429` без сети). `setInterval`→wall-clock `setTimeout` (старт→старт). Rate-limit `/api/history` 60/мин/20k cap. Пауза 60мин через `systemd-run --on-active`.

**Trade-off:** Теряем `~40%` QPS и 12мин→15мин, но снижаем риск бана; BANNED-хосты не дергаем 45мин (ложно-отрицательные возможны, но лучше чем эскалация бана).
