// Конфигурация CourtPulse
export const CONFIG = {
  region: '59',            // Пермский край (первые 2 символа кода суда)
  probeIntervalMs: 15 * 60 * 1000, // откат к безопасному интервалу — WAF cooldown (было 12)
  concurrency: 2,          // откат: WAF банит агрегат 4× — возвращаем 2 (проверено)
  jitterMaxMs: 30_000,     // случайная задержка перед волной
  gapMinMs: 3_000,         // +1с паузы между стартами — снижаем пиковый QPS
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
