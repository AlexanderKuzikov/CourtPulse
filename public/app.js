// CourtPulse dashboard (vanilla JS + uPlot)
const $ = s => document.querySelector(s);

const STATUS_OK = new Set(['OK']);
const STATUS_COLORS = {
  OK: '#2ecc71', BANNED: '#e67e22',
  DNS_FAIL: '#e74c3c', CONNECT_FAIL: '#e74c3c', TLS_FAIL: '#e74c3c',
  TIMEOUT: '#e74c3c', HTTP_ERR: '#e74c3c', UNKNOWN: '#7f8c8d',
};

const STATUS_LABELS = {
  OK: 'Доступен',
  BANNED: 'WAF-бан',
  DNS_FAIL: 'DNS-ошибка',
  CONNECT_FAIL: 'Нет соединения',
  TLS_FAIL: 'TLS-ошибка',
  TIMEOUT: 'Таймаут',
  HTTP_ERR: 'Ошибка HTTP',
  UNKNOWN: 'Неизвестно',
};

let courts = [];
let summary = null;

const fmtTime = ts => ts
  ? new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  : '—';

// Подписи оси времени uPlot: свой русский формат вместо встроенного US (M/D, h:mm aa)
const fmtAxisDay = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' });
const fmtAxisTime = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtAxis = (u, ticks) => {
  const spanDays = (u.scales.x.max - u.scales.x.min) / 86400;
  const fmt = spanDays > 2 ? fmtAxisDay : fmtAxisTime;
  return ticks.map(t => fmt.format(new Date(t * 1000)));
};
const fmtMs = ms => ms ? (ms < 1000 ? `${ms} мс` : `${(ms / 1000).toFixed(1)} с`) : '—';
const fmtDur = ms => {
  if (!ms) return '—';
  const h = Math.floor(ms / 3600000), m = Math.round((ms % 3600000) / 60000);
  return h ? `${h} ч ${m} мин` : `${m} мин`;
};

async function fetchJSON(p) {
  const r = await fetch(p);
  return r.json();
}

// ─── KPI ───
function renderKpis() {
  const s = summary;
  const sc = s.statusCounts;
  const uptime = (s.uptime24h * 100).toFixed(1);
  const ok7 = (s.ok7 * 100).toFixed(1);
  const bad = ['DNS_FAIL', 'CONNECT_FAIL', 'TLS_FAIL', 'TIMEOUT', 'HTTP_ERR'].reduce((a, k) => a + (sc[k] ?? 0), 0);
  const html = `
    <div class="kpi"><div class="l">Судов в мониторинге</div><div class="v">${s.courtsTotal}</div></div>
    <div class="kpi ok"><div class="l">Доступны сейчас</div><div class="v">${sc.OK ?? 0}</div></div>
    <div class="kpi warn"><div class="l">WAF-бан (403/429)</div><div class="v">${sc.BANNED ?? 0}</div></div>
    <div class="kpi bad"><div class="l">Недоступны сейчас</div><div class="v">${bad}</div></div>
    <div class="kpi"><div class="l">Uptime 24ч</div><div class="v">${uptime}%</div></div>
    <div class="kpi"><div class="l">OK за 7 дней</div><div class="v">${ok7}%</div></div>
    <div class="kpi"><div class="l">Пробы 24ч<br>падений ${s.bad24h}</div><div class="v">${s.probes24h}</div></div>
    <div class="kpi"><div class="l">Медиана отклика</div><div class="v">${fmtMs(s.medianMs)}</div></div>`;
  $('#kpis').innerHTML = html;
  $('#ticker').textContent = `Обновлено: ${fmtTime(s.now)} · последняя волна: ${fmtTime(s.lastWave)}`;
}

// ─── График 7 дней: доля OK по 15-мин бакетам ──
let chart7 = null;
async function renderChart7() {
  const probes = await fetchJSON('/api/history?days=7');
  const buckets = new Map();
  const BUCKET = 15 * 60 * 1000;
  const now = Date.now();
  for (let t = now - 7 * 86400000; t <= now; t += BUCKET) buckets.set(Math.round(t / BUCKET) * BUCKET, { ok: 0, total: 0 });
  for (const p of probes) {
    const b = Math.round(p.ts / BUCKET) * BUCKET;
    const cell = buckets.get(b);
    if (!cell) continue;
    cell.total++;
    if (STATUS_OK.has(p.status)) cell.ok++;
  }
  const ts = [...buckets.keys()].sort((a, b) => a - b);
  const data = ts.map(t => { const c = buckets.get(t); return c.total ? c.ok / c.total * 100 : null; });

  const opts = {
    width: document.querySelector('#chart7').clientWidth,
    height: 220,
    legend: { show: false },
    scales: { x: { time: true }, y: { range: [0, 100] } },
    series: [
      {},
      {
        stroke: '#4f8cff', width: 1.5, fill: 'rgba(79,140,255,.12)',
        points: { show: false },
        value: (u, v) => v == null ? '—' : v.toFixed(0) + '%',
      },
    ],
    axes: [
      { stroke: '#5b6570', grid: { stroke: '#e2e8f0' }, size: 40, values: fmtAxis },
      { stroke: '#5b6570', grid: { stroke: '#e2e8f0' }, values: v => v + '%', size: 44 },
    ],
  };
  const u = new uPlot(opts, [ts.map(t => t / 1000), data], $('#chart7'));
  // ресайз
  const ro = new ResizeObserver(() => {
    const w = document.querySelector('#chart7').clientWidth;
    if (w > 200) u.setSize({ width: w, height: 220 });
  });
  ro.observe($('#chart7'));
  chart7 = u;
}

// ─── Таблица судов ───
let typeFilter = '', statusFilter = '', query = '';
let sort = { key: 'status', dir: 1 };   // по умолчанию: недоступные сверху

const TYPE_PRIORITY = { 'Краевой': 0, 'Арбитражный': 1, 'Районный': 2, 'Мировой': 3 };
const STATUS_SEVERITY = {
  TIMEOUT: 0, HTTP_ERR: 0, CONNECT_FAIL: 0, DNS_FAIL: 0, TLS_FAIL: 0,
  UNKNOWN: 1, BANNED: 2, OK: 3,
};

// Числовая колонка: пропуски всегда в конце, направление — только у реальных значений.
// Для Падений/Проб 0 — валидное значение, пропуск = null; для Отклика/Uptime/Последней пробы 0 = нет данных
function cmpNumeric(a, b, key, dir) {
  const miss = key === 'down24h' || key === 'probes24h' ? v => v == null : v => !v;
  const va = a[key], vb = b[key];
  if (miss(va)) return miss(vb) ? 0 : 1;
  if (miss(vb)) return -1;
  return (va - vb) * dir;
}

function sortRows(rows) {
  const { key, dir } = sort;
  return rows.sort((a, b) => {
    let r;
    if (key === 'name') r = a.name.localeCompare(b.name, 'ru', { numeric: true }) * dir;
    else if (key === 'courtType') r = ((TYPE_PRIORITY[a.courtType] ?? 9) - (TYPE_PRIORITY[b.courtType] ?? 9)) * dir;
    else if (key === 'status') r = ((STATUS_SEVERITY[a.status] ?? 9) - (STATUS_SEVERITY[b.status] ?? 9)) * dir;
    else r = cmpNumeric(a, b, key, dir);
    // При равенстве — приоритет типов (краевой, арбитражный, районные, участки), затем код
    return r !== 0
      ? r
      : (TYPE_PRIORITY[a.courtType] ?? 9) - (TYPE_PRIORITY[b.courtType] ?? 9) || a.code.localeCompare(b.code);
  });
}

function renderSortIndicator() {
  document.querySelectorAll('#courts th[data-key]').forEach(th => {
    const label = th.dataset.label ?? th.textContent.trim();
    th.dataset.label = label;
    th.textContent = label + (th.dataset.key === sort.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '');
    th.classList.toggle('sort-active', th.dataset.key === sort.key);
  });
}

function renderCourts() {
  const rows = courts.filter(c => {
    if (typeFilter && c.courtType !== typeFilter) return false;
    if (statusFilter && c.status !== statusFilter) return false;
    if (query && !(c.name + ' ' + c.host + ' ' + c.code).toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });
  sortRows(rows);
  const tbody = $('#courts tbody');
  tbody.innerHTML = rows.map(c => {
    const up = Math.round(c.uptime24h * 100);
    const bar = `<span class="up-cell"><span class="uptime-bar"><i style="width:${up}%"></i></span>${up}%</span>`;
    return `<tr data-code="${c.code}">
      <td><strong>${esc(c.name)}</strong><br><span style="color:var(--muted);font-size:12px">${esc(c.code)} · <a href="https://${esc(c.host)}/" target="_blank" rel="noopener">${esc(c.host)}</a></span></td>
      <td>${esc(c.courtType)}</td>
      <td><span class="badge ${esc(c.status)}">${esc(STATUS_LABELS[c.status] ?? c.status)}</span></td>
      <td>${bar}</td>
      <td>${c.probes24h}</td>
      <td style="color:var(--bad)">${c.down24h}</td>
      <td>${fmtMs(c.totalMs)}</td>
      <td>${fmtTime(c.lastTs)}</td>
    </tr>`;
  }).join('');
  renderSortIndicator();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[m]);
}

function initFilters() {
  const types = [...new Set(courts.map(c => c.courtType))].sort();
  $('#fType').innerHTML = '<option value="">Все типы</option>' +
    types.map(t => `<option>${esc(t)}</option>`).join('');
  const statuses = [...new Set(courts.map(c => c.status))].sort();
  $('#fStatus').innerHTML = '<option value="">Все статусы</option>' +
    statuses.map(s => `<option value="${esc(s)}">${esc(STATUS_LABELS[s] ?? s)}</option>`).join('');
}

// ─── Инциденты ───
async function renderIncidents() {
  const inc = await fetchJSON('/api/incidents?days=14');
  const tbody = $('#incidents tbody');
  tbody.innerHTML = inc.slice().reverse().map(i => {
    const d = i.endTs ? i.endTs - i.startTs : Date.now() - i.startTs;
    return `<tr>
      <td><strong>${esc(i.name)}</strong><br><span style="color:var(--muted);font-size:12px">${esc(i.host)}</span></td>
      <td>${fmtTime(i.startTs)}</td>
      <td>${i.endTs ? fmtTime(i.endTs) : '<span class="badge BANNED">идёт сейчас</span>'}</td>
      <td>${fmtDur(d)}</td>
      <td><span class="badge ${esc(i.reason)}">${esc(STATUS_LABELS[i.reason] ?? i.reason)}</span></td>
      <td>${i.probes}</td>
    </tr>`;
  }).join('');
}

// ─── Карточка суда (модалка) ───
let mChart = null;
async function openModal(code) {
  const c = courts.find(x => x.code === code);
  if (!c) return;
  $('#mTitle').textContent = `${c.name} — ${c.host}`;
  $('#modal').hidden = false;
  const probes = await fetchJSON(`/api/history?code=${encodeURIComponent(code)}&days=7`);
  const ts = probes.map(p => p.ts / 1000);
  const data = probes.map(p => STATUS_OK.has(p.status) ? 1 : 0);

  if (mChart) { mChart.destroy(); mChart = null; }
  const el = $('#mChart');
  const opts = {
    width: el.clientWidth, height: 160,
    legend: { show: false },
    scales: { x: { time: true }, y: { range: [0, 1.2] } },
    series: [
      {},
      { stroke: '#4f8cff', width: 1, points: { show: false }, value: () => '' },
    ],
    axes: [
      { stroke: '#5b6570', grid: { stroke: '#e2e8f0' }, values: fmtAxis },
      { stroke: '#5b6570', grid: { stroke: '#e2e8f0' }, values: () => '' },
    ],
    hooks: {
      drawSeries: [(u, sidx) => {
        if (sidx !== 1) return;
        const { ctx } = u;
        ctx.save();
        for (let i = 0; i < u.data[0].length; i++) {
          const x = u.valToPos(u.data[0][i], 'x');
          const yTop = u.valToPos(1, 'y');
          const yBot = u.valToPos(0, 'y');
          ctx.fillStyle = u.data[1][i] === 1 ? 'rgba(46,204,113,.5)' : 'rgba(231,76,60,.65)';
          ctx.fillRect(x - 2, yTop, 4, yBot - yTop);
        }
        ctx.restore();
      }],
    },
  };
  mChart = new uPlot(opts, [ts, data], el);
}

// ─── Цикл ───
async function tick() {
  [summary, courts] = await Promise.all([fetchJSON('/api/summary'), fetchJSON('/api/courts')]);
  renderKpis();
  if (!chart7) void renderChart7();
  if ($('#courts tbody').children.length === 0) {
    initFilters();
    renderCourts();
  } else {
    renderCourts();
  }
  void renderIncidents();
}

// события
$('#fType').addEventListener('change', e => { typeFilter = e.target.value; renderCourts(); });
$('#fStatus').addEventListener('change', e => { statusFilter = e.target.value; renderCourts(); });
$('#q').addEventListener('input', e => { query = e.target.value; renderCourts(); });
// сортировка по клику: asc → desc → сброс к дефолту (недоступные сверху)
$('#courts thead').addEventListener('click', e => {
  const th = e.target.closest('th[data-key]');
  if (!th) return;
  const key = th.dataset.key;
  if (sort.key === key && sort.dir === 1) sort = { key, dir: -1 };
  else if (sort.key === key) sort = { key: 'status', dir: 1 };
  else sort = { key, dir: 1 };
  renderCourts();
});
$('#courts tbody').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-code]');
  if (tr) openModal(tr.dataset.code);
});
$('#modalClose').addEventListener('click', () => { $('#modal').hidden = true; });
$('#modal').addEventListener('click', e => { if (e.target === $('#modal')) $('#modal').hidden = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#modal').hidden = true; });

tick();
setInterval(tick, 60_000);
