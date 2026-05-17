// ============================================================
// EVA — App web para GitHub Pages
// Archivo: app.js
// Requiere: index.html + style.css + Web App de Google Apps Script
// ============================================================

let API_URL = '';
let FX = 17.5;
let currentPage = 'dashboard';

const D = {
  config: {},
  dashboard: {},
  acciones: [],
  opciones: [],
  socios: [],
  watchlist: []
};

const PAGE_TITLES = {
  dashboard: 'Dashboard',
  capital: 'Capital',
  posiciones: 'Posiciones',
  trades: 'Trades',
  'plan-acciones': 'Plan Acciones',
  'plan-opciones': 'Plan Opciones',
  socios: 'Socios',
  watchlist: 'Watchlist',
  reportes: 'Reportes'
};

const $ = (id) => document.getElementById(id);
const today = new Date();
const todayISO = today.toISOString().slice(0, 10);

function n(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function money(value) {
  if (value === null || value === undefined || value === '') return '—';
  const num = n(value);
  const sign = num < 0 ? '-' : '';
  return sign + '$' + Math.abs(num).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function mxn(value) {
  if (value === null || value === undefined || value === '') return '—';
  return money(n(value) * FX) + ' MXN';
}

function pct(value) {
  if (value === null || value === undefined || value === '') return '—';
  const num = n(value);
  return (num >= 0 ? '+' : '') + (num * 100).toFixed(2) + '%';
}

function pctPlain(value) {
  const num = n(value);
  return (num >= 0 ? '+' : '') + num.toFixed(2) + '%';
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function dateText(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return esc(value);
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function normalizeArray(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload[key])) return payload[key];
  return [];
}

function normalizeConfig(cfg = {}) {
  const capAcciones = n(cfg.capAcciones ?? cfg.capitalAcciones);
  const capOpciones = n(cfg.capOpciones ?? cfg.capitalOpciones);
  return {
    ...cfg,
    capitalAcciones: capAcciones,
    capitalOpciones: capOpciones,
    capAcciones,
    capOpciones,
    metaAcciones: n(cfg.metaAcciones || 0.03),
    metaOpciones: n(cfg.metaOpciones || 0.20),
    meses: n(cfg.meses || 12),
    tipoCambio: n(cfg.tipoCambio || FX)
  };
}

function calcAccion(a) {
  const acciones = n(a.acciones);
  const compra = n(a.precioCompra);
  const venta = n(a.precioVenta);
  const comision = n(a.comision);
  const subtotal = n(a.subtotal) || acciones * compra;
  const ingresosVenta = n(a.ingresosVenta) || (venta ? acciones * venta : 0);
  const estado = a.estado || (venta ? 'Cerrada' : 'Abierta');
  const pnl = a.pnl !== '' && a.pnl !== undefined ? n(a.pnl) : (venta ? ingresosVenta - subtotal - comision : '');
  const pnlPct = a.pnlPct !== '' && a.pnlPct !== undefined ? n(a.pnlPct) : (venta && subtotal ? pnl / subtotal : '');
  return { ...a, acciones, precioCompra: compra, precioVenta: a.precioVenta, comision, subtotal, ingresosVenta, estado, pnl, pnlPct };
}

function calcOpcion(o) {
  const contratos = n(o.contratos);
  const primaCompra = n(o.primaCompra);
  const primaVenta = n(o.primaVenta);
  const comision = n(o.comision);
  const subtotal = n(o.subtotal) || contratos * primaCompra * 100;
  const ingresos = n(o.ingresos) || (primaVenta ? contratos * primaVenta * 100 : 0);
  const estado = o.estado || (primaVenta ? 'Cerrada' : 'Abierta');
  const pnl = o.pnl !== '' && o.pnl !== undefined ? n(o.pnl) : (primaVenta ? ingresos - subtotal - comision : '');
  const pnlPct = o.pnlPct !== '' && o.pnlPct !== undefined ? n(o.pnlPct) : (primaVenta && subtotal ? pnl / subtotal : '');
  return { ...o, contratos, primaCompra, primaVenta: o.primaVenta, comision, subtotal, ingresos, estado, pnl, pnlPct };
}

function getComputedDashboard() {
  const cfg = normalizeConfig(D.config);
  const acciones = D.acciones.map(calcAccion);
  const opciones = D.opciones.map(calcOpcion);
  const closedAcc = acciones.filter(a => a.estado === 'Cerrada');
  const closedOpc = opciones.filter(o => o.estado === 'Cerrada');
  const pnlAcciones = closedAcc.reduce((s, a) => s + n(a.pnl), 0);
  const pnlOpciones = closedOpc.reduce((s, o) => s + n(o.pnl), 0);
  const pnlTotal = pnlAcciones + pnlOpciones;
  const capAcciones = cfg.capAcciones;
  const capOpciones = cfg.capOpciones;
  const capTotal = capAcciones + capOpciones + pnlTotal;
  const base = capAcciones + capOpciones;
  const comisiones = [...acciones, ...opciones].reduce((s, x) => s + n(x.comision), 0);

  return {
    capAcciones,
    capOpciones,
    capTotal,
    pnlAcciones,
    pnlOpciones,
    pnlTotal,
    comisiones,
    rendimiento: base ? pnlTotal / base : 0,
    hoy: getPeriodTotals('hoy'),
    semana: getPeriodTotals('semana'),
    mes: getPeriodTotals('mes'),
    anio: getPeriodTotals('anio'),
    total: { pnlAcc: pnlAcciones, pnlOpc: pnlOpciones, total: pnlTotal, mxn: pnlTotal * FX }
  };
}

function getPeriodTotals(period) {
  const now = new Date();
  let from = new Date(0);
  if (period === 'hoy') from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'semana') {
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    from.setDate(from.getDate() - from.getDay());
  }
  if (period === 'mes') from = new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === 'anio') from = new Date(now.getFullYear(), 0, 1);

  const inPeriod = (dateValue) => {
    if (!dateValue) return false;
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) return false;
    return d >= from;
  };

  const pnlAcc = D.acciones
    .map(calcAccion)
    .filter(a => a.estado === 'Cerrada' && inPeriod(a.fechaCierre))
    .reduce((s, a) => s + n(a.pnl), 0);
  const pnlOpc = D.opciones
    .map(calcOpcion)
    .filter(o => o.estado === 'Cerrada' && inPeriod(o.fechaCierre))
    .reduce((s, o) => s + n(o.pnl), 0);
  return { pnlAcc, pnlOpc, total: pnlAcc + pnlOpc, mxn: (pnlAcc + pnlOpc) * FX };
}

// ── Setup ─────────────────────────────────────────────────────
function saveScriptUrl() {
  const input = $('script-url');
  const url = input.value.trim();
  if (!url || !url.includes('script.google.com')) {
    showToast('Pega la URL correcta de tu Apps Script.', 'error');
    return;
  }
  API_URL = url;
  localStorage.setItem('eva_api_url', API_URL);
  startApp();
}

function loadDemo() {
  API_URL = 'DEMO';
  localStorage.removeItem('eva_api_url');
  loadDemoData();
  startApp(false);
}

function startApp(shouldSync = true) {
  $('setup-screen').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('header-date').textContent = new Date().toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  if (shouldSync) syncAll();
  else renderAll();
}

function showSetup() {
  $('app').classList.add('hidden');
  $('setup-screen').classList.remove('hidden');
  const saved = localStorage.getItem('eva_api_url');
  if (saved) $('script-url').value = saved;
}

function toggleSidebar() {
  $('sidebar').classList.toggle('open');
}

// ── API ───────────────────────────────────────────────────────
async function api(action, data = {}) {
  if (API_URL === 'DEMO') return getDemoResponse(action, data);

  const sep = API_URL.includes('?') ? '&' : '?';
  const url = `${API_URL}${sep}action=${encodeURIComponent(action)}`;

  const res = await fetch(url, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...data })
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error('Apps Script no regresó JSON válido. Revisa la implementación del Web App.');
  }

  if (json.ok === false) throw new Error(json.error || 'Error desconocido en Apps Script.');
  return json.data !== undefined ? json.data : json;
}

async function syncAll() {
  const btn = document.querySelector('.sync-btn');
  if (btn) btn.textContent = '↻';
  try {
    const [cfg, dash, acc, opc, socios, watch] = await Promise.all([
      api('getConfig'),
      api('getDashboard'),
      api('getAcciones'),
      api('getOpciones'),
      api('getSocios'),
      api('getWatchlist')
    ]);

    D.config = normalizeConfig(cfg || {});
    D.dashboard = dash || {};
    D.acciones = normalizeArray(acc, 'acciones').map(calcAccion);
    D.opciones = normalizeArray(opc, 'opciones').map(calcOpcion);
    D.socios = normalizeArray(socios, 'socios');
    D.watchlist = normalizeArray(watch, 'watchlist');

    FX = n(D.config.tipoCambio || D.dashboard.tipoCambio || FX) || FX;
    renderAll();
    showToast('Datos sincronizados.', 'success');
  } catch (err) {
    console.error(err);
    showToast(err.message || 'No se pudo conectar con Google Sheets.', 'error');
  } finally {
    if (btn) btn.textContent = '↻';
  }
}

// ── Navigation / render ───────────────────────────────────────
function showPage(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });
  $('page-title').textContent = PAGE_TITLES[page] || 'EVA';
  $('sidebar').classList.remove('open');
  renderPage();
}

function renderAll() {
  $('nav-fx').textContent = `USD/MXN: $${FX.toFixed(2)}`;
  $('header-fx').textContent = `USD/MXN $${FX.toFixed(2)}`;
  renderPage();
}

function renderPage() {
  const content = $('page-content');
  if (!content) return;

  const renderers = {
    dashboard: renderDashboard,
    capital: renderCapital,
    posiciones: renderPosiciones,
    trades: renderTrades,
    'plan-acciones': () => renderPlan('acciones'),
    'plan-opciones': () => renderPlan('opciones'),
    socios: renderSocios,
    watchlist: renderWatchlist,
    reportes: renderReportes
  };

  content.innerHTML = (renderers[currentPage] || renderDashboard)();
}

function kpi(label, value, sub = '', tone = '') {
  return `<div class="kpi ${tone}">
    <div class="kpi-label">${esc(label)}</div>
    <div class="kpi-value">${value}</div>
    ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
  </div>`;
}

function empty(message) {
  return `<div class="card"><p style="color:var(--text-muted)">${esc(message)}</p></div>`;
}

function renderDashboard() {
  const d = { ...getComputedDashboard(), ...D.dashboard };
  if (D.dashboard.periodos && !D.dashboard.hoy) {
    d.hoy = mapPeriod(D.dashboard.periodos.hoy);
    d.semana = mapPeriod(D.dashboard.periodos.semana);
    d.mes = mapPeriod(D.dashboard.periodos.mes);
    d.anio = mapPeriod(D.dashboard.periodos.anio);
    d.total = mapPeriod(D.dashboard.periodos.total);
  }

  const alerts = D.opciones
    .map(calcOpcion)
    .filter(o => o.estado === 'Abierta' && o.fechaVencim)
    .map(o => {
      const days = Math.ceil((new Date(o.fechaVencim) - new Date()) / 86400000);
      return { ...o, days };
    })
    .filter(o => o.days >= 0 && o.days <= 3);

  const closed = [
    ...D.acciones.map(a => ({ ...calcAccion(a), tipo: 'Acción', name: a.ticker })),
    ...D.opciones.map(o => ({ ...calcOpcion(o), tipo: 'Opción', name: o.empresa }))
  ].filter(x => x.estado === 'Cerrada').slice(-8).reverse();

  return `
    <div class="kpi-grid">
      ${kpi('Capital acciones', money(d.capAcciones), mxn(d.capAcciones), 'teal')}
      ${kpi('Capital opciones', money(d.capOpciones), mxn(d.capOpciones), 'blue')}
      ${kpi('Capital total', money(d.capTotal), mxn(d.capTotal), 'teal')}
      ${kpi('P&L total', money(d.pnlTotal), mxn(d.pnlTotal), n(d.pnlTotal) >= 0 ? 'teal' : 'red')}
      ${kpi('Rendimiento', pct(d.rendimiento), '', n(d.rendimiento) >= 0 ? 'amber' : 'red')}
      ${kpi('Comisiones', '-' + money(d.comisiones), '', 'red')}
    </div>

    <div class="section-title">Resultado por periodo</div>
    <div class="period-grid">
      ${periodCard('Hoy', d.hoy)}
      ${periodCard('Semana', d.semana)}
      ${periodCard('Mes', d.mes)}
      ${periodCard('Año', d.anio)}
      ${periodCard('Total', d.total)}
    </div>

    ${alerts.length ? `<div class="section-title">Alertas</div>${alerts.map(o => `
      <div class="alert-warning">⚠️ <strong>${esc(o.empresa)}</strong> ${esc(o.tipo)} $${esc(o.strike)} vence en ${o.days} día(s).</div>
    `).join('')}` : ''}

    <div class="section-title">Últimos trades cerrados</div>
    <div class="card">
      ${closed.length ? tradeTable(closed) : '<p style="color:var(--text-muted)">Sin trades cerrados todavía.</p>'}
    </div>
  `;
}

function mapPeriod(p = {}) {
  const pnlAcc = n(p.pnlAcc ?? p.acc);
  const pnlOpc = n(p.pnlOpc ?? p.opc);
  return { pnlAcc, pnlOpc, total: n(p.total) || pnlAcc + pnlOpc, mxn: n(p.mxn) || (pnlAcc + pnlOpc) * FX };
}

function periodCard(label, p = {}) {
  const pd = mapPeriod(p);
  return `<div class="period-card">
    <div class="period-label">${esc(label)}</div>
    <div class="period-row"><span>Acciones</span><strong class="${pd.pnlAcc >= 0 ? 'green' : 'red'}">${money(pd.pnlAcc)}</strong></div>
    <div class="period-row"><span>Opciones</span><strong class="${pd.pnlOpc >= 0 ? 'green' : 'red'}">${money(pd.pnlOpc)}</strong></div>
    <div class="period-row"><span>Total</span><strong class="${pd.total >= 0 ? 'green' : 'red'}">${money(pd.total)}</strong></div>
  </div>`;
}

function renderCapital() {
  const d = getComputedDashboard();
  return `
    <div class="btn-row">
      <button class="btn btn-green" onclick="openModal('cap-acc')">+ Capital acciones</button>
      <button class="btn btn-blue" onclick="openModal('cap-opc')">+ Capital opciones</button>
      <button class="btn btn-red" onclick="openModal('retiro')">Registrar retiro</button>
    </div>
    <div class="kpi-grid">
      ${kpi('Capital base acciones', money(D.config.capAcciones), mxn(D.config.capAcciones), 'teal')}
      ${kpi('Capital base opciones', money(D.config.capOpciones), mxn(D.config.capOpciones), 'blue')}
      ${kpi('P&L acumulado', money(d.pnlTotal), mxn(d.pnlTotal), d.pnlTotal >= 0 ? 'teal' : 'red')}
      ${kpi('Capital estimado total', money(d.capTotal), mxn(d.capTotal), 'amber')}
    </div>
    <div class="card">
      <div class="card-title">Configuración actual</div>
      <table>
        <tbody>
          <tr><td>Nombre</td><td>${esc(D.config.nombre || '—')}</td></tr>
          <tr><td>Meta diaria acciones</td><td>${pct(D.config.metaAcciones)}</td></tr>
          <tr><td>Meta diaria opciones</td><td>${pct(D.config.metaOpciones)}</td></tr>
          <tr><td>Meses de plan</td><td>${esc(D.config.meses || '—')}</td></tr>
          <tr><td>Tipo de cambio</td><td>$${FX.toFixed(2)}</td></tr>
        </tbody>
      </table>
    </div>
  `;
}

function renderPosiciones() {
  const abiertasAcc = D.acciones.map(calcAccion).filter(a => a.estado === 'Abierta');
  const abiertasOpc = D.opciones.map(calcOpcion).filter(o => o.estado === 'Abierta');
  return `
    <div class="btn-row">
      <button class="btn btn-green" onclick="openModal('nueva-pos')">+ Agregar posición</button>
      <button class="btn btn-red" onclick="openModal('cerrar-pos')">Cerrar posición</button>
    </div>
    <div class="card">
      <div class="card-title">Acciones abiertas</div>
      ${abiertasAcc.length ? accionesTable(abiertasAcc) : '<p style="color:var(--text-muted)">Sin acciones abiertas.</p>'}
    </div>
    <div class="card">
      <div class="card-title">Opciones abiertas</div>
      ${abiertasOpc.length ? opcionesTable(abiertasOpc) : '<p style="color:var(--text-muted)">Sin opciones abiertas.</p>'}
    </div>
  `;
}

function renderTrades() {
  const acc = D.acciones.map(calcAccion).filter(a => a.estado === 'Cerrada').map(a => ({ ...a, tipo: 'Acción', name: a.ticker }));
  const opc = D.opciones.map(calcOpcion).filter(o => o.estado === 'Cerrada').map(o => ({ ...o, tipo: 'Opción', name: o.empresa }));
  const rows = [...acc, ...opc].reverse();
  return `
    <div class="card">
      <div class="card-title">Historial de trades cerrados</div>
      ${rows.length ? tradeTable(rows) : '<p style="color:var(--text-muted)">No hay trades cerrados.</p>'}
    </div>
  `;
}

function accionesTable(rows) {
  return `<div class="tbl-wrap"><table>
    <thead><tr><th>Ticker</th><th>Acciones</th><th>Compra</th><th>Venta</th><th>Subtotal</th><th>Comisión</th><th>P&L</th><th>P&L %</th><th>Estado</th><th>Cierre</th></tr></thead>
    <tbody>${rows.map(a => `<tr>
      <td><strong>${esc(a.ticker)}</strong></td>
      <td>${esc(a.acciones)}</td>
      <td>${money(a.precioCompra)}</td>
      <td>${a.precioVenta ? money(a.precioVenta) : '—'}</td>
      <td>${money(a.subtotal)}</td>
      <td class="red">-${money(a.comision)}</td>
      <td class="${n(a.pnl) >= 0 ? 'green' : 'red'}">${a.pnl === '' ? '—' : money(a.pnl)}</td>
      <td class="${n(a.pnlPct) >= 0 ? 'green' : 'red'}">${a.pnlPct === '' ? '—' : pct(a.pnlPct)}</td>
      <td><span class="badge ${a.estado === 'Abierta' ? 'badge-green' : 'badge-gray'}">${esc(a.estado)}</span></td>
      <td>${dateText(a.fechaCierre)}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function opcionesTable(rows) {
  return `<div class="tbl-wrap"><table>
    <thead><tr><th>Empresa</th><th>Tipo</th><th>Strike</th><th>Contratos</th><th>Prima C.</th><th>Prima V.</th><th>Subtotal</th><th>Comisión</th><th>P&L</th><th>Estado</th><th>Venc.</th></tr></thead>
    <tbody>${rows.map(o => `<tr>
      <td><strong>${esc(o.empresa)}</strong></td>
      <td><span class="badge ${o.tipo === 'PUT' ? 'badge-red' : 'badge-blue'}">${esc(o.tipo)}</span></td>
      <td>${money(o.strike)}</td>
      <td>${esc(o.contratos)}</td>
      <td>${money(o.primaCompra)}</td>
      <td>${o.primaVenta ? money(o.primaVenta) : '—'}</td>
      <td>${money(o.subtotal)}</td>
      <td class="red">-${money(o.comision)}</td>
      <td class="${n(o.pnl) >= 0 ? 'green' : 'red'}">${o.pnl === '' ? '—' : money(o.pnl)}</td>
      <td><span class="badge ${o.estado === 'Abierta' ? 'badge-blue' : 'badge-gray'}">${esc(o.estado)}</span></td>
      <td>${dateText(o.fechaVencim)}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function tradeTable(rows) {
  return `<div class="tbl-wrap"><table>
    <thead><tr><th>Activo</th><th>Tipo</th><th>Cierre</th><th>P&L</th><th>P&L %</th><th>MXN</th></tr></thead>
    <tbody>${rows.map(t => `<tr>
      <td><strong>${esc(t.name)}</strong></td>
      <td><span class="badge ${t.tipo === 'Acción' ? 'badge-green' : 'badge-blue'}">${esc(t.tipo)}</span></td>
      <td>${dateText(t.fechaCierre)}</td>
      <td class="${n(t.pnl) >= 0 ? 'green' : 'red'}">${money(t.pnl)}</td>
      <td class="${n(t.pnlPct) >= 0 ? 'green' : 'red'}">${pct(t.pnlPct)}</td>
      <td class="${n(t.pnl) >= 0 ? 'green' : 'red'}">${mxn(t.pnl)}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function renderPlan(kind) {
  const isStocks = kind === 'acciones';
  const cap = isStocks ? n(D.config.capAcciones || 1000) : n(D.config.capOpciones || 500);
  const dailyPct = (isStocks ? n(D.config.metaAcciones || 0.03) : n(D.config.metaOpciones || 0.20)) * 100;
  const rows = buildMonthlyPlan(cap, dailyPct, 12);
  const final = rows[rows.length - 1];
  return `
    <div class="plan-btn-grid">
      <div class="plan-big-btn ${isStocks ? 'stocks' : 'options'}">
        <div class="plan-big-icon">${isStocks ? '📈' : '🎯'}</div>
        <div class="plan-big-title">${isStocks ? 'Plan de Acciones' : 'Plan de Opciones'}</div>
        <div class="plan-big-meta">Meta diaria: ${dailyPct.toFixed(2)}%</div>
        <div class="plan-big-sub">Capital base: ${money(cap)} · ${mxn(cap)}</div>
      </div>
      <div class="plan-big-btn ${isStocks ? 'stocks' : 'options'}">
        <div class="plan-big-icon">💰</div>
        <div class="plan-big-title">Proyección 12 meses</div>
        <div class="plan-big-meta">${money(final.end)}</div>
        <div class="plan-big-sub">Ganancia estimada: ${money(final.end - cap)}</div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Proyección mensual con interés compuesto</div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Mes</th><th>Inicio</th><th>Final</th><th>Ganancia</th><th>Final MXN</th><th>% mensual aprox.</th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td>Mes ${r.month}</td><td>${money(r.start)}</td><td>${money(r.end)}</td><td class="green">${money(r.gain)}</td><td>${mxn(r.end)}</td><td class="green">${r.pct.toFixed(2)}%</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>
    <div class="alert-warning">⚠️ Esta proyección no es una promesa de rendimiento; solo sirve para visualizar metas y disciplina operativa.</div>
  `;
}

function buildMonthlyPlan(capital, dailyPct, months) {
  let current = capital;
  const rows = [];
  for (let month = 1; month <= months; month++) {
    const start = current;
    current = current * Math.pow(1 + dailyPct / 100, 22);
    rows.push({ month, start, end: current, gain: current - start, pct: ((current - start) / start) * 100 });
  }
  return rows;
}

function renderSocios() {
  const total = D.socios.reduce((s, x) => s + n(x.capital), 0);
  return `
    <div class="btn-row"><button class="btn btn-green" onclick="openModal('nuevo-socio')">+ Agregar socio</button></div>
    <div class="card">
      <div class="card-title">Socios</div>
      ${D.socios.length ? `<div class="tbl-wrap"><table>
        <thead><tr><th>Socio</th><th>Capital</th><th>Participación</th><th>Ganancia</th><th>Retiros</th><th>Saldo</th><th>Notas</th></tr></thead>
        <tbody>${D.socios.map(s => {
          const participacion = s.pct ?? s.participacion ?? (total ? n(s.capital) / total : 0);
          return `<tr>
            <td><strong>${esc(s.nombre)}</strong></td>
            <td>${money(s.capital)}</td>
            <td><span class="badge badge-green">${pct(participacion)}</span></td>
            <td class="green">${money(s.ganancia)}</td>
            <td class="red">${money(s.retiros)}</td>
            <td><strong>${money(s.saldo || (n(s.capital) + n(s.ganancia) - n(s.retiros)))}</strong></td>
            <td>${esc(s.notas || '—')}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>` : '<p style="color:var(--text-muted)">Sin socios registrados.</p>'}
    </div>
  `;
}

function renderWatchlist() {
  return `
    <div class="btn-row"><button class="btn btn-green" onclick="openModal('nueva-watch')">+ Agregar ticker</button></div>
    <div class="card">
      <div class="card-title">Watchlist</div>
      ${D.watchlist.length ? `<div class="tbl-wrap"><table>
        <thead><tr><th>Ticker</th><th>Nota</th><th>Precio actual</th><th>Cambio hoy</th><th>Precio meta</th><th>Falta</th><th>Alerta</th><th></th></tr></thead>
        <tbody>${D.watchlist.map(w => `<tr>
          <td><strong>${esc(w.ticker)}</strong></td>
          <td>${esc(w.nota || '—')}</td>
          <td>${w.precioActual ? money(w.precioActual) : '—'}</td>
          <td class="${n(w.cambioHoy) >= 0 ? 'green' : 'red'}">${w.cambioHoy !== '' && w.cambioHoy !== undefined ? pct(w.cambioHoy) : '—'}</td>
          <td>${w.precioMeta ? money(w.precioMeta) : '—'}</td>
          <td>${w.faltaMeta !== '' && w.faltaMeta !== undefined ? pct(w.faltaMeta) : '—'}</td>
          <td>${esc(w.alerta || '—')}</td>
          <td><button class="btn btn-red" onclick="deleteWatch(${Number(w.rowIndex || 0)})">Eliminar</button></td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<p style="color:var(--text-muted)">Sin tickers en watchlist.</p>'}
    </div>
  `;
}

function renderReportes() {
  const d = getComputedDashboard();
  return `
    <div class="kpi-grid">
      ${kpi('Operaciones acciones', D.acciones.length, `${D.acciones.filter(a => calcAccion(a).estado === 'Abierta').length} abiertas`, 'teal')}
      ${kpi('Operaciones opciones', D.opciones.length, `${D.opciones.filter(o => calcOpcion(o).estado === 'Abierta').length} abiertas`, 'blue')}
      ${kpi('P&L acciones', money(d.pnlAcciones), mxn(d.pnlAcciones), d.pnlAcciones >= 0 ? 'teal' : 'red')}
      ${kpi('P&L opciones', money(d.pnlOpciones), mxn(d.pnlOpciones), d.pnlOpciones >= 0 ? 'blue' : 'red')}
    </div>
    <div class="card">
      <div class="card-title">Lectura rápida</div>
      <p style="color:var(--text-muted);line-height:1.6">
        Capital base: <strong>${money(D.config.capAcciones + D.config.capOpciones)}</strong> ·
        P&L total: <strong class="${d.pnlTotal >= 0 ? 'green' : 'red'}">${money(d.pnlTotal)}</strong> ·
        Rendimiento acumulado: <strong>${pct(d.rendimiento)}</strong>.
      </p>
    </div>
  `;
}

// ── Modals / actions ──────────────────────────────────────────
function openModal(type) {
  const box = $('modal-box');
  const overlay = $('modal-overlay');

  if (type === 'cap-acc' || type === 'cap-opc' || type === 'retiro') {
    const title = type === 'retiro' ? 'Registrar retiro' : `Agregar capital — ${type === 'cap-acc' ? 'Acciones' : 'Opciones'}`;
    const button = type === 'retiro' ? 'Registrar retiro' : 'Guardar capital';
    box.innerHTML = `<div class="modal-title">${title}</div>
      ${type === 'retiro' ? `<div class="form-group" style="margin-bottom:12px"><label>Cuenta</label><select id="m-tipo"><option value="retiro_acciones">Acciones</option><option value="retiro_opciones">Opciones</option></select></div>` : ''}
      <div class="form-group"><label>Monto USD</label><input type="number" id="m-monto" step="0.01" placeholder="1000.00"></div>
      <div class="modal-footer"><button class="btn ${type === 'retiro' ? 'btn-red' : 'btn-green'}" onclick="doCapital('${type}')">${button}</button><button class="btn" onclick="closeModal()">Cancelar</button></div>`;
  }

  if (type === 'nueva-pos') {
    box.innerHTML = `<div class="modal-title">Agregar posición</div>
      <div class="form-grid">
        <div class="form-group"><label>Tipo de operación</label><select id="m-pos-tipo" onchange="renderPositionFields()"><option value="accion">Acción</option><option value="opcion">Opción</option></select></div>
        <div class="form-group"><label>Ticker / Empresa</label><input type="text" id="m-ticker" style="text-transform:uppercase" placeholder="AAPL"></div>
        <div class="form-group"><label>Fecha apertura</label><input type="date" id="m-fecha" value="${todayISO}"></div>
      </div>
      <div id="position-fields"></div>
      <div class="modal-footer"><button class="btn btn-green" onclick="addPosition()">Agregar</button><button class="btn" onclick="closeModal()">Cancelar</button></div>`;
    overlay.classList.remove('hidden');
    renderPositionFields();
    return;
  }

  if (type === 'cerrar-pos') {
    const abiertas = [
      ...D.acciones.map(calcAccion).filter(a => a.estado === 'Abierta').map(a => ({ kind: 'accion', id: a.ticker, label: `${a.ticker} — ${a.acciones} acciones`, ticker: a.ticker })),
      ...D.opciones.map(calcOpcion).filter(o => o.estado === 'Abierta').map(o => ({ kind: 'opcion', id: `${o.empresa}_${o.strike}_${o.tipo}`, label: `${o.empresa} ${o.tipo} ${money(o.strike)} — ${o.contratos} ct`, empresa: o.empresa }))
    ];
    box.innerHTML = `<div class="modal-title">Cerrar posición</div>
      ${abiertas.length ? `<div class="form-grid">
        <div class="form-group"><label>Posición</label><select id="m-close-id">${abiertas.map((p, i) => `<option value="${i}">${esc(p.label)}</option>`).join('')}</select></div>
        <div class="form-group"><label>Precio de venta / salida</label><input type="number" id="m-close-price" step="0.01"></div>
        <div class="form-group"><label>Comisión cierre</label><input type="number" id="m-close-comm" step="0.01" value="0"></div>
        <div class="form-group"><label>Fecha cierre</label><input type="date" id="m-close-date" value="${todayISO}"></div>
      </div>
      <div class="modal-footer"><button class="btn btn-red" onclick='closePosition(${JSON.stringify(abiertas)})'>Cerrar</button><button class="btn" onclick="closeModal()">Cancelar</button></div>` : `<p style="color:var(--text-muted)">No hay posiciones abiertas.</p><div class="modal-footer"><button class="btn" onclick="closeModal()">Cerrar</button></div>`}`;
  }

  if (type === 'nuevo-socio') {
    box.innerHTML = `<div class="modal-title">Agregar socio</div>
      <div class="form-grid">
        <div class="form-group"><label>Nombre</label><input type="text" id="m-socio-nombre"></div>
        <div class="form-group"><label>Capital USD</label><input type="number" id="m-socio-capital" step="0.01"></div>
        <div class="form-group"><label>Fecha ingreso</label><input type="date" id="m-socio-fecha" value="${todayISO}"></div>
        <div class="form-group"><label>Notas</label><input type="text" id="m-socio-notas"></div>
      </div>
      <div class="modal-footer"><button class="btn btn-green" onclick="addSocio()">Guardar</button><button class="btn" onclick="closeModal()">Cancelar</button></div>`;
  }

  if (type === 'nueva-watch') {
    box.innerHTML = `<div class="modal-title">Agregar ticker a Watchlist</div>
      <div class="form-grid">
        <div class="form-group"><label>Ticker</label><input type="text" id="m-watch-ticker" style="text-transform:uppercase" placeholder="TSLA"></div>
        <div class="form-group"><label>Precio meta</label><input type="number" id="m-watch-meta" step="0.01"></div>
        <div class="form-group"><label>Nota</label><input type="text" id="m-watch-nota"></div>
      </div>
      <div class="modal-footer"><button class="btn btn-green" onclick="addWatch()">Guardar</button><button class="btn" onclick="closeModal()">Cancelar</button></div>`;
  }

  overlay.classList.remove('hidden');
}

function closeModal() {
  $('modal-overlay').classList.add('hidden');
}

function renderPositionFields() {
  const type = $('m-pos-tipo').value;
  const el = $('position-fields');
  if (type === 'accion') {
    el.innerHTML = `<div class="form-grid">
      <div class="form-group"><label>Número de acciones</label><input type="number" id="m-acciones"></div>
      <div class="form-group"><label>Precio compra</label><input type="number" id="m-precio-compra" step="0.01"></div>
      <div class="form-group"><label>Comisión</label><input type="number" id="m-comision" step="0.01" value="0"></div>
    </div>`;
  } else {
    el.innerHTML = `<div class="form-grid">
      <div class="form-group"><label>Tipo</label><select id="m-opcion-tipo"><option>CALL</option><option>PUT</option></select></div>
      <div class="form-group"><label>Strike</label><input type="number" id="m-strike" step="0.5"></div>
      <div class="form-group"><label>Contratos</label><input type="number" id="m-contratos"></div>
      <div class="form-group"><label>Prima compra</label><input type="number" id="m-precio-compra" step="0.01"></div>
      <div class="form-group"><label>Fecha vencimiento</label><input type="date" id="m-vencimiento"></div>
      <div class="form-group"><label>Comisión</label><input type="number" id="m-comision" step="0.01" value="0"></div>
    </div>`;
  }
}

async function doCapital(type) {
  const amount = n($('m-monto').value);
  if (!amount || amount <= 0) return showToast('Ingresa un monto válido.', 'error');
  const tipo = type === 'cap-acc' ? 'deposito_acciones' : type === 'cap-opc' ? 'deposito_opciones' : $('m-tipo').value;
  await api('saveCapital', { tipo, monto: amount });
  closeModal();
  await syncAll();
}

async function addPosition() {
  const kind = $('m-pos-tipo').value;
  const ticker = $('m-ticker').value.trim().toUpperCase();
  const fecha = $('m-fecha').value || todayISO;
  const precio = n($('m-precio-compra').value);
  const comision = n($('m-comision').value);
  if (!ticker || !precio) return showToast('Completa ticker y precio.', 'error');

  if (kind === 'accion') {
    const acciones = n($('m-acciones').value);
    if (!acciones) return showToast('Ingresa número de acciones.', 'error');
    await api('saveAccion', { fechaCompra: fecha, ticker, acciones, precioCompra: precio, comision });
  } else {
    const strike = n($('m-strike').value);
    const contratos = n($('m-contratos').value);
    if (!strike || !contratos) return showToast('Completa strike y contratos.', 'error');
    await api('saveOpcion', {
      empresa: ticker,
      strike,
      tipo: $('m-opcion-tipo').value,
      contratos,
      primaCompra: precio,
      comision,
      fechaApertura: fecha,
      fechaVencim: $('m-vencimiento').value
    });
  }

  closeModal();
  await syncAll();
}

async function closePosition(openItems) {
  const item = openItems[n($('m-close-id').value)];
  const price = n($('m-close-price').value);
  const comm = n($('m-close-comm').value);
  const date = $('m-close-date').value || todayISO;
  if (!item || !price) return showToast('Ingresa precio de salida.', 'error');

  if (item.kind === 'accion') {
    await api('closeAccion', { ticker: item.ticker, precioVenta: price, comisionCierre: comm, fechaCierre: date });
  } else {
    await api('closeOpcion', { empresa: item.empresa, primaVenta: price, comisionCierre: comm, fechaCierre: date });
  }
  closeModal();
  await syncAll();
}

async function addSocio() {
  const nombre = $('m-socio-nombre').value.trim();
  const capital = n($('m-socio-capital').value);
  if (!nombre || !capital) return showToast('Nombre y capital son requeridos.', 'error');
  await api('saveSocio', {
    nombre,
    capital,
    fechaIngreso: $('m-socio-fecha').value || todayISO,
    notas: $('m-socio-notas').value || ''
  });
  closeModal();
  await syncAll();
}

async function addWatch() {
  const ticker = $('m-watch-ticker').value.trim().toUpperCase();
  if (!ticker) return showToast('Ingresa un ticker.', 'error');
  await api('saveWatch', {
    ticker,
    precioMeta: n($('m-watch-meta').value),
    nota: $('m-watch-nota').value || ''
  });
  closeModal();
  await syncAll();
}

async function deleteWatch(rowIndex) {
  if (!rowIndex) return showToast('No se encontró la fila del ticker.', 'error');
  await api('deleteWatch', { rowIndex });
  await syncAll();
}

function showToast(message, type = 'success') {
  const toast = $('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.add('hidden'), 3500);
}

// ── Demo ──────────────────────────────────────────────────────
function loadDemoData() {
  D.config = normalizeConfig({
    nombre: 'EVA Demo',
    capAcciones: 1000,
    capOpciones: 500,
    metaAcciones: 0.03,
    metaOpciones: 0.20,
    meses: 12,
    tipoCambio: 17.5
  });
  FX = 17.5;
  D.acciones = [
    calcAccion({ fechaCompra: '2026-05-01', ticker: 'AAPL', acciones: 10, precioCompra: 170, precioVenta: 181, comision: 1.3, estado: 'Cerrada', fechaCierre: '2026-05-10' }),
    calcAccion({ fechaCompra: '2026-05-12', ticker: 'NVDA', acciones: 5, precioCompra: 880, precioVenta: '', comision: 0.65, estado: 'Abierta' })
  ];
  D.opciones = [
    calcOpcion({ empresa: 'SPY', strike: 520, tipo: 'CALL', contratos: 2, primaCompra: 3.5, primaVenta: 5.8, comision: 1.3, estado: 'Cerrada', fechaApertura: '2026-05-05', fechaCierre: '2026-05-09', fechaVencim: '2026-05-16' }),
    calcOpcion({ empresa: 'AAPL', strike: 185, tipo: 'CALL', contratos: 1, primaCompra: 2.2, primaVenta: '', comision: 0.65, estado: 'Abierta', fechaApertura: '2026-05-13', fechaVencim: '2026-05-17' })
  ];
  D.socios = [
    { nombre: 'Luis', capital: 1500, pct: 0.75, ganancia: 97.5, retiros: 0, saldo: 1597.5, notas: 'Principal' },
    { nombre: 'Socio demo', capital: 500, pct: 0.25, ganancia: 32.5, retiros: 0, saldo: 532.5, notas: 'Demo' }
  ];
  D.watchlist = [
    { rowIndex: 4, ticker: 'TSLA', nota: 'Esperar ruptura', precioActual: 175, cambioHoy: 0.02, precioMeta: 200, faltaMeta: 0.14, alerta: 'Esperando' }
  ];
  D.dashboard = getComputedDashboard();
}

function getDemoResponse(action, data) {
  const map = {
    getConfig: D.config,
    getDashboard: getComputedDashboard(),
    getAcciones: { acciones: D.acciones },
    getOpciones: { opciones: D.opciones },
    getSocios: { socios: D.socios },
    getWatchlist: { watchlist: D.watchlist }
  };
  return map[action] || { ok: true, data };
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('eva_api_url');
  if (saved) {
    API_URL = saved;
    $('script-url').value = saved;
    startApp();
  }
  $('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeModal();
  });
});
