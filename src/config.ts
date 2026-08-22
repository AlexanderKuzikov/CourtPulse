// Конфигурация CourtPulse
export const CONFIG = {
  region: '59',            // Пермский край (первые 2 символа кода суда)
  probeIntervalMs: 12 * 60 * 1000, // проверка каждого суда раз в 12 минут
  concurrency: 2,          // параллельных проб (WAF ГАС банит за rate-limit!)
  jitterMaxMs: 30_000,     // случайная задержка перед волной
  gapMinMs: 2_000,         // минимум между стартами проб
  port: 8781,
  dataDir: 'data',
  incidentsThreshold: 3,   // N подряд неудач = инцидент
  // Таймауты этапов пробы (увеличены под медленные ответы судов)
  dnsTimeoutMs: 5_000,
  connectTimeoutMs: 30_000,
  tlsTimeoutMs: 30_000,
  httpTimeoutMs: 45_000,
  userAgent: 'CourtPulse/0.1 (+https://github.com/AlexanderKuzikov/CourtPulse)',
} as const;
