// Проба доступности: DNS → TCP → TLS → HTTP GET главной страницы
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

function httpGet(host: string, port: number, timeoutMs: number, tls: boolean): Promise<{ code: number; bytes: number }> {
  const fn = tls ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = fn({
      host, port, path: '/', method: 'GET',
      headers: {
        'User-Agent': CONFIG.userAgent,
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'ru,en;q=0.8',
      },
      rejectUnauthorized: false,
    }, res => {
      let bytes = 0;
      res.on('data', c => { bytes += c.length; });
      res.on('end', () => resolve({ code: res.statusCode ?? 0, bytes }));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('http timeout')));
    req.on('error', reject);
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

  // 2. TCP
  let sock: Socket;
  try {
    const cStart = Date.now();
    sock = await withTimeout(tcpConnect(host, 443, CONFIG.connectTimeoutMs), CONFIG.connectTimeoutMs + 500, 'tcp');
    base.connectMs = Date.now() - cStart;
  } catch {
    return { ...base, status: 'CONNECT_FAIL', totalMs: Date.now() - start };
  }

  // 3. TLS (кривые сертификаты ГАС — rejectUnauthorized:false)
  try {
    const tStart = Date.now();
    const tlsSock = await withTimeout(tlsHandshake(sock, host, CONFIG.tlsTimeoutMs), CONFIG.tlsTimeoutMs + 500, 'tls');
    base.tlsMs = Date.now() - tStart;
    tlsSock.destroy();
  } catch {
    sock.destroy();
    return { ...base, status: 'TLS_FAIL', totalMs: Date.now() - start };
  }

  // 4. HTTP GET /
  try {
    const h = await withTimeout(httpGet(host, 443, CONFIG.httpTimeoutMs, true), CONFIG.httpTimeoutMs + 500, 'http');
    base.httpCode = h.code;
    base.bytes = h.bytes;
    const status: ProbeStatus =
      h.code === 403 || h.code === 429 ? 'BANNED'
      : h.code >= 200 && h.code < 400 ? 'OK'
      : 'HTTP_ERR';
    return { ...base, status, totalMs: Date.now() - start };
  } catch {
    return { ...base, status: 'TIMEOUT', totalMs: Date.now() - start };
  }
}

