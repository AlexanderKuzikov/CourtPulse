// Конфигурация CourtPulse
export const CONFIG = {
  region: '59',            // Пермский край (первые 2 символа кода суда)
  probeIntervalMs: 15 * 60 * 1000, // проверка каждого суда раз в 15 минут
  concurrency: 2,          // параллельных проб (WAF ГАС банит за rate-limit!)
  jitterMaxMs: 30_000,     // случайная задержка перед волной
  gapMinMs: 2_000,         // минимум между стартами проб
  port: 8781,
  dataDir: 'data',
  incidentsThreshold: 3,   // N подряд неудач = инцидент
  // Таймауты этапов пробы (WAF тормозит до 1-2 минут — но главная отвечает быстрее)
  dnsTimeoutMs: 10_000,
  connectTimeoutMs: 15_000,
  tlsTimeoutMs: 15_000,
  httpTimeoutMs: 30_000,
  userAgent: 'CourtPulse/0.1 (+https://github.com/AlexanderKuzikov/CourtPulse)',
} as const;
