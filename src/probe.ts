// Проба доступности: DNS → TCP → TLS → HTTP GET модуля поиска (/modules.php?name=sud_delo)
import { lookup } from 'node:dns/promises';
import { connect as tlsConnect } from 'node:tls';
import { connect as netConnect, type Socket } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { CONFIG } from './config.ts';

export type ProbeStatus =
  | 'OK' | 'BANNED' | 'HTTP_ERR'
  | 'DNS_FAIL' | 'CONNECT_FAIL' | 'TLS_FAIL' | 'TIMEOUT';

export type ProbeResult = {
  ts: number;
  code: string;
  host: string;
  status: ProbeStatus;
  httpCode: number | null;
  dnsMs: number | null;
  connectMs: number | null;
  tlsMs: number | null;
  totalMs: number;
  bytes: number | null;
};

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); })
     .catch(e => { clearTimeout(t); reject(e); });
  });
}

function tcpConnect(host: string, port: number, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = netConnect({ host, port });
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('connect timeout')); }, timeoutMs);
    sock.once('connect', () => { clearTimeout(timer); resolve(sock); });
    sock.once('error', e => { clearTimeout(timer); reject(e); });
  });
}

function tlsHandshake(sock: Socket, host: string, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const tlsSock = tlsConnect({ socket: sock, servername: host, rejectUnauthorized: false });
    const timer = setTimeout(() => { tlsSock.destroy(); reject(new Error('tls timeout')); }, timeoutMs);
    tlsSock.once('secureConnect', () => { clearTimeout(timer); resolve(tlsSock); });
    tlsSock.once('error', e => { clearTimeout(timer); reject(e); });
  });
}

function httpGet(host: string, port: number, timeoutMs: number, tls: boolean): Promise<{ code: number; bytes: number; body: string }> {
  const fn = tls ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = fn({
      host, port, path: '/modules.php?name=sud_delo', method: 'GET',
      agent: false, // CR: глобальный keep-alive агент держит сокеты — утечка FD
      headers: {
        'User-Agent': CONFIG.userAgent,
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'ru,en;q=0.8',
      },
      rejectUnauthorized: false,
    }, res => {
      let bytes = 0;
      const chunks: Buffer[] = [];
      const CAP = 32 * 1024;
      let capped = false;
      res.on('data', c => {
        bytes += c.length;
        if (!capped) {
          if (bytes > CAP) { capped = true; }
          else chunks.push(c as Buffer);
        }
      });
      res.on('end', () => {
        clearTimeout(timer);
        const body = Buffer.concat(chunks).toString('utf-8').slice(0, 16_000);
        resolve({ code: res.statusCode ?? 0, bytes, body });
      });
      res.on('error', e => { clearTimeout(timer); reject(e); });
    });
    // Абсолютный дедлайн (не idle): destroy обязательно, чтобы не течь сокетами
    const timer = setTimeout(() => req.destroy(new Error('http timeout')), timeoutMs);
    req.on('error', e => { clearTimeout(timer); reject(e); });
    req.end();
  });
}

export async function probeCourt(code: string, host: string): Promise<ProbeResult> {
  const start = Date.now();
  const base: Omit<ProbeResult, 'status' | 'totalMs'> = {
    ts: start, code, host,
    httpCode: null, dnsMs: null, connectMs: null, tlsMs: null, bytes: null,
  };

  // 1. DNS
  try {
    const dnsStart = Date.now();
    const addr = await withTimeout(lookup(host), CONFIG.dnsTimeoutMs, 'dns');
    base.dnsMs = Date.now() - dnsStart;
    void addr;
  } catch {
    return { ...base, status: 'DNS_FAIL', totalMs: Date.now() - start };
  }

  // 2. TCP — внутренний таймер уже есть, внешний withTimeout не нужен (утечка FD)
  let sock: Socket;
  try {
    const cStart = Date.now();
    sock = await tcpConnect(host, 443, CONFIG.connectTimeoutMs);
    base.connectMs = Date.now() - cStart;
  } catch {
    return { ...base, status: 'CONNECT_FAIL', totalMs: Date.now() - start };
  }

  // 3. TLS (кривые сертификаты ГАС — rejectUnauthorized:false)
  try {
    const tStart = Date.now();
    const tlsSock = await tlsHandshake(sock, host, CONFIG.tlsTimeoutMs);
    base.tlsMs = Date.now() - tStart;
    tlsSock.destroy();
  } catch {
    try { sock.destroy(); } catch {}
    return { ...base, status: 'TLS_FAIL', totalMs: Date.now() - start };
  }

  // 4. HTTP GET /modules.php?name=sud_delo — валидируем тело, а не только код
  try {
    const h = await httpGet(host, 443, CONFIG.httpTimeoutMs, true);
    base.httpCode = h.code;
    base.bytes = h.bytes;
    if (h.code === 403 || h.code === 429) {
      return { ...base, status: 'BANNED', totalMs: Date.now() - start };
    }
    if (h.code < 200 || h.code >= 400) {
      return { ...base, status: 'HTTP_ERR', totalMs: Date.now() - start };
    }
    // 200 — проверяем что это форма поиска, а не заглушка/капча-страница
    const body = h.body.toLowerCase();
    const isCaptcha = body.includes('captcha') || body.includes('kcaptcha') || body.includes('проверочный код');
    if (isCaptcha) return { ...base, status: 'BANNED', totalMs: Date.now() - start };
    const hasSearchMarker = body.includes('g1_parts__namess') || body.includes('sud_delo') || body.includes('name_op') || body.includes('modules.php');
    if (!hasSearchMarker || h.bytes < 500) return { ...base, status: 'HTTP_ERR', totalMs: Date.now() - start };
    return { ...base, status: 'OK', totalMs: Date.now() - start };
  } catch (e) {
    // CR: классифицируем по тексту — обрыв соединения ≠ таймаут
    const msg = String((e as Error | undefined)?.message ?? e);
    const status: ProbeStatus = msg.includes('timeout') ? 'TIMEOUT' : 'HTTP_ERR';
    return { ...base, status, totalMs: Date.now() - start };
  }
}

