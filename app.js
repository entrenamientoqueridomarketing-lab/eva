// ============================================================
// EVA — app.js v25
// Fixes: config.js + token, capital asignado al plan, pendiente de liberar y capital liberado integrado.
//        Los trades viejos abiertos ya no inflan el plan hasta que se cierran e integran.
// ============================================================

const EVA_VERSION = 'v25';
const EVA_CONFIG = window.EVA_CONFIG || {};
// La URL y el token deben vivir en config.js para no tocar app.js en futuras versiones.
const DEFAULT_API_URL = String(EVA_CONFIG.API_URL || '').trim();
const DEFAULT_ACCESS_TOKEN = String(EVA_CONFIG.ACCESS_TOKEN || '').trim();
const DEFAULT_USER_NAME = 'Luis';
let API_URL = (DEFAULT_API_URL && DEFAULT_API_URL.includes('script.google.com')) ? DEFAULT_API_URL : '';
let API_TOKEN = DEFAULT_ACCESS_TOKEN || localStorage.getItem('eva_api_token') || '';
let FX = 17.5;
let currentPage = 'dashboard';
let selectedPlanMonth = {};
let selectedPlanDay   = {};
let currentPlanContext = null;
let lastCloseMsg = null;
let chartInstances = {};

const D = { config: {}, acciones: [], opciones: [], socios: [], cuentas: [], watchlist: [] };

// ── Util ─────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
function localISO(d = new Date()) {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
const todayISO = localISO(new Date());

function n(v) {
  if (v === '' || v == null) return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v).trim();
  if (!s) return 0;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[$,%\s]/g, '').replace(/,/g, '');
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  const x = Number(s);
  return isFinite(x) ? (neg ? -Math.abs(x) : x) : 0;
}
function safePct(v, def) {
  let x = Number(v);
  if (!isFinite(x) || x < 0) return def;
  // Si viene como 3 en vez de 0.03, lo convertimos a 3%.
  if (x > 1 && x <= 100) x = x / 100;
  // Si viene corrupto desde Sheets, evitamos explosiones de números.
  if (x > 5) return def;
  return x;
}
function safeMoney(v, def = 0) {
  const x = Number(v);
  if (!isFinite(x) || x < 0 || x > 1000000000) return def;
  return x;
}
function isCounted(t) {
  if (!t) return true;
  if (t.contabiliza === false) return false;
  const v = String(t.contabiliza ?? '').trim().toLowerCase();
  return !(v === 'no' || v === 'false' || v === '0' || v === 'no contabilizar');
}
function counted(list) { return (list || []).filter(isCounted); }
function isCapitalReleaseToPlan(t) {
  const v = String(t?.planTipo || '').trim().toLowerCase();
  return v.includes('liberado') || v.includes('capital_liberado') || v.includes('release');
}
function isIncludedInPlan(t) {
  if (!isCounted(t)) return false;
  const v = String(t?.planTipo || '').trim().toLowerCase();
  if (!v || v === 'fuera_plan' || v === 'excluir' || v === 'excluido' || v === 'no_plan' || v === 'no plan') return false;
  return v === 'acciones' || v === 'opciones' || isCapitalReleaseToPlan(t);
}
function planIncludeText(t) {
  if (isCapitalReleaseToPlan(t)) return 'Capital liberado';
  return isIncludedInPlan(t) ? 'Incluido' : 'Pendiente / fuera del plan';
}
function esc(v) { return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function money(v) {
  if (v === '' || v == null) return '—';
  const num = n(v);
  return (num < 0 ? '-$' : '$') + Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function mxn(v) { return v === '' || v == null ? '—' : money(n(v) * FX) + ' MXN'; }
function pct(v) {
  if (v === '' || v == null) return '—';
  const num = n(v);
  return (num >= 0 ? '+' : '') + (num * 100).toFixed(2) + '%';
}
function dateText(v) {
  if (!v) return '—';
  const raw = String(v);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(raw + 'T12:00:00') : new Date(v);
  return isNaN(d) ? esc(v) : d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}
function isPlaceholderName(value) {
  const v = String(value || '').trim().toLowerCase();
  return !v || v === 'tu nombre' || v === 'nombre' || v === 'trader';
}
function displayName() {
  const sheetName = String(D.config.nombre || '').trim();
  const savedName = String(localStorage.getItem('eva_nombre') || '').trim();
  if (!isPlaceholderName(sheetName)) return sheetName;
  if (!isPlaceholderName(savedName)) return savedName;
  return 'Configura tu nombre';
}
function cfg() {
  const c = D.config || {};
  const capAcc = safeMoney(c.capAcciones ?? c.capitalAcciones, 0);
  const capOpc = safeMoney(c.capOpciones ?? c.capitalOpciones, 0);
  const usoAcc = safePct(c.usoCapitalAcciones != null ? c.usoCapitalAcciones : 1, 1) || 1;
  const usoOpc = safePct(c.usoCapitalOpciones != null ? c.usoCapitalOpciones : 0.33, 0.33) || 0.33;
  const planCapAcc = safeMoney(c.planCapitalAcciones, capAcc * usoAcc || 1000) || capAcc * usoAcc || 1000;
  const planCapOpc = safeMoney(c.planCapitalOpciones, capOpc || 500) || capOpc || 500;
  const metaMaxAcc = safePct(c.planMetaMaxAcciones ?? c.metaAcciones, 0.03);
  const metaMaxOpc = safePct(c.planMetaMaxOpciones ?? c.metaOpciones, 0.20);
  const metaMinAcc = Math.min(safePct(c.planMetaMinAcciones, 0.01), metaMaxAcc || 0.03);
  const metaMinOpc = Math.min(safePct(c.planMetaMinOpciones, 0.10), metaMaxOpc || 0.20);
  return {
    nombre: displayName(),
    capAcc,
    capOpc,
    metaAcc: metaMaxAcc,
    metaOpc: metaMaxOpc,
    metaMinAcc,
    metaMaxAcc,
    metaMinOpc,
    metaMaxOpc,
    planCapAcc,
    planCapOpc,
    planInicioAcc: c.planFechaInicioAcciones || c.fechaInicioAcciones || todayISO,
    planInicioOpc: c.planFechaInicioOpciones || c.fechaInicioOpciones || todayISO,
    meses: Math.max(1, Math.min(60, Math.round(n(c.meses || 12)))),
    diasMes: Math.max(1, Math.min(31, Math.round(n(c.diasMes || 20)))),
    usoAcc,
    usoOpc,
    fx: safeMoney(c.tipoCambio, FX) || FX,
    operacionesSemanaOpciones: Math.max(1, Math.min(10, Math.round(n(c.operacionesSemanaOpciones || c.frecuenciaOpcionesSemana || 3)))),
  };
}
function arr(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload[key])) return payload[key];
  return [];
}
function calcA(a) {
  const acc = n(a.acciones), cp = n(a.precioCompra), cv = n(a.precioVenta), com = n(a.comision);
  const sub = n(a.subtotal) || acc * cp;
  const ing = cv ? acc * cv : 0;
  const estado = a.estado || (cv ? 'Cerrada' : 'Abierta');
  const pnlVal = (a.pnl !== '' && a.pnl != null) ? n(a.pnl) : (cv ? ing - sub - com : '');
  const pnlP   = (a.pnlPct !== '' && a.pnlPct != null) ? n(a.pnlPct) : (cv && sub ? n(pnlVal) / sub : '');
  return { ...a, acciones: acc, precioCompra: cp, comision: com, subtotal: sub, ingresosVenta: ing, estado, pnl: pnlVal, pnlPct: pnlP, contabiliza: a.contabiliza !== false };
}
function calcO(o) {
  const ct = n(o.contratos), pb = n(o.primaCompra), pv = n(o.primaVenta), com = n(o.comision);
  const sub = n(o.subtotal) || ct * pb * 100;
  const ing = pv ? ct * pv * 100 : 0;
  const estado = o.estado || (pv ? 'Cerrada' : 'Abierta');
  const pnlVal = (o.pnl !== '' && o.pnl != null) ? n(o.pnl) : (pv ? ing - sub - com : '');
  const pnlP   = (o.pnlPct !== '' && o.pnlPct != null) ? n(o.pnlPct) : (pv && sub ? n(pnlVal) / sub : '');
  return { ...o, contratos: ct, primaCompra: pb, comision: com, subtotal: sub, ingresos: ing, estado, pnl: pnlVal, pnlPct: pnlP, contabiliza: o.contabiliza !== false };
}

function marketPriceAcc(a) {
  const p = n(a.precioActual);
  return p > 0 ? p : 0;
}
function marketValueAcc(a) {
  const p = marketPriceAcc(a);
  return p > 0 ? n(a.acciones) * p : n(a.subtotal);
}
function unrealizedAcc(a) {
  if (a.estado !== 'Abierta' || !a.contabiliza) return 0;
  const p = marketPriceAcc(a);
  if (!p) return 0;
  return n(a.acciones) * p - n(a.subtotal) - n(a.comision);
}
function accountNameDefault() {
  return (D.cuentas && D.cuentas[0] && D.cuentas[0].nombre) ? D.cuentas[0].nombre : 'Charles Schwab';
}
function ensureLocalDefaultAccount() {
  if (!D.cuentas || !D.cuentas.length) {
    const c = cfg();
    D.cuentas = [{ nombre:'Charles Schwab', tipo:'Broker', moneda:'USD', cuentaPadre:'', estrategia:'Mixta', saldoConciliado:c.capAcc+c.capOpc, capitalOcupado:0, disponible:c.capAcc+c.capOpc, activa:'SI' }];
  }
}

// ── Lectura real de cuenta ───────────────────────────────────
function activeAccounts() {
  return (D.cuentas || []).filter(c => String(c.activa || 'SI').toUpperCase() !== 'NO');
}
function cuentaDisponibleReal() {
  const cuentas = activeAccounts();
  if (!cuentas.length) return null;
  // Este valor debe representar el efectivo/buying power real capturado o conciliado.
  return cuentas.reduce((s,c) => s + n(c.disponible), 0);
}
function openTargetProfitAcc(a) {
  if (!a || a.estado !== 'Abierta' || !isCounted(a)) return 0;
  return targetExit(a, true).pnl;
}
function openTargetProfitOpc(o) {
  if (!o || o.estado !== 'Abierta' || !isCounted(o)) return 0;
  return targetExit(o, false).pnl;
}
function openTargetProfitAll(openAcc, openOpc) {
  return (openAcc || []).reduce((s,a)=>s+openTargetProfitAcc(a),0) + (openOpc || []).reduce((s,o)=>s+openTargetProfitOpc(o),0);
}

// ── API (JSONP para evitar CORS) ─────────────────────────────
function api(action, data = {}) {
  if (API_URL === 'DEMO') return Promise.resolve(demoResp(action, data));
  return new Promise((resolve, reject) => {
    const cb = `__eva_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const payload = encodeURIComponent(JSON.stringify({ action, evaToken: API_TOKEN || '', ...data }));
    const url = `${API_URL}?action=${encodeURIComponent(action)}&payload=${payload}&callback=${cb}&_=${Date.now()}`;
    const script = document.createElement('script');
    let done = false;
    const cleanup = () => { done = true; try { delete window[cb]; } catch(e) {} script.remove(); };
    const timer = setTimeout(() => { if(done) return; cleanup(); reject(new Error('Apps Script no respondió. Verifica la URL /exec y que el acceso sea "Cualquier persona".')); }, 20000);
    window[cb] = json => {
      if (done) return; clearTimeout(timer); cleanup();
      if (!json || json.ok === false) { reject(new Error((json && json.error) || 'Error en Apps Script')); return; }
      resolve(json.data !== undefined ? json.data : json);
    };
    script.onerror = () => { if(done) return; clearTimeout(timer); cleanup(); reject(new Error('Error de red al contactar Apps Script.')); };
    script.src = url;
    document.body.appendChild(script);
  });
}

async function syncAll() {
  const btn = document.querySelector('.sync-btn');
  if (btn) { btn.style.opacity = '.4'; btn.style.pointerEvents = 'none'; }
  try {
    const [cfg_r, acc, opc, socios, cuentas, watch] = await Promise.all([
      api('getConfig'), api('getAcciones'), api('getOpciones'), api('getSocios'), api('getCuentas'), api('getWatchlist')
    ]);
    D.config  = cfg_r || {};
    const savedName = String(localStorage.getItem('eva_nombre') || '').trim();
    if (!isPlaceholderName(savedName) && isPlaceholderName(D.config.nombre)) {
      try {
        await api('saveConfig', { nombre: savedName });
        D.config.nombre = savedName;
      } catch(e) { console.warn('No se pudo guardar el nombre inicial:', e); }
    }
    D.acciones = arr(acc, 'acciones').map(calcA);
    D.opciones = arr(opc, 'opciones').map(calcO);
    D.socios   = arr(socios, 'socios');
    D.cuentas  = arr(cuentas, 'cuentas');
    ensureLocalDefaultAccount();
    D.watchlist= arr(watch, 'watchlist');
    FX = n(D.config.tipoCambio) || FX;
    renderAll();
    updateLiveFX(true);
    showToast('Datos sincronizados.', 'success');
  } catch(e) {
    console.error(e);
    showToast(e.message || 'Error al sincronizar.', 'error');
  } finally {
    if (btn) { btn.style.opacity = ''; btn.style.pointerEvents = ''; }
  }
}

// ── Setup ────────────────────────────────────────────────────
function setupNext() {
  const nombre = $('setup-nombre').value.trim() || DEFAULT_USER_NAME || 'Luis';
  D.config.nombre = nombre;
  localStorage.setItem('eva_nombre', nombre);
  if (API_URL) { startApp(true); return; }
  $('setup-step-1').classList.add('hidden');
  $('setup-step-2').classList.remove('hidden');
}
function setupBack() {
  $('setup-step-2').classList.add('hidden');
  $('setup-step-1').classList.remove('hidden');
}
function saveScriptUrl() {
  const url = $('script-url').value.trim();
  const token = $('script-token') ? $('script-token').value.trim() : '';
  if (!url.includes('script.google.com')) { showToast('URL inválida. Debe ser de Google Apps Script.', 'error'); return; }
  API_URL = url;
  API_TOKEN = token;
  localStorage.setItem('eva_api_url', url);
  localStorage.setItem('eva_api_token', token);
  localStorage.setItem('eva_nombre', D.config.nombre || DEFAULT_USER_NAME || '');
  startApp(true);
}
function loadDemo() {
  API_URL = 'DEMO';
  API_TOKEN = '';
  localStorage.removeItem('eva_api_url');
  localStorage.removeItem('eva_api_token');
  loadDemoData();
  startApp(false);
}
function startApp(shouldSync) {
  $('setup-screen').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('header-date').textContent = new Date().toLocaleDateString('es-MX', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  if (shouldSync) syncAll(); else { ensureLocalDefaultAccount(); renderAll(); updateLiveFX(false); }
}
function showSetup() {
  $('app').classList.add('hidden');
  $('setup-screen').classList.remove('hidden');
  $('setup-step-1').classList.remove('hidden');
  $('setup-step-2').classList.add('hidden');
  const saved = DEFAULT_API_URL || localStorage.getItem('eva_api_url');
  const savedToken = DEFAULT_ACCESS_TOKEN || localStorage.getItem('eva_api_token') || '';
  if (saved) $('script-url').value = saved;
  if ($('script-token')) $('script-token').value = savedToken;
  const nombre = localStorage.getItem('eva_nombre') || DEFAULT_USER_NAME;
  if (nombre) $('setup-nombre').value = nombre;
}

// ── Navigation ───────────────────────────────────────────────
function showPage(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  const titles = { dashboard:'Dashboard', capital:'Capital', posiciones:'Posiciones', trades:'Trades', 'plan-acciones':'Plan Acciones', 'plan-opciones':'Plan Opciones', socios:'Inversionistas', cuentas:'Cuentas/Subcuentas', watchlist:'Watchlist', importador:'Conciliación Bancaria', reportes:'Reportes' };
  $('page-title').textContent = titles[page] || page;
  $('sidebar').classList.remove('open');
  Object.values(chartInstances).forEach(c => { try { c.destroy(); } catch(e) {} });
  chartInstances = {};
  renderPage();
}
function toggleSidebar() { $('sidebar').classList.toggle('open'); }
function renderAll() {
  const c = cfg();
  const welcome = `¡Bienvenido, ${c.nombre}!`;
  $('sidebar-welcome').textContent = welcome;
  $('nav-fx').textContent = `USD/MXN $${FX.toFixed(2)}`;
  $('header-fx').textContent = `USD/MXN $${FX.toFixed(2)}`;
  renderPage();
}
function renderPage() {
  const renders = {
    dashboard: renderDashboard, capital: renderCapital,
    posiciones: renderPosiciones, trades: renderTrades,
    'plan-acciones': () => renderPlan('acciones'),
    'plan-opciones': () => renderPlan('opciones'),
    socios: renderSocios, cuentas: renderCuentas, watchlist: renderWatchlist,
    importador: renderImportador, reportes: renderReportes
  };
  $('page-content').innerHTML = (renders[currentPage] || renderDashboard)();
  // Post-render charts
  if (currentPage === 'plan-acciones') setTimeout(() => drawPlanChart('acciones'), 50);
  if (currentPage === 'plan-opciones') setTimeout(() => drawPlanChart('opciones'), 50);
  if (currentPage === 'reportes') setTimeout(() => drawReportChart(), 50);
}

function kpi(label, value, sub = '', tone = '') {
  return `<div class="kpi ${tone}"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${value}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;
}

// ── Dashboard ────────────────────────────────────────────────
function getDash() {
  const c = cfg();
  const closedAcc = counted(D.acciones).filter(a => a.estado === 'Cerrada');
  const closedOpc = counted(D.opciones).filter(o => o.estado === 'Cerrada');
  const openAcc = counted(D.acciones).filter(a => a.estado === 'Abierta');
  const openOpc = counted(D.opciones).filter(o => o.estado === 'Abierta');
  const pnlAcc = closedAcc.reduce((s,a) => s + n(a.pnl), 0);
  const pnlOpc = closedOpc.reduce((s,o) => s + n(o.pnl), 0);
  const pnl = pnlAcc + pnlOpc;
  const base = c.capAcc + c.capOpc;
  const ocupadoAcc = openAcc.reduce((s,a) => s + n(a.subtotal), 0);
  const ocupadoOpc = openOpc.reduce((s,o) => s + n(o.subtotal), 0);
  const ocupado = ocupadoAcc + ocupadoOpc;
  const unrealAcc = openAcc.reduce((s,a) => s + unrealizedAcc(a), 0);
  // Las opciones no tienen cotización automática confiable con GOOGLEFINANCE; su flotante queda en 0 hasta capturarlo/manual o cerrarlas.
  const unrealOpc = 0;
  const flotante = unrealAcc + unrealOpc;
  const capitalConsolidado = base + pnl;                  // Histórico interno: capital configurado + P&L cerrado.
  const disponibleCuenta = cuentaDisponibleReal();
  const disponibleReal = disponibleCuenta == null ? Math.max(0, capitalConsolidado - ocupado) : Math.max(0, disponibleCuenta);
  const metaPendiente = openTargetProfitAll(openAcc, openOpc);
  const capitalTotalEstrategico = disponibleReal + ocupado; // Disponible real + capital que está dentro de posiciones abiertas.
  const valorTotalEstimado = disponibleReal + ocupado + flotante; // Marcado a mercado: disponible + valor actual estimado de posiciones.
  const capitalPotencialObjetivo = disponibleReal + ocupado + metaPendiente; // Si las abiertas cierran en su meta configurada.
  const comm = [...counted(D.acciones), ...counted(D.opciones)].reduce((s,x) => s + n(x.comision), 0);
  return {
    capAcc: c.capAcc, capOpc: c.capOpc,
    base, capitalConsolidado,
    capitalReinvertible: disponibleReal, disponibleReal,
    ocupado, ocupadoAcc, ocupadoOpc,
    capitalTotalEstrategico, capitalPotencialObjetivo, metaPendiente,
    valorTotalEstimado,
    capTotal: valorTotalEstimado, capTotalBook: capitalConsolidado,
    pnlAcc, pnlOpc, pnl,
    unrealAcc, unrealOpc, unreal: flotante, flotante,
    pnlTotalMercado: pnl + flotante,
    comm,
    rend: base ? (pnl + flotante) / base : 0
  };
}
function getPeriod(period) {
  const now = new Date();
  let from = new Date(0);
  if (period === 'hoy') from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  else if (period === 'semana') { from = new Date(now.getFullYear(), now.getMonth(), now.getDate()); from.setDate(from.getDate() - from.getDay()); }
  else if (period === 'mes')  from = new Date(now.getFullYear(), now.getMonth(), 1);
  else if (period === 'anio') from = new Date(now.getFullYear(), 0, 1);
  const ok = dv => { const d = new Date(dv); return !isNaN(d) && d >= from; };
  const pA = counted(D.acciones).filter(a => a.estado==='Cerrada' && ok(a.fechaCierre)).reduce((s,a) => s+n(a.pnl), 0);
  const pO = counted(D.opciones).filter(o => o.estado==='Cerrada' && ok(o.fechaCierre)).reduce((s,o) => s+n(o.pnl), 0);
  return { pnlAcc: pA, pnlOpc: pO, total: pA + pO };
}

function renderDashboard() {
  const d = getDash();
  const openAcc = D.acciones.filter(a => a.estado === 'Abierta');
  const openOpc = D.opciones.filter(o => o.estado === 'Abierta');
  const closed10 = [...D.acciones.map(a=>({...a,kind:'acc',name:a.ticker})), ...D.opciones.map(o=>({...o,kind:'opc',name:o.empresa}))]
    .filter(x => x.estado === 'Cerrada')
    .sort((a,b) => new Date(b.fechaCierre||0) - new Date(a.fechaCierre||0))
    .slice(0, 10);
  const alerts = D.opciones.filter(o => o.estado==='Abierta' && o.fechaVencim)
    .map(o => ({ ...o, days: Math.ceil((new Date(o.fechaVencim) - new Date()) / 86400000) }))
    .filter(o => o.days >= 0 && o.days <= 3);
  const hoy = getPeriod('hoy'), sem = getPeriod('semana'), mes = getPeriod('mes');

  return `
    ${alerts.map(o => `<div class="alert-warn">⚠️ <strong>${esc(o.empresa)}</strong> ${esc(o.tipo)} $${o.strike} — vence en <strong>${o.days} día(s)</strong> (${esc(o.fechaVencim)})</div>`).join('')}
    ${lastCloseMsg ? `<div class="message-card ${lastCloseMsg.kind}">${lastCloseMsg.text}</div>` : ''}
    <div class="alert-info"><strong>Lectura de capital:</strong> Disponible real = buying power capturado en tu cuenta. En cada plan verás capital asignado, capital usado, capital libre y capital pendiente de liberar. Flotante = ganancia/pérdida temporal de posiciones abiertas.</div>

    <div class="btn-row">
      <button class="btn btn-green" onclick="openPlanQuestion('acciones')">+ Trade acciones</button>
      <button class="btn btn-blue"  onclick="openPlanQuestion('opciones')">+ Trade opciones</button>
      <button class="btn btn-red"   onclick="openModal('cerrar-pos')">✕ Cerrar posición</button>
      <button class="btn"           onclick="openModal('config')">⚙ Configuración</button>
    </div>

    <div class="kpi-grid">
      ${kpi('Disponible real', money(d.disponibleReal), `${mxn(d.disponibleReal)} · libre para operar hoy`, d.disponibleReal>=0?'teal':'red')}
      ${kpi('Capital ocupado', money(d.ocupado), `${openAcc.length + openOpc.length} posición(es) abierta(s)`, d.ocupado>0?'amber':'teal')}
      ${kpi('Capital total estratégico', money(d.capitalTotalEstrategico), 'Disponible + capital dentro de posiciones', 'blue')}
      ${kpi('Ganancia/Pérdida flotante', money(d.flotante), `${mxn(d.flotante)} · acciones semi-real`, d.flotante>=0?'teal':'red')}
      ${kpi('Valor estimado actual', money(d.valorTotalEstimado), 'Disponible + posiciones valuadas', d.valorTotalEstimado>=0?'teal':'red')}
      ${kpi('Capital potencial al objetivo', money(d.capitalPotencialObjetivo), `Meta pendiente: ${money(d.metaPendiente)}`, d.capitalPotencialObjetivo>=0?'teal':'red')}
      ${kpi('P&L cerrado', money(d.pnl), mxn(d.pnl), n(d.pnl) >= 0 ? 'teal' : 'red')}
      ${kpi('Capital asignado al plan', money(d.capitalConsolidado), 'Base del plan + P&L cerrado + capital liberado integrado', 'blue')}
      ${kpi('Rendimiento estimado', pct(d.rend), '', n(d.rend) >= 0 ? 'amber' : 'red')}
      ${kpi('Comisiones pagadas', '-' + money(d.comm), '', 'red')}
    </div>

    <div class="period-grid">
      ${[['Hoy', hoy], ['Esta semana', sem], ['Este mes', mes]].map(([lbl, p]) => `
        <div class="period-card">
          <div class="period-label">${lbl}</div>
          <div class="period-row"><span>Acciones</span><span class="${p.pnlAcc>=0?'green':'red'}">${money(p.pnlAcc)}</span></div>
          <div class="period-row"><span>Opciones</span><span class="${p.pnlOpc>=0?'green':'red'}">${money(p.pnlOpc)}</span></div>
          <div class="period-row"><span>Neto</span><span class="${p.total>=0?'green':'red'}">${money(p.total)}</span></div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px">${mxn(p.total)}</div>
        </div>`).join('')}
    </div>

    <div class="sec-title">Planes del día</div>
    <div class="plan-btn-grid">
      <div class="plan-big-btn stocks" onclick="showPage('plan-acciones')">
        <div class="plan-big-icon">📈</div>
        <div class="plan-big-title">Plan del día</div>
        <div class="plan-big-meta">Acciones</div>
        <div class="plan-big-sub">Rango ${(cfg().metaMinAcc*100).toFixed(0)}%-${(cfg().metaMaxAcc*100).toFixed(0)}% · Plan ${money(cfg().planCapAcc)}</div>
      </div>
      <div class="plan-big-btn options" onclick="showPage('plan-opciones')">
        <div class="plan-big-icon">🎯</div>
        <div class="plan-big-title">Plan por operación</div>
        <div class="plan-big-meta">Opciones</div>
        <div class="plan-big-sub">Rango ${(cfg().metaMinOpc*100).toFixed(0)}%-${(cfg().metaMaxOpc*100).toFixed(0)}% · ${cfg().operacionesSemanaOpciones} ops/sem · Plan ${money(cfg().planCapOpc)}</div>
      </div>
    </div>

    <div class="sec-title">Posiciones abiertas</div>
    <div class="card">
      ${(openAcc.length + openOpc.length) === 0 ? '<p style="color:var(--muted)">Sin posiciones abiertas.</p>' : `
      <div class="tbl-wrap"><table>
        <thead><tr><th>Activo</th><th>Tipo</th><th>Entrada</th><th>Actual</th><th>Inversión</th><th>Valor mercado</th><th>P&L no realizado</th><th>Meta salida</th><th>Meta P&L</th><th>Fecha</th><th>Plan</th><th></th></tr></thead>
        <tbody>
          ${openAcc.map(a => { const meta = targetExit(a, true); return `<tr>
            <td><strong>${esc(a.ticker)}</strong></td>
            <td><span class="badge badge-green">Acción</span></td>
            <td>${money(a.precioCompra)}</td>
            <td>${marketPriceAcc(a) ? money(marketPriceAcc(a)) : '—'}</td>
            <td>${money(a.subtotal)}</td>
            <td>${marketPriceAcc(a) ? money(marketValueAcc(a)) : '—'}</td>
            <td class="${unrealizedAcc(a)>=0?'green':'red'}">${marketPriceAcc(a) ? money(unrealizedAcc(a)) + ' / ' + pct(n(a.subtotal)?unrealizedAcc(a)/n(a.subtotal):0) : '—'}</td>
            <td class="green">${money(meta.exitPrice)}</td>
            <td class="green">${money(meta.pnl)}</td>
            <td>${dateText(a.fechaCompra)}</td>
            <td><span class="badge ${isIncludedInPlan(a)?'badge-green':'badge-gray'}">${planIncludeText(a)}</span></td>
            <td><button class="btn btn-sm" onclick="openEditTrade('acc',${n(a.rowIndex)})">✏</button></td>
          </tr>`; }).join('')}
          ${openOpc.map(o => { const meta = targetExit(o, false); return `<tr>
            <td><strong>${esc(o.empresa)}</strong> ${esc(o.tipo)} $${o.strike}</td>
            <td><span class="badge badge-blue">Opción</span></td>
            <td>${money(o.primaCompra)}</td>
            <td>—</td>
            <td>${money(o.subtotal)}</td>
            <td>—</td>
            <td style="color:var(--muted)">Sin cotización automática</td>
            <td class="green">${money(meta.exitPrice)}</td>
            <td class="green">${money(meta.pnl)}</td>
            <td>${dateText(o.fechaApertura)}</td>
            <td><span class="badge ${isIncludedInPlan(o)?'badge-green':'badge-gray'}">${planIncludeText(o)}</span></td>
            <td><button class="btn btn-sm" onclick="openEditTrade('opc',${n(o.rowIndex)})">✏</button></td>
          </tr>`; }).join('')}
        </tbody>
      </table></div>`}
    </div>

    <div class="sec-title">Últimos 10 trades cerrados</div>
    <div class="card">
      ${closed10.length === 0 ? '<p style="color:var(--muted)">Sin trades cerrados.</p>' : `
      <div class="tbl-wrap"><table>
        <thead><tr><th>Activo</th><th>Tipo</th><th>P&L $</th><th>P&L %</th><th>MXN</th><th>Cierre</th><th></th></tr></thead>
        <tbody>${closed10.map(t => `<tr>
          <td><strong>${esc(t.name)}</strong></td>
          <td><span class="badge ${t.kind==='acc'?'badge-green':'badge-blue'}">${t.kind==='acc'?'Acción':'Opción'}</span></td>
          <td class="${n(t.pnl)>=0?'green':'red'}">${money(t.pnl)}</td>
          <td class="${n(t.pnlPct)>=0?'green':'red'}">${pct(t.pnlPct)}</td>
          <td class="${n(t.pnl)>=0?'green':'red'}">${mxn(t.pnl)}</td>
          <td>${dateText(t.fechaCierre)}</td>
          <td><button class="btn btn-sm" onclick="openEditTrade('${t.kind}',${n(t.rowIndex)})">✏</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`}
    </div>`;
}

function targetExit(item, isAcc) {
  const c = cfg();
  const targetPct = isAcc ? c.metaAcc : c.metaOpc;
  const sub = n(item.subtotal);
  const pnlTarget = sub * targetPct;
  const exitPrice = isAcc
    ? (n(item.acciones) ? (sub + pnlTarget + n(item.comision)) / n(item.acciones) : 0)
    : (n(item.contratos) ? (sub + pnlTarget + n(item.comision)) / (n(item.contratos) * 100) : 0);
  return { pnl: pnlTarget, exitPrice };
}

// ── Capital ───────────────────────────────────────────────────

function cuentaOptions(selected = '') {
  const cuentas = D.cuentas || [];
  if (!cuentas.length) return '<option value="Charles Schwab">Charles Schwab · Principal</option>';
  return cuentas.map(c => {
    const name = c.nombre || c.name || '';
    const parent = c.cuentaPadre ? ` · ${c.cuentaPadre}` : '';
    const strategy = c.estrategia && c.estrategia !== 'Libre' ? ` · ${c.estrategia}` : '';
    return `<option value="${esc(name)}" ${String(selected||'')===String(name)?'selected':''}>${esc(name + parent + strategy)}</option>`;
  }).join('');
}

function getCuentaByName(name) {
  return (D.cuentas || []).find(c => String(c.nombre || '').toLowerCase() === String(name || '').toLowerCase());
}

function renderCapital() {
  const d = getDash();
  const socios = D.socios;
  const totalCap = socios.reduce((s,x) => s + n(x.capital), 0);
  return `
    <div class="kpi-grid">
      ${kpi('Capital acciones', money(d.capAcc), mxn(d.capAcc), 'teal')}
      ${kpi('Capital opciones', money(d.capOpc), mxn(d.capOpc), 'blue')}
      ${kpi('Capital total EVA', money(d.capTotal), mxn(d.capTotal), 'teal')}
      ${kpi('P&L total', money(d.pnl), mxn(d.pnl), n(d.pnl)>=0?'teal':'red')}
    </div>
    <div class="btn-row">
      <button class="btn btn-green" onclick="openCapital('deposito_acciones')">+ Capital acciones</button>
      <button class="btn btn-blue"  onclick="openCapital('deposito_opciones')">+ Capital opciones</button>
      <button class="btn"           onclick="openCapital('retiro_acciones')">↑ Retiro acciones</button>
      <button class="btn"           onclick="openCapital('retiro_opciones')">↑ Retiro opciones</button>
      <button class="btn"           onclick="openModal('estado-cuenta')">📥 Estado de cuenta Charles</button>
    </div>
    <div class="sec-title">Inversionistas / capital de terceros</div>
    <div class="card">
      <div class="tbl-wrap"><table>
        <thead><tr><th>Inversionista</th><th>Capital</th><th>Participación</th><th>Ganancia</th><th>Ganancia MXN</th><th>Retiros</th><th>Saldo</th><th>Notas</th><th></th></tr></thead>
        <tbody>
          ${socios.length ? socios.map((s,i) => {
            const part = totalCap ? n(s.capital) / totalCap : 0;
            const saldo = n(s.saldo) || (n(s.capital) + n(s.ganancia) - n(s.retiros));
            const ganancia = n(s.ganancia);
            return `<tr>
              <td><strong>${esc(s.nombre)}</strong></td>
              <td>${money(s.capital)}</td>
              <td><span class="badge badge-green">${pct(part)}</span></td>
              <td class="green">${money(ganancia)}</td>
              <td class="green">${mxn(ganancia)}</td>
              <td class="red">-${money(s.retiros)}</td>
              <td><strong>${money(saldo)}</strong></td>
              <td>${esc(s.notas||'—')}</td>
              <td><button class="btn btn-sm" onclick="openEditSocio(${n(s.rowIndex||4+i)},'${esc(String(s.nombre))}','${esc(String(s.notas||''))}')">✏</button></td>
            </tr>`;
          }).join('') : '<tr><td colspan="9" style="color:var(--muted);text-align:center;padding:20px">Sin inversionistas externos. Si el capital es tuyo, no necesitas agregarte como socio.</td></tr>'}
        </tbody>
      </table></div>
    </div>`;
}

function openCapital(tipo) {
  const isRetiro = tipo.includes('retiro');
  const isSocios = D.socios.length > 0;
  const socios = D.socios;
  const box = $('modal-box');
  box.innerHTML = `
    <div class="modal-title">${isRetiro ? 'Registrar retiro' : 'Agregar capital'} — ${tipo.includes('acciones') ? 'Acciones' : 'Opciones'}</div>
    <div class="form-grid">
      <div class="form-group"><label>Monto ($)</label><input type="number" id="m-monto" step="0.01" placeholder="1000.00" min="0"></div>
    </div>
    <div class="form-group" style="margin-bottom:1rem">
      <label>¿A nombre de quién?</label>
      <select id="m-socio-mode" onchange="toggleSocioFields()">
        <option value="principal">Titular de la cuenta / Yo mismo</option>
        ${socios.map((s,i) => `<option value="${n(s.rowIndex||4+i)}">${esc(s.nombre)}</option>`).join('')}
        <option value="nuevo">+ Crear nuevo inversionista</option>
      </select>
    </div>
    <div id="m-socio-new-wrap" class="hidden form-group" style="margin-bottom:1rem">
      <label>Nombre del nuevo inversionista</label>
      <input type="text" id="m-socio-new" placeholder="Nombre del inversionista">
    </div>
    <div class="modal-footer">
      <button class="btn ${isRetiro ? 'btn-red' : 'btn-green'}" onclick="doCapital('${tipo}')">${isRetiro ? 'Retirar' : 'Depositar'}</button>
      <button class="btn" onclick="closeModal()">Cancelar</button>
    </div>`;
  $('modal-overlay').classList.remove('hidden');
}

function toggleSocioFields() {
  const mode = $('m-socio-mode')?.value;
  const wrap = $('m-socio-new-wrap');
  if (wrap) wrap.classList.toggle('hidden', mode !== 'nuevo');
}

async function doCapital(tipo) {
  const monto = n($('m-monto')?.value);
  if (!monto || monto <= 0) { showToast('Monto inválido.', 'error'); return; }
  const mode = $('m-socio-mode')?.value || 'principal';
  const socioNombre = mode === 'nuevo' ? ($('m-socio-new')?.value || '').trim() : '';
  if (mode === 'nuevo' && !socioNombre) { showToast('Escribe el nombre del nuevo inversionista.', 'error'); return; }
  try {
    await api('saveCapital', { tipo, monto, socioMode: mode === 'nuevo' ? 'nuevo' : (mode === 'principal' ? 'titular' : 'existente'), socioRow: (mode !== 'principal' && mode !== 'nuevo') ? mode : '', socioNombre: mode === 'nuevo' ? socioNombre : '' });
    closeModal(); await syncAll();
    showToast('Capital actualizado.', 'success');
  } catch(e) { showToast(e.message, 'error'); }
}

// ── Posiciones ────────────────────────────────────────────────
function renderPosiciones() {
  const openAcc = D.acciones.filter(a => a.estado === 'Abierta');
  const openOpc = D.opciones.filter(o => o.estado === 'Abierta');
  return `
    <div class="btn-row">
      <button class="btn btn-green" onclick="openModal('nueva-pos-accion')">+ Nueva acción</button>
      <button class="btn btn-blue"  onclick="openModal('nueva-pos-opcion')">+ Nueva opción</button>
      <button class="btn btn-red"   onclick="openModal('cerrar-pos')">✕ Cerrar posición</button>
    </div>
    <div class="sec-title">Acciones abiertas (${openAcc.length})</div>
    <div class="card">
      ${openAcc.length ? `<div class="tbl-wrap"><table>
        <thead><tr><th>Ticker</th><th>Acciones</th><th>P. compra</th><th>Subtotal</th><th>Meta salida</th><th>Meta P&L</th><th>Apertura</th><th></th></tr></thead>
        <tbody>${openAcc.map(a => { const m = targetExit(a,true); return `<tr>
          <td><strong>${esc(a.ticker)}</strong></td><td>${a.acciones}</td>
          <td>${money(a.precioCompra)}</td><td>${money(a.subtotal)}</td>
          <td class="green">${money(m.exitPrice)}</td>
          <td class="green">${money(m.pnl)}</td>
          <td>${dateText(a.fechaCompra)}</td>
          <td><button class="btn btn-sm" onclick="openEditTrade('acc',${n(a.rowIndex)})">✏ Editar</button></td>
        </tr>`; }).join('')}</tbody>
      </table></div>` : '<p style="color:var(--muted)">Sin acciones abiertas.</p>'}
    </div>
    <div class="sec-title">Opciones abiertas (${openOpc.length})</div>
    <div class="card">
      ${openOpc.length ? `<div class="tbl-wrap"><table>
        <thead><tr><th>Empresa</th><th>Strike</th><th>Tipo</th><th>Contratos</th><th>Prima</th><th>Subtotal</th><th>Meta salida</th><th>Meta P&L</th><th>Vencimiento</th><th>Días</th><th></th></tr></thead>
        <tbody>${openOpc.map(o => {
          const days = o.fechaVencim ? Math.ceil((new Date(o.fechaVencim)-new Date())/86400000) : null;
          const m = targetExit(o, false);
          return `<tr>
            <td><strong>${esc(o.empresa)}</strong></td><td>$${o.strike}</td>
            <td><span class="badge ${o.tipo==='CALL'?'badge-green':'badge-red'}">${esc(o.tipo)}</span></td>
            <td>${o.contratos}</td><td>${money(o.primaCompra)}</td><td>${money(o.subtotal)}</td>
            <td class="green">${money(m.exitPrice)}</td>
            <td class="green">${money(m.pnl)}</td>
            <td>${esc(o.fechaVencim||'—')}</td>
            <td style="${days!==null&&days<=3?'color:var(--amber);font-weight:600':''}">${days !== null ? days : '—'}</td>
            <td><button class="btn btn-sm" onclick="openEditTrade('opc',${n(o.rowIndex)})">✏ Editar</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>` : '<p style="color:var(--muted)">Sin opciones abiertas.</p>'}
    </div>`;
}

// ── Trades ────────────────────────────────────────────────────
function renderTrades() {
  const cerAcc = D.acciones.filter(a => a.estado === 'Cerrada').slice().reverse();
  const cerOpc = D.opciones.filter(o => o.estado === 'Cerrada').slice().reverse();
  return `
    <div class="sec-title">Acciones cerradas (${cerAcc.length})</div>
    <div class="card">
      ${cerAcc.length ? `<div class="tbl-wrap"><table>
        <thead><tr><th>Ticker</th><th>Acciones</th><th>Compra</th><th>Venta</th><th>Comisión</th><th>P&L $</th><th>P&L %</th><th>P&L MXN</th><th>Apertura</th><th>Cierre</th><th></th></tr></thead>
        <tbody>${cerAcc.map(a => `<tr>
          <td><strong>${esc(a.ticker)}</strong></td><td>${a.acciones}</td>
          <td>${money(a.precioCompra)}</td><td>${money(a.precioVenta)}</td>
          <td class="red">-${money(a.comision)}</td>
          <td class="${n(a.pnl)>=0?'green':'red'}">${money(a.pnl)}</td>
          <td class="${n(a.pnlPct)>=0?'green':'red'}">${pct(a.pnlPct)}</td>
          <td class="${n(a.pnl)>=0?'green':'red'}">${mxn(a.pnl)}</td>
          <td>${dateText(a.fechaCompra)}</td><td>${dateText(a.fechaCierre)}</td>
          <td><button class="btn btn-sm" onclick="openEditTrade('acc',${n(a.rowIndex)})">✏</button></td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<p style="color:var(--muted)">Sin acciones cerradas.</p>'}
    </div>
    <div class="sec-title">Opciones cerradas (${cerOpc.length})</div>
    <div class="card">
      ${cerOpc.length ? `<div class="tbl-wrap"><table>
        <thead><tr><th>Empresa</th><th>Strike</th><th>Tipo</th><th>Ct.</th><th>Prima C.</th><th>Prima V.</th><th>Comisión</th><th>P&L $</th><th>P&L %</th><th>P&L MXN</th><th>Cierre</th><th></th></tr></thead>
        <tbody>${cerOpc.map(o => `<tr>
          <td><strong>${esc(o.empresa)}</strong></td><td>$${o.strike}</td>
          <td><span class="badge ${o.tipo==='CALL'?'badge-green':'badge-red'}">${esc(o.tipo)}</span></td>
          <td>${o.contratos}</td>
          <td>${money(o.primaCompra)}</td><td>${money(o.primaVenta)}</td>
          <td class="red">-${money(o.comision)}</td>
          <td class="${n(o.pnl)>=0?'green':'red'}">${money(o.pnl)}</td>
          <td class="${n(o.pnlPct)>=0?'green':'red'}">${pct(o.pnlPct)}</td>
          <td class="${n(o.pnl)>=0?'green':'red'}">${mxn(o.pnl)}</td>
          <td>${dateText(o.fechaCierre)}</td>
          <td><button class="btn btn-sm" onclick="openEditTrade('opc',${n(o.rowIndex)})">✏</button></td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<p style="color:var(--muted)">Sin opciones cerradas.</p>'}
    </div>`;
}

// ── Plan ─────────────────────────────────────────────────────
function planSettings(kind) {
  const c = cfg();
  const isAcc = kind === 'acciones';
  const opsWeekOpc = c.operacionesSemanaOpciones || 3;
  const unitsPerMonth = isAcc ? Math.max(1, c.diasMes || 20) : Math.max(1, opsWeekOpc * 4);
  return {
    kind,
    isAcc,
    label: isAcc ? 'Acciones' : 'Opciones',
    unitLabel: isAcc ? 'Día' : 'Operación',
    unitLabelPlural: isAcc ? 'Días' : 'Operaciones',
    capCuenta: isAcc ? c.capAcc : c.capOpc,
    uso: isAcc ? c.usoAcc : c.usoOpc,
    planCapital: isAcc ? c.planCapAcc : c.planCapOpc,
    minPct: isAcc ? c.metaMinAcc : c.metaMinOpc,
    targetPct: isAcc ? c.metaMaxAcc : c.metaMaxOpc,
    diasMes: unitsPerMonth,
    operacionesSemana: isAcc ? 5 : opsWeekOpc,
    meses: Math.max(1, c.meses || 12),
    startDate: isAcc ? c.planInicioAcc : c.planInicioOpc,
    tone: isAcc ? 'teal' : 'blue'
  };
}
function addPlanDays(startISO, offset) {
  const d = startISO ? new Date(startISO + 'T12:00:00') : new Date();
  if (isNaN(d)) return todayISO;
  d.setDate(d.getDate() + offset);
  return localISO(d);
}
function projectedGain(plan, accountCapital, pctValue) {
  const operable = Math.max(0, accountCapital * plan.uso);
  return operable * pctValue;
}
function buildMonthlyFromPlan(plan) {
  let curMin = plan.planCapital;
  let curIdeal = plan.planCapital;
  const rows = [];
  for (let m = 1; m <= plan.meses; m++) {
    const startMin = curMin;
    const startIdeal = curIdeal;
    for (let u = 1; u <= plan.diasMes; u++) {
      curMin += projectedGain(plan, curMin, plan.minPct);
      curIdeal += projectedGain(plan, curIdeal, plan.targetPct);
    }
    rows.push({
      month: m,
      start: startIdeal,
      end: curIdeal,
      gain: curIdeal - startIdeal,
      pct: startIdeal ? (curIdeal - startIdeal) / startIdeal : 0,
      startMin,
      endMin: curMin,
      gainMin: curMin - startMin,
      pctMin: startMin ? (curMin - startMin) / startMin : 0
    });
  }
  return rows;
}
function addPlanUnitDate(plan, offset) {
  if (plan.isAcc) return addPlanDays(plan.startDate, offset);
  const start = plan.startDate ? new Date(plan.startDate + 'T12:00:00') : new Date();
  if (isNaN(start)) return todayISO;
  const freq = Math.max(1, plan.operacionesSemana || 3);
  const week = Math.floor(offset / freq);
  const pos = offset % freq;
  const dayOffset = Math.round((pos * 5) / Math.max(1, freq));
  start.setDate(start.getDate() + week * 7 + dayOffset);
  return localISO(start);
}
function buildDailyFromPlan(plan, month) {
  let minProjected = plan.planCapital;
  let idealProjected = plan.planCapital;
  const offsetStart = (month - 1) * plan.diasMes;
  for (let i = 0; i < offsetStart; i++) {
    minProjected += projectedGain(plan, minProjected, plan.minPct);
    idealProjected += projectedGain(plan, idealProjected, plan.targetPct);
  }
  const rows = [];
  for (let d = 1; d <= plan.diasMes; d++) {
    const date = addPlanUnitDate(plan, offsetStart + d - 1);
    const minTarget = projectedGain(plan, minProjected, plan.minPct);
    const target = projectedGain(plan, idealProjected, plan.targetPct);
    rows.push({
      day: d,
      globalDay: offsetStart + d,
      date,
      start: idealProjected,
      startMin: minProjected,
      operable: idealProjected * plan.uso,
      operableMin: minProjected * plan.uso,
      minTarget,
      target,
      endMin: minProjected + minTarget,
      end: idealProjected + target
    });
    minProjected += minTarget;
    idealProjected += target;
  }
  return rows;
}
function tradeOpenDate(t, isAcc) { return isAcc ? t.fechaCompra : t.fechaApertura; }
function planTradeEffectiveDate(t, isAcc) {
  // Si una posición vieja se integra al cerrar, su fecha operativa del plan debe ser el cierre/liberación, no la compra histórica.
  return isCapitalReleaseToPlan(t) ? (t.fechaCierre || tradeOpenDate(t, isAcc)) : tradeOpenDate(t, isAcc);
}
function tradeSymbol(t, isAcc) { return isAcc ? t.ticker : t.empresa; }
function getPlanTrades(kind) {
  const isAcc = kind === 'acciones';
  return (isAcc ? D.acciones : D.opciones).map(t => ({ ...t, _isAcc: isAcc }));
}
function sortTradesForPlan(list, isAcc) {
  return (list || []).slice().sort((a,b) => {
    const da = planTradeEffectiveDate(a, isAcc) || a.fechaCierre || '';
    const db = planTradeEffectiveDate(b, isAcc) || b.fechaCierre || '';
    if (da !== db) return String(da).localeCompare(String(db));
    return n(a.rowIndex) - n(b.rowIndex);
  });
}

function planGlobalUnitForTrade(t, plan, fallbackIndex = null) {
  const explicit = n(t.planGlobalUnit);
  if (explicit > 0) return explicit;
  if (plan.isAcc) {
    const d = planTradeEffectiveDate(t, true) || t.fechaCierre || '';
    if (!d || !plan.startDate) return 0;
    const a = new Date(plan.startDate + 'T12:00:00');
    const b = new Date(d + 'T12:00:00');
    if (isNaN(a) || isNaN(b)) return 0;
    const diff = Math.floor((b - a) / 86400000) + 1;
    return diff > 0 ? diff : 0;
  }
  return fallbackIndex != null ? fallbackIndex + 1 : 0;
}
function unitTradesWithFallback(plan) {
  // v17: el plan se ordena por operación real, no por filas viejas ni por planGlobalUnit heredado.
  // Acciones: todos los trades incluidos del mismo día pertenecen a la misma unidad operativa.
  // Opciones: cada trade incluido avanza como unidad operativa.
  const all = sortTradesForPlan(getPlanTrades(plan.kind).filter(isIncludedInPlan), plan.isAcc);
  if (plan.isAcc) {
    const dateToUnit = {};
    let idx = 0;
    return all.map(t => {
      const d = planTradeEffectiveDate(t, true) || t.fechaCierre || `sin-fecha-${n(t.rowIndex)}`;
      if (!dateToUnit[d]) dateToUnit[d] = ++idx;
      return { ...t, _planUnitResolved: dateToUnit[d] };
    });
  }
  return all.map((t, i) => ({ ...t, _planUnitResolved: i + 1 }));
}
function countablePlanTrades(kind) { return getPlanTrades(kind).filter(isIncludedInPlan); }
function closedPlanTrades(kind) {
  return countablePlanTrades(kind).filter(t => t.estado === 'Cerrada' && t.fechaCierre);
}
function pnlUpTo(kind, dateISO) {
  return closedPlanTrades(kind)
    .filter(t => String(t.fechaCierre || '') <= dateISO)
    .reduce((s,t) => s + n(t.pnl), 0);
}
function pnlBeforePlanUnit(plan, unitIndex) {
  return unitTradesWithFallback(plan)
    .filter(t => isCounted(t) && t.estado === 'Cerrada' && n(t._planUnitResolved) > 0 && n(t._planUnitResolved) < unitIndex)
    .reduce((s,t) => s + n(t.pnl), 0);
}
function tradesOnDate(kind, dateISO) {
  const isAcc = kind === 'acciones';
  return getPlanTrades(kind).filter(t => tradeOpenDate(t, isAcc) === dateISO || t.fechaCierre === dateISO);
}
function tradesForPlanUnit(plan, row) {
  // v12: la unidad del plan es el contenedor. Si haces 2 o 3 trades en el mismo día/unidad,
  // todos se quedan dentro de la misma fila y se suman en Usado / Libre / Real.
  return unitTradesWithFallback(plan).filter(t => n(t._planUnitResolved) === n(row.globalDay));
}
function actualCapitalBeforeDay(plan, row) {
  if (row.globalDay <= 1) return plan.planCapital;
  // Capital consolidado antes de la unidad: solo P&L cerrado. El flotante se muestra, pero no mueve el compound.
  return Math.max(0, plan.planCapital + planRealizedPnl(plan, row.globalDay - 1));
}
function dayUsage(plan, row) {
  const trades = tradesForPlanUnit(plan, row);
  const countedTrades = trades.filter(isCounted);
  const includedTrades = countedTrades.filter(isIncludedInPlan);
  const used = includedTrades.reduce((s,t) => s + n(t.subtotal), 0);
  const openUsed = includedTrades.filter(t => t.estado === 'Abierta').reduce((s,t) => s + n(t.subtotal), 0);
  const closedUsed = includedTrades.filter(t => t.estado === 'Cerrada').reduce((s,t) => s + n(t.subtotal), 0);
  const realized = includedTrades.filter(t => t.estado === 'Cerrada').reduce((s,t) => s + n(t.pnl), 0);
  const floating = includedTrades.filter(t => t.estado === 'Abierta').reduce((s,t) => s + unrealizedForPlanTrade(t, plan), 0);
  const real = realized + floating;
  const mainTrade = includedTrades[0] || null;
  return { trades, countedTrades, includedTrades, used, openUsed, closedUsed, realized, floating, real, mainTrade };
}
function statusForDay(plan, row) {
  const actualBase = actualCapitalBeforeDay(plan, row);
  const actualOperable = Math.max(0, actualBase * plan.uso);
  const usage = dayUsage(plan, row);
  const goalBase = usage.used > 0 ? usage.used : actualOperable;
  const minGoal = goalBase * plan.minPct;
  const targetGoal = goalBase * plan.targetPct;
  const real = usage.real;
  const remaining = Math.max(0, actualOperable - usage.used);
  const projectedMinAccount = actualBase + minGoal;
  const projectedIdealAccount = actualBase + targetGoal;
  const nextActual = Math.max(0, actualBase + real);
  const nextTrade = Math.max(0, (usage.mainTrade && usage.mainTrade.estado === 'Cerrada') ? (nextActual * plan.uso) : (projectedIdealAccount * plan.uso));
  const diffVsIdeal = nextActual - row.end;
  const diffVsMin = nextActual - row.endMin;
  let status = 'Sin operar';
  let tone = 'badge-gray';
  if (usage.openUsed > 0 && usage.closedUsed === 0 && real === 0) { status = `${usage.includedTrades.length} trade(s) abierto(s)`; tone = 'badge-amber'; }
  if (usage.used > 0 || real !== 0) {
    if (real >= targetGoal) { status = usage.openUsed > 0 ? 'Meta + flotante' : 'Arriba de meta'; tone = 'badge-green'; }
    else if (real >= minGoal) { status = usage.openUsed > 0 ? 'Mínimo + flotante' : 'Cumplió mínimo'; tone = 'badge-blue'; }
    else if (real > 0) { status = usage.openUsed > 0 ? 'Ganando, debajo de meta' : 'Abajo de lo esperado'; tone = 'badge-amber'; }
    else if (real < 0) { status = usage.openUsed > 0 ? 'Pérdida flotante' : 'Pérdida'; tone = 'badge-red'; }
    else { status = usage.openUsed > 0 ? `${usage.includedTrades.length} trade(s) abierto(s)` : 'Sin operar'; tone = usage.openUsed > 0 ? 'badge-amber' : 'badge-gray'; }
  }
  return { actualBase, actualOperable, real, minGoal, targetGoal, status, tone, nextActual, remaining, used: usage.used, openUsed: usage.openUsed, closedUsed: usage.closedUsed, tradeCount: usage.countedTrades.length, nextTrade, trades: usage.trades, projectedMinAccount, projectedIdealAccount, diffVsIdeal, diffVsMin };
}
function planConfigButton(kind) { return `openPlanConfig('${kind}')`; }
function signedTone(v) { return n(v) >= 0 ? 'green' : 'red'; }
function signedKpiTone(v) { return n(v) >= 0 ? 'teal' : 'red'; }
function planTradeForecast(t, plan, baseAccount) {
  const used = n(t.subtotal);
  const minGain = used * plan.minPct;
  const idealGain = used * plan.targetPct;
  return {
    used,
    minGain,
    idealGain,
    accountIfMin: baseAccount + minGain,
    accountIfIdeal: baseAccount + idealGain,
    operableIfMin: (baseAccount + minGain) * plan.uso,
    operableIfIdeal: (baseAccount + idealGain) * plan.uso
  };
}

function unrealizedForPlanTrade(t, plan) {
  if (!t || t.estado !== 'Abierta' || !isCounted(t) || !isIncludedInPlan(t)) return 0;
  if (plan.isAcc) return unrealizedAcc(t);
  // Google Finance no valúa opciones de forma confiable; para opciones no inventamos flotante.
  return 0;
}
function planRealizedPnl(plan, maxUnit = Infinity) {
  return unitTradesWithFallback(plan)
    .filter(t => isCounted(t) && t.estado === 'Cerrada' && n(t._planUnitResolved) > 0 && n(t._planUnitResolved) <= maxUnit)
    .reduce((s,t) => s + n(t.pnl), 0);
}
function planReleasedPrincipal(plan, maxUnit = Infinity) {
  // Capital liberado: posiciones viejas que no nacieron con el plan, pero al cerrarlas decides integrarlas.
  // Se suma el principal recuperado al capital asignado del plan. El P&L ya se suma con planRealizedPnl.
  return unitTradesWithFallback(plan)
    .filter(t => isCounted(t) && t.estado === 'Cerrada' && isCapitalReleaseToPlan(t) && n(t._planUnitResolved) > 0 && n(t._planUnitResolved) <= maxUnit)
    .reduce((s,t) => s + n(t.subtotal), 0);
}
function planFloatingPnl(plan, maxUnit = Infinity) {
  return unitTradesWithFallback(plan)
    .filter(t => isCounted(t) && t.estado === 'Abierta' && n(t._planUnitResolved) > 0 && n(t._planUnitResolved) <= maxUnit)
    .reduce((s,t) => s + unrealizedForPlanTrade(t, plan), 0);
}
function planNetPnl(plan, maxUnit = Infinity) {
  return planRealizedPnl(plan, maxUnit) + planFloatingPnl(plan, maxUnit);
}
function planConsolidatedCapital(plan, maxUnit = Infinity) {
  return Math.max(0, plan.planCapital + planRealizedPnl(plan, maxUnit) + planReleasedPrincipal(plan, maxUnit));
}
function planOccupiedCapital(plan, maxUnit = Infinity) {
  return unitTradesWithFallback(plan)
    .filter(t => isCounted(t) && isIncludedInPlan(t) && t.estado === 'Abierta' && n(t._planUnitResolved) > 0 && n(t._planUnitResolved) <= maxUnit)
    .reduce((s,t) => s + n(t.subtotal), 0);
}
function planPendingReleaseCapital(plan) {
  // Capital que existe en posiciones abiertas, pero todavía no forma parte del compound del plan.
  // Ejemplo: posiciones viejas abiertas antes de arrancar con los $800 del plan.
  return getPlanTrades(plan.kind)
    .filter(t => isCounted(t) && !isIncludedInPlan(t) && t.estado === 'Abierta')
    .reduce((s,t) => s + n(t.subtotal), 0);
}
function planPendingReleaseTrades(plan) {
  return getPlanTrades(plan.kind).filter(t => isCounted(t) && !isIncludedInPlan(t) && t.estado === 'Abierta');
}
function planReinvestableCapital(plan, maxUnit = Infinity) {
  return Math.max(0, planConsolidatedCapital(plan, maxUnit) - planOccupiedCapital(plan, maxUnit));
}
function planEstimatedTotalValue(plan, maxUnit = Infinity) {
  return planConsolidatedCapital(plan, maxUnit) + planFloatingPnl(plan, maxUnit);
}
function planCurrentCapital(plan, maxUnit = Infinity) {
  // Compatibilidad: cuando otras partes pidan "capital actual", devolvemos capital consolidado, no flotante.
  return planConsolidatedCapital(plan, maxUnit);
}
function tradeReturnPct(t) {
  const base = n(t.subtotal);
  if (!base) return '';
  if (t.estado !== 'Cerrada' || t.pnl === '' || t.pnl == null) return '';
  return n(t.pnl) / base;
}
function renderPlanMoneyOrDash(v) {
  return (v === '' || v == null) ? '—' : money(v);
}
function planStatusText(diff, hasData) {
  if (!hasData) return { label: 'Pendiente', tone:'gray', text:'Aún sin datos reales' };
  if (diff >= 0) return { label:'Arriba del plan', tone:'green', text:`Arriba del plan · +${money(diff)}` };
  const abs = Math.abs(diff);
  return { label:'Debajo del plan', tone:'red', text:`Faltan ${money(abs)}` };
}

function planRowsForMonth(plan, month) {
  return buildDailyFromPlan(plan, month);
}
function rowForGlobalUnit(plan, globalUnit) {
  const month = Math.max(1, Math.ceil(globalUnit / plan.diasMes));
  const rows = buildDailyFromPlan(plan, month);
  return rows.find(r => r.globalDay === globalUnit) || rows[0];
}
function currentPlanUnit(plan) {
  const units = unitTradesWithFallback(plan).filter(isCounted).map(t => n(t._planUnitResolved)).filter(Boolean);
  if (!units.length) return 1;
  const maxUnit = Math.max(...units);
  const currentTrades = unitTradesWithFallback(plan).filter(t => isCounted(t) && n(t._planUnitResolved) === maxUnit);
  const hasOpen = currentTrades.some(t => t.estado === 'Abierta');
  return hasOpen ? maxUnit : Math.min(maxUnit + 1, plan.diasMes * plan.meses);
}
function weekStatsForPlan(plan, selectedGlobalUnit) {
  const weekSize = Math.max(1, plan.operacionesSemana || (plan.isAcc ? 5 : 3));
  const weekStart = Math.floor((selectedGlobalUnit - 1) / weekSize) * weekSize + 1;
  const weekEnd = weekStart + weekSize - 1;
  const trades = unitTradesWithFallback(plan).filter(t => isCounted(t) && n(t._planUnitResolved) >= weekStart && n(t._planUnitResolved) <= weekEnd);
  const closed = trades.filter(t => t.estado === 'Cerrada');
  const realized = closed.reduce((s,t)=>s+n(t.pnl),0);
  const floating = trades.filter(t=>t.estado==='Abierta').reduce((s,t)=>s+unrealizedForPlanTrade(t, plan),0);
  const pnl = realized + floating;
  const gains = closed.filter(t=>n(t.pnl)>0).reduce((s,t)=>s+n(t.pnl),0) + Math.max(0, floating);
  const losses = closed.filter(t=>n(t.pnl)<0).reduce((s,t)=>s+n(t.pnl),0) + Math.min(0, floating);
  const commissions = trades.reduce((s,t)=>s+n(t.comision),0);
  const base = actualCapitalBeforeDay(plan, rowForGlobalUnit(plan, weekStart));
  let idealGoal = 0;
  let minGoal = 0;
  for (let u = weekStart; u <= weekEnd; u++) {
    const r = rowForGlobalUnit(plan, u);
    idealGoal += projectedGain(plan, r.start, plan.targetPct);
    minGoal += projectedGain(plan, r.startMin, plan.minPct);
  }
  const avance = idealGoal > 0 ? (pnl / idealGoal) * 100 : 0;
  const objetivoPct = base > 0 ? idealGoal / base : 0;
  const avancePctCapital = base > 0 ? pnl / base : 0;
  const faltante = Math.max(0, idealGoal - pnl);
  const faltantePct = Math.max(0, objetivoPct - avancePctCapital);
  const avgReturn = closed.length ? closed.reduce((s,t)=>s+n(t.pnlPct),0) / closed.length : 0;
  let phrase = 'Aún no hay operaciones cerradas esta semana.';
  let tone = 'amber';
  if (pnl >= idealGoal && idealGoal > 0) { phrase = '¡Vamos muy bien con la meta semanal!'; tone = 'teal'; }
  else if (pnl >= minGoal && minGoal > 0) { phrase = 'Vas bien; ya cubriste el mínimo semanal.'; tone = 'teal'; }
  else if (pnl > 0) { phrase = 'Falta poco para llegar; cuida la calidad de las entradas.'; tone = 'amber'; }
  else if (pnl < 0) { phrase = 'Semana complicada: baja el riesgo y sigue tu plan.'; tone = 'red'; }
  return { weekStart, weekEnd, trades, closed, pnl, gains, losses, commissions, base, idealGoal, minGoal, objetivoPct, avancePctCapital, avance, faltante, faltantePct, avgReturn, phrase, tone };
}
function monthSummaryForPlan(plan, month) {
  const unitStart = (month - 1) * plan.diasMes + 1;
  const unitEnd = month * plan.diasMes;
  const m = buildMonthlyFromPlan(plan)[month-1];
  const trades = unitTradesWithFallback(plan).filter(t => isCounted(t) && isIncludedInPlan(t) && n(t._planUnitResolved) >= unitStart && n(t._planUnitResolved) <= unitEnd);
  const closed = trades.filter(t => t.estado === 'Cerrada');
  const opened = trades.filter(t => t.estado === 'Abierta');
  const realized = closed.reduce((s,t)=>s+n(t.pnl),0);
  const floating = opened.reduce((s,t)=>s+unrealizedForPlanTrade(t, plan),0);
  const neto = realized + floating;
  const hasData = trades.length > 0;
  const balanceInicial = actualCapitalBeforeDay(plan, rowForGlobalUnit(plan, unitStart));
  const balanceActual = hasData ? balanceInicial + neto : '';
  const metaEstimada = m ? m.end : balanceInicial;
  const diff = hasData ? n(balanceActual) - metaEstimada : '';
  const st = planStatusText(diff, hasData);
  return { month, balanceInicial, balanceActual, pnl: realized, flotante: floating, neto: hasData ? neto : '', metaEstimada, diff, estado: st.label, tone: st.tone, estadoText: st.text, trades, closed, opened, hasData };
}

function cycleSummaryForPlan(plan, month) {
  // v21: el "mes" del plan es un ciclo operativo, no necesariamente calendario.
  // Se cumple al terminar sus unidades configuradas o al alcanzar la meta ideal antes.
  const unitStart = (month - 1) * plan.diasMes + 1;
  const unitEnd = month * plan.diasMes;
  const rows = buildDailyFromPlan(plan, month);
  const trades = unitTradesWithFallback(plan).filter(t => isCounted(t) && isIncludedInPlan(t) && n(t._planUnitResolved) >= unitStart && n(t._planUnitResolved) <= unitEnd);
  const completedUnits = new Set(trades.filter(t => t.estado === 'Cerrada').map(t => n(t._planUnitResolved)).filter(Boolean)).size;
  const openUnits = new Set(trades.filter(t => t.estado === 'Abierta').map(t => n(t._planUnitResolved)).filter(Boolean)).size;
  const summary = monthSummaryForPlan(plan, month);
  const firstRow = rows[0];
  const startCapital = summary.balanceInicial || (firstRow ? firstRow.start : plan.planCapital);
  const targetEnd = rows.length ? rows[rows.length - 1].end : startCapital;
  const minEnd = rows.length ? rows[rows.length - 1].endMin : startCapital;
  const targetMoney = Math.max(0, targetEnd - startCapital);
  const minMoney = Math.max(0, minEnd - startCapital);
  const targetPct = startCapital > 0 ? targetMoney / startCapital : 0;
  const minPct = startCapital > 0 ? minMoney / startCapital : 0;
  const realMoney = summary.hasData ? n(summary.neto) : 0;
  const realPct = startCapital > 0 ? realMoney / startCapital : 0;
  const faltanteMoney = Math.max(0, targetMoney - realMoney);
  const faltantePct = Math.max(0, targetPct - realPct);
  const targetReached = summary.hasData && realMoney >= targetMoney;
  const unitsComplete = completedUnits >= plan.diasMes;
  let estado = 'Ciclo en progreso';
  let tone = 'amber';
  let frase = 'Sigue registrando operaciones; el ciclo avanza por unidades cerradas.';
  if (targetReached && !unitsComplete) {
    estado = 'Meta de ciclo alcanzada antes';
    tone = 'teal';
    frase = 'Meta del ciclo alcanzada antes de completar todas las unidades. Puedes cerrar etapa o seguir con más riesgo.';
  } else if (targetReached && unitsComplete) {
    estado = 'Ciclo cumplido';
    tone = 'teal';
    frase = 'Ciclo cumplido. Buen momento para registrar resultado y preparar la siguiente etapa.';
  } else if (unitsComplete && !targetReached) {
    estado = 'Unidades completas, meta pendiente';
    tone = 'red';
    frase = 'Terminaste las unidades, pero falta rendimiento para la meta ideal del ciclo.';
  } else if (realMoney > 0) {
    estado = 'Avanzando';
    tone = 'amber';
    frase = 'Vas avanzando; todavía falta para la meta ideal del ciclo.';
  } else if (realMoney < 0) {
    estado = 'Debajo del plan';
    tone = 'red';
    frase = 'El ciclo va abajo. Cuida tamaño de posición y calidad de entrada.';
  }
  return { unitStart, unitEnd, completedUnits, openUnits, startCapital, targetEnd, minEnd, targetMoney, minMoney, targetPct, minPct, realMoney, realPct, faltanteMoney, faltantePct, targetReached, unitsComplete, estado, tone, frase, summary };
}

function renderPlan(kind) {
  const plan = planSettings(kind);
  let globalUnit = currentPlanUnit(plan);
  const selectedMonth = selectedPlanMonth[kind] || Math.max(1, Math.ceil(globalUnit / plan.diasMes));
  const month = selectedMonth;
  const day = selectedPlanDay[kind] || (((globalUnit - 1) % plan.diasMes) + 1);
  globalUnit = (month - 1) * plan.diasMes + day;
  const rows = planRowsForMonth(plan, month);
  const curr = rows.find(r => r.globalDay === globalUnit) || rows[0];
  const currStatus = statusForDay(plan, curr);
  const week = weekStatsForPlan(plan, curr.globalDay);
  const cycle = cycleSummaryForPlan(plan, month);
  const months = buildMonthlyFromPlan(plan);
  const finalIdeal = months[plan.meses - 1]?.end || plan.planCapital;
  const finalMin = months[plan.meses - 1]?.endMin || plan.planCapital;
  const dayTrades = tradesForPlanUnit(plan, curr);
  const allTrades = unitTradesWithFallback(plan).filter(t => isCounted(t) && isIncludedInPlan(t));
  const openTrades = allTrades.filter(t => t.estado === 'Abierta');
  const closedAll = allTrades.filter(t => t.estado === 'Cerrada');
  const todayISO2 = todayISO;
  const todayClosed = closedAll.filter(t => t.fechaCierre === todayISO2);
  const gainDay = todayClosed.filter(t=>n(t.pnl)>0).reduce((s,t)=>s+n(t.pnl),0);
  const lossDay = todayClosed.filter(t=>n(t.pnl)<0).reduce((s,t)=>s+n(t.pnl),0);
  const usedTotal = openTrades.reduce((s,t)=>s+n(t.subtotal),0);
  const floatingTotal = openTrades.reduce((s,t)=>s+unrealizedForPlanTrade(t, plan),0);
  const realizedTotal = closedAll.reduce((s,t)=>s+n(t.pnl),0);
  const capitalConsolidado = planConsolidatedCapital(plan);
  const capitalUsadoPlan = usedTotal;
  const capitalLibrePlan = Math.max(0, capitalConsolidado - capitalUsadoPlan);
  const pendingRelease = planPendingReleaseCapital(plan);
  const pendingReleaseTrades = planPendingReleaseTrades(plan);
  const releasedIntegrated = planReleasedPrincipal(plan);
  const metaPendientePlan = openTrades.reduce((s,t)=>s + (plan.isAcc ? openTargetProfitAcc(t) : openTargetProfitOpc(t)), 0);
  const capitalPotencialObjetivo = capitalLibrePlan + capitalUsadoPlan + metaPendientePlan;
  const potencialSiLiberaEnMeta = capitalConsolidado + pendingRelease + (pendingRelease * plan.targetPct);
  const valorEstimadoPlan = capitalConsolidado + floatingTotal;
  const progressPct = week.idealGoal > 0 ? Math.max(0, Math.min((week.pnl / week.idealGoal) * 100, 150)) : 0;
  const unitLabel = plan.isAcc ? 'día operativo' : 'operación';

  return `
    <div class="btn-row">
      <button class="btn ${plan.isAcc?'btn-green':'btn-blue'}" onclick="openPlanPosition('${kind}', ${day})">+ Registrar trade</button>
      <button class="btn btn-red" onclick="openModal('cerrar-pos')">✕ Cerrar posición</button>
      <button class="btn" onclick="openPlanConfig('${kind}')">⚙ Configurar este plan</button>
    </div>

    <div class="alert-info">
      <strong>${plan.label}:</strong> combina operación real con interés compuesto. El plan avanza por <strong>${unitLabel}s</strong>. Las posiciones viejas abiertas se muestran como <strong>capital pendiente de liberar</strong> hasta que las cierres y decidas integrarlas.
    </div>

    <div class="kpi-grid compact-plan">
      ${kpi('Capital asignado al plan', money(capitalConsolidado), 'Base inicial + P&L cerrado + capital liberado integrado', 'blue')}
      ${kpi('Capital usado del plan', money(capitalUsadoPlan), `${openTrades.length} posición(es) abierta(s) dentro del plan`, capitalUsadoPlan>0?'amber':'teal')}
      ${kpi('Capital libre del plan', money(capitalLibrePlan), 'Capital asignado menos posiciones abiertas del plan', capitalLibrePlan>=0?'teal':'red')}
      ${kpi('Capital pendiente de liberar', money(pendingRelease), `${pendingReleaseTrades.length} posición(es) abierta(s) fuera del compound`, pendingRelease>0?'amber':'teal')}
      ${kpi('Capital liberado integrado', money(releasedIntegrated), 'Principal de posiciones viejas ya anexado al plan', releasedIntegrated>0?'teal':'blue')}
      ${kpi('Ganancia/Pérdida flotante', money(floatingTotal), plan.isAcc ? 'Abiertas del plan con precio actual' : 'Opciones sin cotización automática', floatingTotal>=0?'teal':'red')}
      ${kpi('Capital potencial al objetivo', money(capitalPotencialObjetivo), `Solo posiciones abiertas dentro del plan · meta pendiente ${money(metaPendientePlan)}`, capitalPotencialObjetivo>=0?'teal':'red')}
      ${kpi('Si se libera pendiente en meta', money(potencialSiLiberaEnMeta), `Pendiente ${money(pendingRelease)} + meta ${pct(plan.targetPct)}`, potencialSiLiberaEnMeta>=0?'teal':'amber')}
      ${kpi('Ganancia del día', money(gainDay), mxn(gainDay), gainDay>=0?'teal':'red')}
      ${kpi('Pérdida del día', money(lossDay), mxn(lossDay), lossDay<0?'red':'teal')}
      ${kpi('Ganancia semana', money(week.gains), `Meta ideal: ${money(week.idealGoal)}`, 'teal')}
      ${kpi('Pérdida semana', money(week.losses), 'Pérdidas cerradas', week.losses<0?'red':'teal')}
      ${kpi('Rend. promedio', pct(week.avgReturn), `${week.closed.length} cierre(s) esta semana`, week.avgReturn>=0?'teal':'red')}
      ${kpi('Comisiones', '-'+money(week.commissions), 'Semana actual', week.commissions>0?'red':'teal')}
      ${kpi('Avance semanal', Math.max(0, week.avance).toFixed(1)+'%', `${money(week.pnl)} de ${money(week.idealGoal)} · ${week.phrase}`, week.tone)}
      ${kpi('Faltante semanal', week.idealGoal ? pct(week.faltantePct) : '—', week.idealGoal ? `${money(week.faltante)} para meta ideal` : 'Sin meta semanal', week.faltante<=0?'teal':'amber')}
      ${kpi('Objetivo ciclo', pct(cycle.targetPct), `${money(cycle.targetMoney)} sobre ${money(cycle.startCapital)}`, 'blue')}
      ${kpi('Faltante objetivo ciclo', pct(cycle.faltantePct), `${money(cycle.faltanteMoney)} para cerrar etapa`, cycle.faltanteMoney<=0?'teal':'amber')}
    </div>

    <div class="sec-title">Progreso semanal</div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px;gap:10px;flex-wrap:wrap">
        <span><strong>${week.phrase}</strong></span>
        <span>Real semana: <strong class="${week.pnl>=0?'green':'red'}">${money(week.pnl)}</strong> / Meta ideal: <strong>${money(week.idealGoal)}</strong></span>
      </div>
      <div class="prog-bar"><div class="prog-fill" style="width:${progressPct}%;background:${progressPct>=100?'var(--teal)':'var(--amber)'}"></div></div>
      <div class="prog-label">Avance ${Math.max(0, week.avance).toFixed(1)}% · Faltante: <strong>${pct(week.faltantePct)}</strong> / <strong>${money(week.faltante)}</strong></div>
    </div>

    <div class="sec-title">Ciclo operativo actual</div>
    <div class="card cycle-card ${cycle.tone}">
      <div class="simple-unit">
        <div><span>Balance inicial</span><strong>${money(cycle.startCapital)}</strong></div>
        <div><span>Resultado real</span><strong class="${cycle.realMoney>=0?'green':'red'}">${money(cycle.realMoney)} / ${pct(cycle.realPct)}</strong></div>
        <div><span>Objetivo ideal</span><strong>${money(cycle.targetMoney)} / ${pct(cycle.targetPct)}</strong></div>
        <div><span>Faltante objetivo</span><strong class="${cycle.faltanteMoney<=0?'green':'red'}">${money(cycle.faltanteMoney)} / ${pct(cycle.faltantePct)}</strong></div>
        <div><span>Unidades cerradas</span><strong>${cycle.completedUnits} / ${plan.diasMes}</strong></div>
        <div><span>Estado</span><strong>${cycle.estado}</strong></div>
      </div>
      <div style="margin-top:12px"><span class="badge badge-${cycle.tone==='teal'?'green':cycle.tone}">${cycle.estado}</span></div>
      <div class="alert-info" style="margin-top:10px">${cycle.frase}</div>
    </div>

    <div class="sec-title">${plan.unitLabel} actual</div>
    <div class="card">
      <div class="simple-unit">
        <div><span>Unidad</span><strong>${curr.day} / ${plan.diasMes}</strong></div>
        <div><span>Capital inicial real</span><strong>${money(currStatus.actualBase)}</strong></div>
        <div><span>Capital usado</span><strong>${money(currStatus.used)}</strong></div>
        <div><span>Libre</span><strong>${money(currStatus.remaining)}</strong></div>
        <div><span>Meta mín.</span><strong>${money(currStatus.minGoal)}</strong></div>
        <div><span>Meta ideal</span><strong>${money(currStatus.targetGoal)}</strong></div>
        <div><span>Resultado real</span><strong class="${currStatus.real>=0?'green':'red'}">${money(currStatus.real)}</strong></div>
        <div><span>Nuevo capital</span><strong>${money(currStatus.actualBase + currStatus.real)}</strong></div>
      </div>
      <div style="margin-top:12px"><span class="badge ${currStatus.tone}">${currStatus.status}</span></div>
      ${currStatus.real >= currStatus.targetGoal && currStatus.targetGoal > 0 ? `<div class="alert-warn" style="margin-top:10px">Meta de la unidad cumplida. Puedes detenerte aquí o registrar otro trade bajo tu responsabilidad para evitar sobreoperar.</div>` : ''}
    </div>

    <div class="sec-title">Trades de esta unidad</div>
    <div class="card">
      ${dayTrades.length === 0 ? `<p style="color:var(--muted);margin-bottom:10px">No hay trades en esta unidad.</p>` :
      `<div class="tbl-wrap"><table>
        <thead><tr><th>Activo</th><th>Estado</th><th>Capital usado</th><th>Entrada</th><th>Cierre</th><th>Resultado</th><th>%</th><th>Plan</th><th></th></tr></thead>
        <tbody>${dayTrades.map(t => `<tr>
          <td><strong>${esc(tradeSymbol(t, plan.isAcc))}</strong></td>
          <td><span class="badge ${t.estado==='Cerrada'?'badge-gray':'badge-amber'}">${esc(t.estado)}</span></td>
          <td>${money(t.subtotal)}</td>
          <td>${dateText(tradeOpenDate(t, plan.isAcc))}</td>
          <td>${dateText(t.fechaCierre)}</td>
          <td class="${n(t.pnl)>=0?'green':'red'}"><strong>${t.pnl===''?'—':money(t.pnl)}</strong></td>
          <td class="${n(tradeReturnPct(t))>=0?'green':'red'}"><strong>${tradeReturnPct(t)===''?'—':pct(tradeReturnPct(t))}</strong></td>
          <td><span class="badge ${isIncludedInPlan(t)?'badge-green':'badge-gray'}">${planIncludeText(t)}</span></td>
          <td><button class="btn btn-sm" onclick="openEditTrade('${plan.isAcc?'acc':'opc'}',${n(t.rowIndex)})">✏</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`}
      <button class="btn ${plan.isAcc?'btn-green':'btn-blue'}" style="margin-top:10px" onclick="openPlanPosition('${kind}', ${day})">+ Registrar trade para esta unidad</button>
    </div>

    <div class="sec-title">Mes actual y proyección</div>
    <div class="month-summary-grid">
      ${months.map(m => { const ms = monthSummaryForPlan(plan, m.month); return `<button class="month-summary-card ${m.month===month?'active':''}" onclick="selectPlanMonth('${kind}',${m.month})">
        <strong>Mes ${m.month}</strong>
        <span>Balance inicial: ${money(ms.balanceInicial)}</span>
        <span>Balance actual: ${renderPlanMoneyOrDash(ms.balanceActual)}</span>
        <span class="${n(ms.neto)>=0?'green':'red'}">Ganando/perdiendo: ${renderPlanMoneyOrDash(ms.neto)} ${ms.hasData ? '('+pct(n(ms.neto)/n(ms.balanceInicial))+')' : ''}</span>
        <span>Meta estimada: ${money(ms.metaEstimada)}</span>
        <span>Objetivo: ${pct(cycleSummaryForPlan(plan, m.month).targetPct)} / ${money(cycleSummaryForPlan(plan, m.month).targetMoney)}</span>
        <span class="${cycleSummaryForPlan(plan, m.month).faltanteMoney<=0?'green':'red'}">Faltante: ${pct(cycleSummaryForPlan(plan, m.month).faltantePct)} / ${money(cycleSummaryForPlan(plan, m.month).faltanteMoney)}</span>
        <small class="${ms.hasData ? (n(ms.diff)>=0?'green':'red') : ''}">${ms.estadoText}</small>
      </button>`; }).join('')}
    </div>

    <div class="sec-title">Unidades del mes ${month}</div>
    <div class="card">
      <div class="tbl-wrap"><table class="plan-day-table simplified">
        <thead><tr><th>Unidad</th><th>Capital inicial</th><th>Usado</th><th>Libre</th><th>Meta mín.</th><th>Meta ideal</th><th>Resultado</th><th>%</th><th>Nuevo capital</th><th>Estado</th><th></th></tr></thead>
        <tbody>${rows.map(r => { const st = statusForDay(plan, r); return `<tr class="${r.day===day?'current-day':''}">
          <td>${r.day} / ${plan.diasMes}</td>
          <td><strong>${money(st.actualBase)}</strong></td>
          <td>${money(st.used)}</td>
          <td>${money(st.remaining)}</td>
          <td class="green">${money(st.minGoal)}</td>
          <td class="green">${money(st.targetGoal)}</td>
          <td class="${st.real>=0?'green':'red'}"><strong>${money(st.real)}</strong></td>
          <td class="${st.used ? (st.real>=0?'green':'red') : ''}"><strong>${st.used ? pct(st.real / st.used) : '—'}</strong></td>
          <td><strong>${money(st.actualBase + st.real)}</strong></td>
          <td><span class="badge ${st.tone}">${st.status}</span></td>
          <td><button class="btn btn-sm" onclick="selectPlanDay('${kind}',${r.day})">Ver</button></td>
        </tr>`; }).join('')}</tbody>
      </table></div>
    </div>

    <div class="sec-title">Gráfica real vs plan compuesto</div>
    <div class="card">
      <div class="chart-wrap"><canvas id="plan-chart-${kind}"></canvas></div>
    </div>

    <div class="alert-warn">⚠️ El plan compuesto es mapa de disciplina, no promesa. EVA compara tu realidad contra el ritmo que elegiste.</div>`;
}

function drawPlanChart(kind) {
  const plan = planSettings(kind);
  const canvas = document.getElementById(`plan-chart-${kind}`);
  if (!canvas) return;
  if (chartInstances[kind]) { try { chartInstances[kind].destroy(); } catch(e) {} }
  const totalUnits = Math.min(plan.diasMes * plan.meses, Math.max(plan.diasMes, currentPlanUnit(plan) + 8));
  const labels = [];
  const ideal = [];
  const minimo = [];
  const real = [];
  let minCap = plan.planCapital;
  let idealCap = plan.planCapital;
  for (let u=1; u<=totalUnits; u++) {
    labels.push(String(u));
    minimo.push(+minCap.toFixed(2));
    ideal.push(+idealCap.toFixed(2));
    const rr = rowForGlobalUnit(plan, u);
    { const st = statusForDay(plan, rr); real.push(+(st.actualBase + st.real).toFixed(2)); }
    minCap += projectedGain(plan, minCap, plan.minPct);
    idealCap += projectedGain(plan, idealCap, plan.targetPct);
  }
  chartInstances[kind] = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets: [
      { label: 'Real', data: real, borderColor: '#111827', backgroundColor: 'rgba(17,24,39,.06)', borderWidth: 2.5, pointRadius: 3, fill: false, tension: .25 },
      { label: 'Mínimo compuesto', data: minimo, borderColor: '#BA7517', borderWidth: 2, pointRadius: 2, fill: false, tension: .25 },
      { label: 'Ideal compuesto', data: ideal, borderColor: plan.isAcc ? '#1D9E75' : '#185FA5', backgroundColor: plan.isAcc ? 'rgba(29,158,117,.08)' : 'rgba(24,95,165,.08)', borderWidth: 2, pointRadius: 2, fill: true, tension: .25 }
    ]},
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + money(ctx.parsed.y) } } },
      scales: { x: { title: { display: true, text: 'Unidad operativa' }, grid: { display: false } }, y: { ticks: { callback: v => money(v) }, grid: { color: 'rgba(0,0,0,.06)' } } }
    }
  });
}

function selectPlanMonth(kind, month) { selectedPlanMonth[kind] = month; selectedPlanDay[kind] = 1; renderPage(); }
function selectPlanDay(kind, day) { selectedPlanDay[kind] = day; renderPage(); }


// ── Cuentas/Subcuentas ────────────────────────────────────────
function renderCuentas() {
  const cuentas = D.cuentas || [];
  const total = cuentas.reduce((s,c)=>s+n(c.saldoConciliado),0);
  return `
    <div class="alert-info"><strong>Cuentas/Subcuentas:</strong> una cuenta es donde está el dinero; una subcuenta puede ser una cuenta real de Charles o una bolsa interna para separar estrategias. No es lo mismo que un inversionista.</div>
    <div class="kpi-grid">
      ${kpi('Saldo conciliado total', money(total), mxn(total), 'teal')}
      ${kpi('Cuentas activas', String(cuentas.filter(c => String(c.activa||'SI').toUpperCase() !== 'NO').length), '', 'blue')}
    </div>
    <div class="btn-row"><button class="btn btn-green" onclick="openModal('nueva-cuenta')">+ Nueva cuenta/subcuenta</button></div>
    <div class="card">
      <div class="tbl-wrap"><table>
        <thead><tr><th>Cuenta</th><th>Tipo</th><th>Padre</th><th>Estrategia</th><th>Moneda</th><th>Saldo conciliado</th><th>Ocupado</th><th>Disponible</th><th>Notas</th><th></th></tr></thead>
        <tbody>${cuentas.length ? cuentas.map((c,i)=>`<tr>
          <td><strong>${esc(c.nombre)}</strong></td>
          <td><span class="badge badge-gray">${esc(c.tipo||'Cuenta')}</span></td>
          <td>${esc(c.cuentaPadre||'—')}</td>
          <td>${esc(c.estrategia||'Libre')}</td>
          <td>${esc(c.moneda||'USD')}</td>
          <td>${money(c.saldoConciliado)}</td>
          <td>${money(c.capitalOcupado)}</td>
          <td class="${n(c.disponible)>=0?'green':'red'}">${money(c.disponible)}</td>
          <td>${esc(c.notas||'—')}</td>
          <td><button class="btn btn-sm" onclick="openEditCuenta(${n(c.rowIndex||4+i)})">✏</button></td>
        </tr>`).join('') : '<tr><td colspan="10" style="color:var(--muted);text-align:center;padding:20px">Sin cuentas. Crea Charles Schwab o deja EVA en Cuenta general.</td></tr>'}</tbody>
      </table></div>
    </div>`;
}

// ── Socios ────────────────────────────────────────────────────
function renderSocios() {
  return `
    <div class="alert-info"><strong>Inversionistas:</strong> tú eres el titular de la cuenta. Este módulo solo se usa cuando alguien externo aporta capital contigo. Si todo el dinero es tuyo, déjalo vacío.</div><div class="btn-row"><button class="btn btn-green" onclick="openModal('nuevo-socio')">+ Agregar inversionista</button></div>
    <div class="card">
      <div class="tbl-wrap"><table>
        <thead><tr><th>Inversionista</th><th>Capital</th><th>Participación</th><th>Ganancia</th><th>Ganancia MXN</th><th>Retiros</th><th>Saldo</th><th>Notas</th><th></th></tr></thead>
        <tbody>${D.socios.length ? D.socios.map((s,i) => {
          const total = D.socios.reduce((x,y)=>x+n(y.capital),0);
          const part = total ? n(s.capital)/total : 0;
          return `<tr>
            <td><strong>${esc(s.nombre)}</strong></td>
            <td>${money(s.capital)}</td>
            <td><span class="badge badge-green">${pct(part)}</span></td>
            <td class="green">${money(s.ganancia)}</td>
            <td class="green">${mxn(s.ganancia)}</td>
            <td class="red">-${money(s.retiros)}</td>
            <td><strong>${money(n(s.saldo)||(n(s.capital)+n(s.ganancia)-n(s.retiros)))}</strong></td>
            <td>${esc(s.notas||'—')}</td>
            <td><button class="btn btn-sm" onclick="openEditSocio(${n(s.rowIndex||4+i)},'${esc(String(s.nombre))}','${esc(String(s.notas||''))}')">✏</button></td>
          </tr>`;
        }).join('') : '<tr><td colspan="9" style="color:var(--muted);text-align:center;padding:20px">Sin inversionistas externos.</td></tr>'}</tbody>
      </table></div>
    </div>`;
}

// ── Watchlist ─────────────────────────────────────────────────
function renderWatchlist() {
  return `
    <div class="btn-row"><button class="btn btn-green" onclick="openModal('nueva-watch')">+ Agregar ticker</button></div>
    <div class="alert-info">Los precios en tiempo real se actualizan en tu Google Sheet con =GOOGLEFINANCE(). Sincroniza para ver los datos más recientes.</div>
    <div class="card">
      ${D.watchlist.length ? `<div class="tbl-wrap"><table>
        <thead><tr><th>Ticker</th><th>Nota</th><th>Precio actual</th><th>Cambio hoy</th><th>Precio meta</th><th>Falta</th><th>Alerta</th><th></th></tr></thead>
        <tbody>${D.watchlist.map(w => `<tr>
          <td><strong>${esc(w.ticker)}</strong></td>
          <td>${esc(w.nota||'—')}</td>
          <td>${w.precioActual ? money(w.precioActual) : '—'}</td>
          <td class="${n(w.cambioHoy)>=0?'green':'red'}">${w.cambioHoy !== '' && w.cambioHoy != null ? pct(w.cambioHoy) : '—'}</td>
          <td>${w.precioMeta ? money(w.precioMeta) : '—'}</td>
          <td>${w.faltaMeta !== '' && w.faltaMeta != null ? pct(w.faltaMeta) : '—'}</td>
          <td>${esc(w.alerta||'—')}</td>
          <td><button class="btn btn-sm btn-red" onclick="deleteWatch(${n(w.rowIndex)})">✕</button></td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<p style="color:var(--muted)">Sin tickers en watchlist.</p>'}
    </div>`;
}

// ── Conciliación Bancaria / Brokers ───────────────────────────
function renderImportador() {
  return `
    <div class="alert-info">
      <strong>Conciliación Bancaria:</strong><br>
      Pega movimientos de banco, broker o estado de cuenta. EVA detecta compras, ventas, depósitos, retiros, fees, dividendos, intereses, ajustes y vencimientos.<br>
      <strong>Clave:</strong> primero revisa la conciliación. No actualices tu capital real si la vista previa no cuadra con tu estado de cuenta.
    </div>
    <div class="card">
      <div class="card-title">Pegar historial bancario / broker</div>
      <div class="form-grid"><div class="form-group"><label>¿A qué cuenta pertenece esta conciliación?</label><select id="recon-account">${cuentaOptions(accountNameDefault())}</select></div></div>
      <textarea class="csv-area" id="csv-input" placeholder="Pega aquí el historial...&#10;Ejemplo Charles:&#10;Date    Action    Symbol    Description    Quantity    Price    Fees & Comm    Amount&#10;05/14/2026    Buy to Open    COIN 05/22/2026 255.00 C    CALL COINBASE GLOBAL INC $255 EXP 05/22/26    1    $1.51    $0.66    -$151.66&#10;05/14/2026    Sell to Close    COIN 05/22/2026 255.00 C    CALL COINBASE GLOBAL INC $255 EXP 05/22/26    1    $1.84    $0.66    $183.34"></textarea>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn btn-green" onclick="parseBankReconciliation()">🏦 Analizar conciliación</button>
        <button class="btn" onclick="$('csv-input').value=''">Limpiar</button>
        <button class="btn" onclick="crearRespaldoManual()">🧷 Crear respaldo</button>
        <button class="btn btn-red" onclick="resetAllToZero()">⚠ Restaurar todo a cero</button>
      </div>
      <div class="alert-warn" style="margin-top:10px">
        Usa <strong>Crear respaldo</strong> si quieres una copia segura de tu Google Sheet antes de borrar o conciliar. No tienes que trabajar en la copia; solo queda como seguro. Usa <strong>Restaurar todo a cero</strong> solo antes de iniciar una conciliación completa. Borra operaciones, inversionistas y watchlist, y pone capitales en $0. Conserva tu nombre, porcentajes/metas y tipo de cambio.
      </div>
    </div>
    <div id="csv-preview-wrap" class="hidden">
      <div class="sec-title">Vista previa — conciliación antes de importar</div>
      <div class="card csv-preview" id="csv-preview"></div>
      <div class="btn-row">
        <button class="btn btn-green" onclick="acceptFullReconciliation()">✓ Aceptar conciliación completa</button>
        <button class="btn" onclick="toggleReconciliationAdvanced()">⚙ Opciones avanzadas</button>
        <button class="btn" onclick="$('csv-preview-wrap').classList.add('hidden')">Cancelar</button>
      </div>
      <div id="recon-advanced" class="card hidden" style="margin-top:10px;border-style:dashed">
        <div class="card-title">Opciones avanzadas</div>
        <div class="alert-warn">Úsalas solo si sabes exactamente qué quieres actualizar. Para iniciar limpio desde un historial completo, lo más seguro es <strong>Aceptar conciliación completa</strong>.</div>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn btn-blue" onclick="applyReconciliationToConfig()">Solo actualizar capital real</button>
          <button class="btn" onclick="importOpenPositionsOnly(false)">Solo importar posiciones seleccionadas</button>
        </div>
      </div>
    </div>`;
}

let csvParsed = [];
let bankParsed = null;

function splitSchwabLine(line) {
  // Charles pegado desde tabla suele venir separado por tabs. El CSV real puede venir con comas y comillas.
  if (line.includes('\t')) return line.split('\t').map(c => c.trim());
  const out = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i+1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur.trim()); cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out.map(c => c.replace(/^"|"$/g, '').trim());
}

function cleanSchwabDate(dateStr) {
  const s = String(dateStr || '').trim();
  const asOf = s.match(/as of\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  const first = s.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/);
  return (asOf ? asOf[1] : (first ? first[0] : s));
}

function formatSchwabDate(dateStr) {
  const clean = cleanSchwabDate(dateStr);
  const parts = clean.split('/');
  if (parts.length === 3) {
    const [m, d, y] = parts;
    return `${y.length === 2 ? '20'+y : y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  return clean || todayISO;
}

function actionKind(action) {
  const a = String(action || '').trim().toLowerCase();
  if (!a || a === 'action') return null;
  if (a.includes('buy to open') || a.includes('bought to open')) return 'buy_open';
  if (a.includes('sell to close') || a.includes('sold to close')) return 'sell_close';
  if (a.includes('expired')) return 'expired';
  if (a === 'buy' || a === 'bought' || a.includes(' compra')) return 'buy';
  if (a === 'sell' || a === 'sold' || a.includes(' venta')) return 'sell';
  return null;
}

function bankMovementKind(action, desc, amount) {
  const a = String(action || '').trim().toLowerCase();
  const d = String(desc || '').trim().toLowerCase();
  if (!a || a === 'action') return null;
  if (actionKind(action)) return 'trade';
  if (a.includes('wire received') || a.includes('deposit') || a.includes('received') || d.includes('funds received')) return 'deposito';
  if (a.includes('wire sent') || a.includes('withdraw') || a.includes('disbursed') || d.includes('funds disbursed')) return 'retiro';
  if (a.includes('service fee') || d.includes('fee')) return 'fee';
  if (a.includes('credit interest') || d.includes('int ')) return 'interes';
  if (a.includes('cash dividend') || a.includes('dividend')) return 'dividendo';
  if (a.includes('nra tax') || a.includes('tax')) return 'impuesto';
  if (a.includes('misc cash') || a.includes('adjustment') || d.includes('refund') || d.includes('waive')) return 'ajuste';
  if (a.includes('journal')) return 'journal';
  if (amount !== 0) return amount > 0 ? 'entrada_otro' : 'salida_otro';
  return 'ignorado';
}

function parseOptionInfo(symbol, desc) {
  const sym = String(symbol || '').trim();
  const d = String(desc || '').trim();
  const root = (sym.split(/\s+/)[0] || '').toUpperCase();
  const type = /\bPUT\b/i.test(d) || /\bP\b\s*$/i.test(sym) ? 'PUT' : 'CALL';
  let strike = 0;
  const m1 = sym.match(/\s(\d+(?:\.\d+)?)\s*[CP]\b/i);
  const m2 = d.match(/\$(\d+(?:\.\d+)?)/);
  if (m1) strike = n(m1[1]);
  else if (m2) strike = n(m2[1]);
  let exp = '';
  const dm = sym.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/) || d.match(/EXP\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  if (dm) exp = formatSchwabDate(dm[1]);
  return { root, type, strike, exp, key: sym.toUpperCase() };
}

function isOptionRow(kind, symbol, desc) {
  const s = String(symbol || '');
  const d = String(desc || '');
  return kind === 'buy_open' || kind === 'sell_close' || kind === 'expired' || /\b(CALL|PUT)\b/i.test(d) || /\d{1,2}\/\d{1,2}\/\d{2,4}.*\b[CP]\b/i.test(s);
}

function schwabActionOrder(kind) {
  if (kind === 'buy' || kind === 'buy_open') return 1;
  if (kind === 'sell' || kind === 'sell_close' || kind === 'expired') return 2;
  return 9;
}

function parseBankRows(raw) {
  const lines = raw.split(/\r?\n/).map(l => l.replace(/\r/g, '')).filter(l => l.trim());
  const trades = [], movements = [], errors = [];

  lines.forEach((line, idx) => {
    const cols = splitSchwabLine(line);
    if (cols.length < 8) { errors.push(`Línea ${idx+1}: columnas insuficientes`); return; }
    const [date, action, symbol, desc, qty, price, fees, amount] = cols;
    if (String(action || '').trim().toLowerCase() === 'action') return;
    const amt = n(amount);
    const kind = actionKind(action);
    const common = {
      dateRaw: date || '',
      date: formatSchwabDate(date),
      actionRaw: action || '',
      symbol: String(symbol || '').trim().toUpperCase(),
      desc: desc || '',
      qty: Math.abs(n(qty)),
      price: Math.abs(n(price)),
      fees: Math.abs(n(fees)),
      amount: amt,
      raw: line,
      idx
    };

    if (kind) {
      const option = isOptionRow(kind, symbol, desc);
      const opt = option ? parseOptionInfo(symbol, desc) : null;
      trades.push({
        ...common,
        kind,
        action: (kind === 'buy' || kind === 'buy_open') ? 'buy' : 'sell',
        assetType: option ? 'opcion' : 'accion',
        root: option ? opt.root : String(symbol || '').trim().toUpperCase(),
        price: kind === 'expired' ? 0 : Math.abs(n(price)),
        strike: option ? opt.strike : 0,
        optionType: option ? opt.type : '',
        expiration: option ? opt.exp : '',
        key: option ? opt.key : String(symbol || '').trim().toUpperCase()
      });
    } else {
      const bkind = bankMovementKind(action, desc, amt);
      movements.push({ ...common, movementKind: bkind });
    }
  });

  trades.sort((a,b) => {
    const ad = new Date(a.date + 'T00:00:00').getTime() || 0;
    const bd = new Date(b.date + 'T00:00:00').getTime() || 0;
    if (ad !== bd) return ad - bd;
    const ao = schwabActionOrder(a.kind), bo = schwabActionOrder(b.kind);
    if (ao !== bo) return ao - bo;
    return a.idx - b.idx;
  });
  movements.sort((a,b) => String(a.date).localeCompare(String(b.date)) || a.idx - b.idx);
  return { trades, movements, errors };
}

function allocFromLots(lots, qtyToClose, proceedsNet) {
  let qtyLeft = qtyToClose;
  const perUnitProceed = qtyToClose ? proceedsNet / qtyToClose : 0;
  let closedCost = 0, pnl = 0, closedQty = 0;
  while (qtyLeft > 0.0000001 && lots.length) {
    const lot = lots[0];
    const q = Math.min(qtyLeft, lot.qty);
    const costPart = lot.qty ? lot.cost * (q / lot.qty) : 0;
    const proceedsPart = perUnitProceed * q;
    closedCost += costPart;
    pnl += proceedsPart - costPart;
    closedQty += q;
    lot.qty -= q;
    lot.cost -= costPart;
    qtyLeft -= q;
    if (lot.qty <= 0.0000001) lots.shift();
  }
  return { closedCost, pnl, closedQty, remainingUnmatchedQty: qtyLeft };
}

function buildReconciliation(parsed) {
  const stockLots = {}, optionLots = {};
  const summary = {
    deposits: 0, withdrawals: 0, feesBank: 0, dividends: 0, interest: 0, taxes: 0, adjustments: 0, otherCash: 0,
    buyCash: 0, sellCash: 0, cashFromAllRows: 0,
    realizedAcc: 0, realizedOpc: 0, closedAcc: 0, closedOpc: 0, unmatched: 0
  };

  parsed.movements.forEach(m => {
    summary.cashFromAllRows += n(m.amount);
    const amt = n(m.amount);
    if (m.movementKind === 'deposito') summary.deposits += amt;
    else if (m.movementKind === 'retiro') summary.withdrawals += amt;
    else if (m.movementKind === 'fee') summary.feesBank += amt;
    else if (m.movementKind === 'dividendo') summary.dividends += amt;
    else if (m.movementKind === 'interes') summary.interest += amt;
    else if (m.movementKind === 'impuesto') summary.taxes += amt;
    else if (m.movementKind === 'ajuste') summary.adjustments += amt;
    else if (m.movementKind !== 'journal' && m.movementKind !== 'ignorado') summary.otherCash += amt;
  });

  parsed.trades.forEach(r => {
    summary.cashFromAllRows += n(r.amount);
    if (r.amount < 0) summary.buyCash += Math.abs(r.amount);
    if (r.amount > 0) summary.sellCash += r.amount;

    if (r.assetType === 'accion') {
      const key = r.symbol;
      const lots = stockLots[key] ||= [];
      if (r.kind === 'buy') {
        lots.push({ key, ticker: key, qty: r.qty, cost: Math.abs(r.amount) || (r.qty * r.price + r.fees), date: r.date, price: r.price, desc: r.desc });
      } else if (r.kind === 'sell') {
        const res = allocFromLots(lots, r.qty, Math.abs(r.amount));
        summary.realizedAcc += res.pnl;
        summary.closedAcc++;
        if (res.remainingUnmatchedQty > 0.0000001) summary.unmatched++;
      }
    } else {
      const key = r.key;
      const lots = optionLots[key] ||= [];
      if (r.kind === 'buy_open') {
        lots.push({ key, root: r.root, qty: r.qty, cost: Math.abs(r.amount) || (r.qty * r.price * 100 + r.fees), date: r.date, price: r.price, strike: r.strike, optionType: r.optionType, expiration: r.expiration, desc: r.desc });
      } else if (r.kind === 'sell_close') {
        const res = allocFromLots(lots, r.qty, Math.abs(r.amount));
        summary.realizedOpc += res.pnl;
        summary.closedOpc++;
        if (res.remainingUnmatchedQty > 0.0000001) summary.unmatched++;
      } else if (r.kind === 'expired') {
        const res = allocFromLots(lots, Math.abs(r.qty) || lots.reduce((s,l)=>s+l.qty,0), 0);
        summary.realizedOpc += res.pnl;
        summary.closedOpc++;
      }
    }
  });

  const openStocks = Object.values(stockLots).flat().filter(l => l.qty > 0.0000001).map(l => ({ ...l, assetType: 'accion', occupied: l.cost }));
  const openOptions = Object.values(optionLots).flat().filter(l => l.qty > 0.0000001).map(l => ({ ...l, assetType: 'opcion', occupied: l.cost }));
  const occupiedAcc = openStocks.reduce((s,l)=>s+l.occupied,0);
  const occupiedOpc = openOptions.reduce((s,l)=>s+l.occupied,0);
  const occupied = occupiedAcc + occupiedOpc;
  const cash = summary.cashFromAllRows;
  const estimatedEquityCost = cash + occupied;
  const netContributed = summary.deposits + summary.withdrawals + summary.feesBank;

  return { ...parsed, summary: { ...summary, openStocks, openOptions, occupiedAcc, occupiedOpc, occupied, cash, estimatedEquityCost, netContributed } };
}

function parseBankReconciliation() {
  const raw = $('csv-input').value.trim();
  if (!raw) { showToast('Pega el historial primero.', 'error'); return; }
  const parsed = buildReconciliation(parseBankRows(raw));
  bankParsed = parsed;
  csvParsed = parsed.trades;
  if (!csvParsed.length && !parsed.movements.length) { showToast('No se encontraron movimientos reconocibles.', 'error'); return; }

  const s = parsed.summary;
  const preferredOpcBudget = Math.max(0, cfg().capOpc || cfg().planCapOpc || 0);
  const suggestedOpc = Math.min(Math.max(0, s.estimatedEquityCost), Math.max(s.occupiedOpc, preferredOpcBudget));
  const suggestedAcc = Math.max(0, s.estimatedEquityCost - suggestedOpc);
  const openTotal = s.openStocks.length + s.openOptions.length;
  const movementRows = parsed.movements.filter(m => m.movementKind !== 'journal' && m.movementKind !== 'ignorado').slice(-20).reverse();
  const tradeRows = csvParsed.slice(-25).reverse();

  $('csv-preview').innerHTML = `
    <div class="alert-info">
      EVA reconstruyó la cuenta usando todos los importes del historial. <strong>Efectivo disponible estimado</strong> = suma de cash flows. <strong>Capital ocupado</strong> = costo de posiciones abiertas. Si falta una parte del historial, estos números pueden descuadrar.<br>
      <strong>Importante:</strong> usa <strong>Aceptar conciliación completa</strong> para evitar doble conteo. Si actualizas capital real y además importas todo el historial como trades contabilizados, el dashboard se descuadra porque suma el P&amp;L histórico dos veces.
    </div>
    <div class="kpi-grid">
      ${kpi('Depósitos detectados', money(s.deposits), '', 'teal')}
      ${kpi('Retiros detectados', money(s.withdrawals), '', 'red')}
      ${kpi('Fees bancarios', money(s.feesBank), '', 'red')}
      ${kpi('Dividendos + intereses', money(s.dividends + s.interest), '', 'teal')}
      ${kpi('Efectivo disponible estimado', money(s.cash), mxn(s.cash), s.cash>=0?'teal':'red')}
      ${kpi('Ocupado en acciones', money(s.occupiedAcc), `${s.openStocks.length} abiertas`, 'teal')}
      ${kpi('Ocupado en opciones', money(s.occupiedOpc), `${s.openOptions.length} abiertas`, 'blue')}
      ${kpi('Capital estimado a costo', money(s.estimatedEquityCost), 'Cash + costo abierto', s.estimatedEquityCost>=0?'teal':'red')}
      ${kpi('P&L realizado acciones', money(s.realizedAcc), '', s.realizedAcc>=0?'teal':'red')}
      ${kpi('P&L realizado opciones', money(s.realizedOpc), '', s.realizedOpc>=0?'teal':'red')}
      ${kpi('Operaciones cerradas', String(s.closedAcc + s.closedOpc), `Acc: ${s.closedAcc} · Opc: ${s.closedOpc}`, 'amber')}
      ${kpi('Operaciones abiertas', String(openTotal), `Acc: ${s.openStocks.length} · Opc: ${s.openOptions.length}`, openTotal?'amber':'teal')}
    </div>

    ${s.unmatched ? `<div class="alert-warn">⚠️ Hay ${s.unmatched} cierres que no pudieron empatarse con una apertura previa. Puede faltar historial anterior o hubo ventas parciales complejas.</div>` : ''}

    <div class="sec-title">Actualizar capital real en EVA</div>
    <div class="alert-warn">⚠️ Como hoy manejas una sola cuenta, EVA te propone una separación editable. Revísala antes de aplicarla.</div>
    <div class="form-grid">
      <div class="form-group"><label>Capital acciones sugerido</label><input type="number" id="recon-cap-acciones" step="0.01" value="${suggestedAcc.toFixed(2)}"></div>
      <div class="form-group"><label>Capital opciones sugerido</label><input type="number" id="recon-cap-opciones" step="0.01" value="${suggestedOpc.toFixed(2)}"></div>
      <div class="form-group"><label>También actualizar capital inicial plan</label><select id="recon-update-plan"><option value="si">Sí</option><option value="no">No</option></select></div>
    </div>

    <div class="sec-title">Posiciones abiertas que SÍ se cargarán al aceptar</div>
    <div class="alert-info">Estas son las únicas posiciones que EVA cargará como activas. Si alguna no corresponde, desmárcala antes de aceptar. El historial cerrado solo se usa para calcular el saldo y no se importará como trade activo.</div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Cargar</th><th>Tipo</th><th>Activo / contrato</th><th>Cantidad</th><th>Costo ocupado</th><th>Fecha apertura</th></tr></thead>
      <tbody>${[...s.openStocks.map((l,i)=>({...l,_idx:i})), ...s.openOptions.map((l,i)=>({...l,_idx:i}))].length ? [...s.openStocks.map((l,i)=>({...l,_idx:i})), ...s.openOptions.map((l,i)=>({...l,_idx:i}))].map(l => `<tr>
        <td><input type="checkbox" class="recon-open-check" data-type="${l.assetType}" data-index="${l._idx}" checked></td>
        <td><span class="badge ${l.assetType==='opcion'?'badge-blue':'badge-green'}">${l.assetType==='opcion'?'Opción':'Acción'}</span></td>
        <td><strong>${esc(l.assetType==='opcion' ? `${l.root} ${l.expiration||''} ${l.strike||''} ${l.optionType||''}` : l.ticker)}</strong><br><small style="color:var(--muted)">${esc(l.desc||'')}</small></td>
        <td>${l.qty}</td><td>${money(l.occupied)}</td><td>${dateText(l.date)}</td>
      </tr>`).join('') : '<tr><td colspan="6" style="color:var(--muted);text-align:center;padding:18px">No hay posiciones abiertas detectadas.</td></tr>'}</tbody>
    </table></div>

    <div class="sec-title">Movimientos bancarios detectados</div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Fecha</th><th>Tipo</th><th>Acción</th><th>Descripción</th><th>Monto</th></tr></thead>
      <tbody>${movementRows.length ? movementRows.map(m => `<tr>
        <td>${dateText(m.date)}</td><td><span class="badge badge-gray">${esc(m.movementKind)}</span></td><td>${esc(m.actionRaw)}</td><td>${esc(m.desc||'—')}</td><td class="${m.amount>=0?'green':'red'}">${money(m.amount)}</td>
      </tr>`).join('') : '<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:18px">Sin movimientos bancarios relevantes.</td></tr>'}</tbody>
    </table></div>

    <div class="sec-title">Historial de operaciones detectado — solo para cálculo</div>
    <div class="alert-info">Estas operaciones cerradas no se importan como trades activos cuando usas <strong>Aceptar conciliación completa</strong>. EVA las usa para reconstruir efectivo, P&amp;L histórico y posiciones abiertas.</div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Fecha</th><th>Tipo</th><th>Acción</th><th>Activo</th><th>Cantidad</th><th>Precio</th><th>Comisión</th><th>Monto</th></tr></thead>
      <tbody>${tradeRows.length ? tradeRows.map(r => `<tr>
        <td>${dateText(r.date)}</td>
        <td><span class="badge ${r.assetType==='opcion'?'badge-blue':'badge-green'}">${r.assetType==='opcion'?'Opción':'Acción'}</span></td>
        <td><span class="badge ${r.action==='buy'?'badge-green':'badge-red'}">${esc(r.actionRaw)}</span></td>
        <td><strong>${esc(r.assetType==='opcion' ? `${r.root} ${r.expiration || ''} ${r.strike || ''} ${r.optionType}` : r.symbol)}</strong></td>
        <td>${r.qty}</td><td>${money(r.price)}</td><td>${money(r.fees)}</td><td class="${r.amount>=0?'green':'red'}">${money(r.amount)}</td>
      </tr>`).join('') : '<tr><td colspan="8" style="color:var(--muted);text-align:center;padding:18px">Sin operaciones de compra/venta detectadas en el historial.</td></tr>'}</tbody>
    </table></div>
    ${parsed.errors.length ? `<div class="alert-warn" style="margin-top:10px">⚠️ ${parsed.errors.length} líneas ignoradas: ${parsed.errors.slice(0,4).join(', ')}</div>` : ''}
    <p style="font-size:12px;color:var(--muted);margin-top:10px">Se detectaron <strong>${csvParsed.length}</strong> movimientos de trading y <strong>${parsed.movements.length}</strong> movimientos bancarios/no operativos.</p>`;
  $('csv-preview-wrap').classList.remove('hidden');
}

// Compatibilidad con versiones anteriores del botón.
function parseSchwabCSV() { parseBankReconciliation(); }

function toggleReconciliationAdvanced() {
  const el = $('recon-advanced');
  if (el) el.classList.toggle('hidden');
}

function getSelectedOpenPositionsForReconciliation() {
  const s = bankParsed?.summary || {};
  const openStocks = s.openStocks || [];
  const openOptions = s.openOptions || [];
  const checks = Array.from(document.querySelectorAll('.recon-open-check'));

  // Si el DOM no tiene checkboxes, asumimos todas las posiciones abiertas. Esto mantiene compatibilidad
  // cuando se llama desde flujos viejos o si el navegador aún no refrescó la vista previa.
  if (!checks.length) return { stocks: openStocks, options: openOptions };

  const selectedStocks = [];
  const selectedOptions = [];
  checks.filter(c => c.checked).forEach(c => {
    const type = c.dataset.type;
    const idx = Number(c.dataset.index);
    if (type === 'accion' && openStocks[idx]) selectedStocks.push(openStocks[idx]);
    if (type === 'opcion' && openOptions[idx]) selectedOptions.push(openOptions[idx]);
  });
  return { stocks: selectedStocks, options: selectedOptions };
}

function selectedOpenPositionsCountText() {
  const selected = getSelectedOpenPositionsForReconciliation();
  return `${selected.stocks.length + selected.options.length} posición(es) seleccionada(s)`;
}

async function applyReconciliationToConfig() {
  if (!bankParsed) { showToast('Primero analiza la conciliación.', 'error'); return; }
  try {
    await saveReconciledCapital();
    await syncAll();
    showToast('Capital real actualizado. No importé historial para evitar doble conteo.', 'success');
  } catch(e) { showToast(e.message || 'No se pudo actualizar capital.', 'error'); }
}


async function crearRespaldoManual() {
  const ok = confirm('EVA creará una copia completa de tu Google Sheet como respaldo. No se modificará tu hoja actual. ¿Crear respaldo ahora?');
  if (!ok) return;
  try {
    showToast('Creando respaldo...', 'info');
    const res = await api('crearRespaldo', {});
    const url = res && res.url ? res.url : '';
    showToast('Respaldo creado correctamente.', 'success');
    if (url) {
      const openIt = confirm('Respaldo creado. ¿Quieres abrir la copia en otra pestaña?');
      if (openIt) window.open(url, '_blank');
    }
  } catch(e) {
    console.error(e);
    showToast(e.message || 'No se pudo crear el respaldo.', 'error');
  }
}

async function resetAllToZero() {
  const msg = 'Esto va a borrar operaciones, socios y watchlist, además de poner capital actual y capital inicial de planes en $0.\n\nEscribe RESTAURAR para confirmar.';
  const confirmText = window.prompt(msg);
  if (confirmText === null) return;
  if (String(confirmText).trim().toUpperCase() !== 'RESTAURAR') {
    showToast('Restauración cancelada. No se hicieron cambios.', 'info');
    return;
  }

  try {
    showToast('Restaurando EVA a cero...', 'info');
    await api('resetAllToZero', { confirm: 'RESTAURAR' });
    csvParsed = [];
    bankParsed = null;
    const input = $('csv-input');
    if (input) input.value = '';
    const preview = $('csv-preview-wrap');
    if (preview) preview.classList.add('hidden');
    await syncAll();
    currentPage = 'importador';
    renderAll();
    showToast('EVA quedó en cero. Ya puedes iniciar la Conciliación Bancaria.', 'success');
  } catch(e) {
    showToast(e.message || 'No se pudo restaurar EVA a cero.', 'error');
  }
}


function reconciliationSuggestedCapital() {
  if (!bankParsed) return { capAcc: 0, capOpc: 0 };
  const s = bankParsed.summary || {};
  const capAccEl = $('recon-cap-acciones');
  const capOpcEl = $('recon-cap-opciones');
  return {
    capAcc: n(capAccEl ? capAccEl.value : 0),
    capOpc: n(capOpcEl ? capOpcEl.value : 0),
    updatePlan: $('recon-update-plan')?.value !== 'no',
    accountName: $('recon-account')?.value || accountNameDefault()
  };
}

async function saveReconciledCapital() {
  const chosen = reconciliationSuggestedCapital();
  const payload = { capitalAcciones: chosen.capAcc, capitalOpciones: chosen.capOpc };
  if (chosen.updatePlan) {
    payload.planCapitalAcciones = chosen.capAcc;
    payload.planCapitalOpciones = chosen.capOpc;
  }
  await api('saveConfig', payload);
  if (chosen.accountName) {
    const sum = bankParsed?.summary || {};
    const saldo = n(sum.estimatedEquityCost) || (chosen.capAcc + chosen.capOpc);
    const ocupado = n(sum.occupied);
    await api('updateCuentaByName', { nombre: chosen.accountName, saldoConciliado: saldo, capitalOcupado: ocupado, disponible: saldo - ocupado });
  }
  return chosen;
}

async function importOpenPositionsOnly(resetFirst = false) {
  if (!bankParsed) { showToast('Primero analiza la conciliación.', 'error'); return; }
  const selected = getSelectedOpenPositionsForReconciliation();
  const openStocks = selected.stocks || [];
  const openOptions = selected.options || [];
  if (!openStocks.length && !openOptions.length) {
    showToast('No hay posiciones seleccionadas para importar.', 'info');
    return;
  }

  try {
    showToast('Importando posiciones abiertas seleccionadas...', 'info');
    if (resetFirst) await api('resetAllToZero', { confirm: 'RESTAURAR' });

    let ok = 0;
    for (const l of openStocks) {
      const qty = n(l.qty);
      const avg = qty ? n(l.occupied) / qty : n(l.price);
      await api('saveAccion', {
        ticker: l.ticker || l.key,
        acciones: qty,
        precioCompra: avg,
        comision: 0,
        fechaCompra: l.date || todayISO,
        contabiliza: false,
        accountName: $('recon-account')?.value || accountNameDefault()
      });
      ok++;
    }
    for (const l of openOptions) {
      const qty = n(l.qty);
      const avgPremium = qty ? n(l.occupied) / (qty * 100) : n(l.price);
      await api('saveOpcion', {
        empresa: l.root || l.key,
        strike: n(l.strike),
        tipo: l.optionType || 'CALL',
        contratos: qty,
        primaCompra: avgPremium,
        comision: 0,
        fechaApertura: l.date || todayISO,
        fechaVencim: l.expiration || '',
        contabiliza: false,
        accountName: $('recon-account')?.value || accountNameDefault()
      });
      ok++;
    }
    await syncAll();
    showToast(`Posiciones abiertas seleccionadas importadas: ${ok}.`, 'success');
  } catch(e) {
    showToast(e.message || 'No se pudieron importar posiciones abiertas.', 'error');
  }
}

async function acceptFullReconciliation() {
  if (!bankParsed) { showToast('Primero analiza la conciliación.', 'error'); return; }
  const selected = getSelectedOpenPositionsForReconciliation();
  const selectedCount = selected.stocks.length + selected.options.length;
  const ok = window.confirm(`Aceptar conciliación completa va a restaurar operaciones anteriores, guardar el capital real estimado y cargar solo las posiciones abiertas que dejaste marcadas (${selectedCount}). El historial cerrado se usará únicamente para cálculo, sin importarse como trades activos. ¿Continuamos?`);
  if (!ok) return;
  try {
    showToast('Aplicando conciliación completa...', 'info');
    await api('resetAllToZero', { confirm: 'RESTAURAR' });
    await saveReconciledCapital();
    await importOpenPositionsOnly(false);
    csvParsed = [];
    bankParsed = null;
    const input = $('csv-input');
    if (input) input.value = '';
    const preview = $('csv-preview-wrap');
    if (preview) preview.classList.add('hidden');
    await syncAll();
    currentPage = 'dashboard';
    renderAll();
    showToast('Conciliación completa aplicada: capital actualizado y solo posiciones marcadas cargadas.', 'success');
  } catch(e) {
    showToast(e.message || 'No se pudo aplicar la conciliación completa.', 'error');
  }
}

async function importCSVTrades() {
  if (!csvParsed.length) { showToast('No hay operaciones para importar.', 'error'); return; }
  let ok = 0, err = 0;
  const optionRows = {}; // key exacta de contrato → fila en hoja Opciones
  const stockRows = {};  // ticker → filas abiertas FIFO
  showToast('Importando operaciones...', 'info');

  for (const r of csvParsed) {
    try {
      if (r.assetType === 'opcion') {
        if (r.kind === 'buy_open') {
          const saved = await api('saveOpcion', {
            empresa: r.root,
            strike: r.strike,
            tipo: r.optionType || 'CALL',
            contratos: r.qty,
            primaCompra: r.price,
            comision: r.fees,
            fechaApertura: r.date,
            fechaVencim: r.expiration,
            contabiliza: false
          });
          const row = saved && (saved.row || saved.rowIndex);
          if (row) (optionRows[r.key] ||= []).push(row);
        } else if (r.kind === 'sell_close' || r.kind === 'expired') {
          const row = (optionRows[r.key] || []).shift() || '';
          await api('closeOpcion', {
            rowIndex: row,
            empresa: r.root,
            primaVenta: r.price,
            comisionCierre: r.fees,
            fechaCierre: r.date
          });
        }
      } else {
        if (r.kind === 'buy') {
          const saved = await api('saveAccion', { ticker: r.symbol, acciones: r.qty, precioCompra: r.price, comision: r.fees, fechaCompra: r.date, contabiliza: false });
          const row = saved && (saved.row || saved.rowIndex);
          if (row) (stockRows[r.symbol] ||= []).push(row);
        } else if (r.kind === 'sell') {
          const row = (stockRows[r.symbol] || []).shift() || '';
          await api('closeAccion', { rowIndex: row, ticker: r.symbol, precioVenta: r.price, comisionCierre: r.fees, fechaCierre: r.date });
        }
      }
      ok++;
    } catch(e) {
      console.warn('Error importando línea de conciliación:', r, e);
      err++;
    }
  }
  $('csv-preview-wrap').classList.add('hidden');
  $('csv-input').value = '';
  csvParsed = [];
  bankParsed = null;
  await syncAll();
  showToast(`Importadas: ${ok} operaciones${err ? `, ${err} errores` : ''}.`, ok > 0 ? 'success' : 'error');
}

// ── Reportes ──────────────────────────────────────────────────
function renderReportes() {
  const d = getDash();
  const periods = ['hoy','semana','mes','anio'].map(p => ({ label: {hoy:'Hoy',semana:'Esta semana',mes:'Este mes',anio:'Este año'}[p], ...getPeriod(p) }));
  const totalAll = { pnlAcc: d.pnlAcc||0, pnlOpc: d.pnlOpc||0, total: d.pnl||0 };

  return `
    <div class="btn-row">
      <button class="btn btn-green" onclick="window.print()">🖨 Exportar PDF</button>
    </div>
    <div class="kpi-grid">
      ${kpi('Capital total', money(d.capTotal), mxn(d.capTotal), 'teal')}
      ${kpi('P&L total', money(d.pnl), mxn(d.pnl), n(d.pnl)>=0?'teal':'red')}
      ${kpi('Rendimiento', pct(d.rend), '', n(d.rend)>=0?'amber':'red')}
      ${kpi('Comisiones', '-'+money(d.comm), '', 'red')}
    </div>
    ${[...periods, {label:'Total histórico', ...totalAll}].map(p => `
    <div class="card" style="page-break-inside:avoid">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
        <div class="card-title" style="margin:0">Reporte — ${p.label}</div>
        <div style="font-size:12px;color:var(--muted)">${new Date().toLocaleDateString('es-MX',{day:'numeric',month:'long',year:'numeric'})}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        ${[
          ['P&L acciones (USD)', money(p.pnlAcc||0), n(p.pnlAcc)>=0],
          ['P&L acciones (MXN)', mxn(p.pnlAcc||0), n(p.pnlAcc)>=0],
          ['P&L opciones (USD)', money(p.pnlOpc||0), n(p.pnlOpc)>=0],
          ['P&L opciones (MXN)', mxn(p.pnlOpc||0), n(p.pnlOpc)>=0],
          ['P&L total (USD)', money(p.total||0), n(p.total)>=0],
          ['P&L total (MXN)', mxn(p.total||0), n(p.total)>=0],
          ['Capital acciones', money(d.capAcc), true],
          ['Capital opciones', money(d.capOpc), true],
          ['Capital total (USD)', money(d.capTotal), true],
          ['Capital total (MXN)', mxn(d.capTotal), true],
          ['Tipo de cambio', '$'+FX.toFixed(2)+' MXN/USD', true],
        ].map(([lbl,val,pos]) => `<div style="display:flex;justify-content:space-between;padding:7px 10px;background:${pos?'var(--teal-l)':'var(--gray)'};border-radius:6px">
          <span style="font-size:12px;color:var(--muted)">${lbl}</span>
          <span style="font-size:13px;font-weight:600;color:${pos?'var(--teal-d)':'var(--red)'}">${val}</span>
        </div>`).join('')}
      </div>
    </div>`).join('')}
    <div class="sec-title">Gráfica P&L por período</div>
    <div class="card"><div class="chart-wrap"><canvas id="report-chart"></canvas></div></div>`;
}

function drawReportChart() {
  const canvas = document.getElementById('report-chart');
  if (!canvas) return;
  const ps = ['hoy','semana','mes','anio'].map(p => getPeriod(p));
  const labels = ['Hoy','Esta semana','Este mes','Este año'];
  if (chartInstances.report) { try { chartInstances.report.destroy(); } catch(e) {} }
  chartInstances.report = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Acciones USD', data: ps.map(p => +p.pnlAcc.toFixed(2)), backgroundColor: '#1D9E75', borderRadius: 6 },
        { label: 'Opciones USD', data: ps.map(p => +p.pnlOpc.toFixed(2)), backgroundColor: '#185FA5', borderRadius: 6 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + money(ctx.parsed.y) } } },
      scales: { x: { grid: { display: false } }, y: { ticks: { callback: v => money(v) }, grid: { color: 'rgba(0,0,0,.06)' } } }
    }
  });
}

// ── Modales ───────────────────────────────────────────────────
function openModal(type) {
  const overlay = $('modal-overlay');
  const box = $('modal-box');
  overlay.classList.remove('hidden');

  if (type === 'config') {
    const c = cfg();
    box.innerHTML = `<div class="modal-title">⚙ Configuración de EVA y planes</div>
      <div class="alert-info" style="margin-bottom:12px">Aquí puedes corregir tu capital sin romper el sistema y definir con cuánto inicia cada plan. Capital de cuenta = estado real de Charles. Capital inicial plan = base para la guía compuesta.</div>
      <div class="form-grid">
        <div class="form-group"><label>Nombre para bienvenida</label><input type="text" id="m-cfg-nombre" value="${esc(c.nombre)}"></div>
        <div class="form-group"><label>Tipo de cambio USD/MXN</label><input type="number" id="m-cfg-fx" value="${c.fx}" step="0.01"></div>
        <div class="form-group"><label>Capital actual acciones / Charles ($)</label><input type="number" id="m-cfg-cap-acc" value="${c.capAcc}" step="0.01"></div>
        <div class="form-group"><label>Capital actual opciones / Charles ($)</label><input type="number" id="m-cfg-cap-opc" value="${c.capOpc}" step="0.01"></div>
        <div class="form-group"><label>Capital inicial plan acciones ($)</label><input type="number" id="m-cfg-plan-cap-acc" value="${c.planCapAcc}" step="0.01"></div>
        <div class="form-group"><label>Capital inicial plan opciones ($)</label><input type="number" id="m-cfg-plan-cap-opc" value="${c.planCapOpc}" step="0.01"></div>
        <div class="form-group"><label>Fecha inicio plan acciones</label><input type="date" id="m-cfg-plan-inicio-acc" value="${c.planInicioAcc}"></div>
        <div class="form-group"><label>Fecha inicio plan opciones</label><input type="date" id="m-cfg-plan-inicio-opc" value="${c.planInicioOpc}"></div>
        <div class="form-group"><label>Mínimo acciones (%)</label><input type="number" id="m-cfg-min-acc" value="${(c.metaMinAcc*100).toFixed(1)}" step="0.1"></div>
        <div class="form-group"><label>Meta ideal acciones (%)</label><input type="number" id="m-cfg-meta-acc" value="${(c.metaMaxAcc*100).toFixed(1)}" step="0.1"></div>
        <div class="form-group"><label>Mínimo opciones (%)</label><input type="number" id="m-cfg-min-opc" value="${(c.metaMinOpc*100).toFixed(1)}" step="0.1"></div>
        <div class="form-group"><label>Meta ideal opciones (%)</label><input type="number" id="m-cfg-meta-opc" value="${(c.metaMaxOpc*100).toFixed(1)}" step="0.1"></div>
        <div class="form-group"><label>Días operables por mes</label><input type="number" id="m-cfg-dias" value="${c.diasMes}" min="1" max="31"></div>
        <div class="form-group"><label>Meses del plan</label><input type="number" id="m-cfg-meses" value="${c.meses}" min="1"></div>
        <div class="form-group"><label>% capital usado acciones</label><input type="number" id="m-cfg-uso-acc" value="${(c.usoAcc*100).toFixed(0)}" step="1"></div>
        <div class="form-group"><label>% capital usado opciones</label><input type="number" id="m-cfg-uso-opc" value="${(c.usoOpc*100).toFixed(0)}" step="1"></div>
        <div class="form-group"><label>Operaciones de opciones por semana</label><input type="number" id="m-cfg-ops-opc" value="${c.operacionesSemanaOpciones}" min="1" max="10"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-green" onclick="saveConfig()">Guardar configuración</button>
        <button class="btn" onclick="closeModal()">Cancelar</button>
      </div>`;
    return;
  }

  if (type === 'nueva-pos-accion') {
    const ctx = currentPlanContext && currentPlanContext.kind === 'acciones' ? currentPlanContext : null;
    const ctxInfo = ctx ? `<div class="alert-info">Trade del plan · ${ctx.kind === 'acciones' ? 'Día' : 'Operación'} ${ctx.day} · Fecha ${dateText(ctx.date)} · Capital operable disponible: <strong>${money(ctx.amount)}</strong> · Rango: ${(ctx.minPct*100).toFixed(1)}%-${(ctx.targetPct*100).toFixed(1)}%</div>` : '';
    box.innerHTML = `<div class="modal-title">+ Nueva posición — Acción</div>
      ${ctxInfo}
      <div class="form-grid">
        <div class="form-group"><label>Ticker</label><input type="text" id="m-ticker" style="text-transform:uppercase" placeholder="AAPL"></div>
        <div class="form-group"><label>Nº acciones</label><input type="number" id="m-acciones" placeholder="10" step="1"></div>
        <div class="form-group"><label>Precio compra ($)</label><input type="number" id="m-precio" step="0.01" placeholder="150.00"></div>
        <div class="form-group"><label>Comisión ($)</label><input type="number" id="m-comision" step="0.01" value="0"></div>
        <div class="form-group"><label>Fecha apertura</label><input type="date" id="m-fecha" value="${ctx ? ctx.date : todayISO}"></div>
        <div class="form-group"><label>Cuenta/Subcuenta</label><select id="m-cuenta">${cuentaOptions()}</select></div>
        <div class="form-group"><label>¿Se contabiliza?</label><select id="m-contabiliza"><option value="si">Sí, contabilizar</option><option value="no">No, solo historial</option></select></div>
        <div class="form-group"><label>¿Incluir en el plan?</label><select id="m-incluir-plan"><option value="si">Sí, sumar al plan</option><option value="no">No, sacar del plan</option></select></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-green" onclick="doNuevaAccion()">Registrar</button>
        <button class="btn" onclick="closeModal()">Cancelar</button>
      </div>`;
    return;
  }

  if (type === 'nueva-pos-opcion') {
    const ctx = currentPlanContext && currentPlanContext.kind === 'opciones' ? currentPlanContext : null;
    const ctxInfo = ctx ? `<div class="alert-info">Trade del plan · ${ctx.kind === 'acciones' ? 'Día' : 'Operación'} ${ctx.day} · Fecha ${dateText(ctx.date)} · Capital operable disponible: <strong>${money(ctx.amount)}</strong> · Rango: ${(ctx.minPct*100).toFixed(1)}%-${(ctx.targetPct*100).toFixed(1)}%</div>` : '';
    box.innerHTML = `<div class="modal-title">+ Nueva posición — Opción</div>
      ${ctxInfo}
      <div class="form-grid">
        <div class="form-group"><label>Empresa / Ticker</label><input type="text" id="m-empresa" style="text-transform:uppercase" placeholder="SPY"></div>
        <div class="form-group"><label>Strike ($)</label><input type="number" id="m-strike" step="0.5" placeholder="450.00"></div>
        <div class="form-group"><label>Tipo</label><select id="m-tipo"><option>CALL</option><option>PUT</option></select></div>
        <div class="form-group"><label>Nº contratos</label><input type="number" id="m-contratos" placeholder="1" step="1"></div>
        <div class="form-group"><label>Prima compra ($)</label><input type="number" id="m-prima" step="0.01" placeholder="2.50"></div>
        <div class="form-group"><label>Comisión ($)</label><input type="number" id="m-comision" step="0.01" value="0"></div>
        <div class="form-group"><label>Fecha apertura</label><input type="date" id="m-fecha" value="${ctx ? ctx.date : todayISO}"></div>
        <div class="form-group"><label>Fecha vencimiento</label><input type="date" id="m-vencimiento"></div>
        <div class="form-group"><label>Cuenta/Subcuenta</label><select id="m-cuenta">${cuentaOptions()}</select></div>
        <div class="form-group"><label>¿Se contabiliza?</label><select id="m-contabiliza"><option value="si">Sí, contabilizar</option><option value="no">No, solo historial</option></select></div>
        <div class="form-group"><label>¿Incluir en el plan?</label><select id="m-incluir-plan"><option value="si">Sí, sumar al plan</option><option value="no">No, sacar del plan</option></select></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-blue" onclick="doNuevaOpcion()">Registrar</button>
        <button class="btn" onclick="closeModal()">Cancelar</button>
      </div>`;
    return;
  }

  if (type === 'cerrar-pos') {
    const openAcc = D.acciones.filter(a => a.estado === 'Abierta').map(a => ({ kind:'acc', label:`${a.ticker} — ${a.acciones} acciones @ ${money(a.precioCompra)}`, key: n(a.rowIndex) }));
    const openOpc = D.opciones.filter(o => o.estado === 'Abierta').map(o => ({ kind:'opc', label:`${o.empresa} ${o.tipo} $${o.strike} — ${o.contratos} ct`, key: n(o.rowIndex) }));
    const all = [...openAcc, ...openOpc];
    box.innerHTML = `<div class="modal-title">✕ Cerrar posición</div>
      ${all.length ? `<div class="form-grid">
        <div class="form-group" style="grid-column:1/-1"><label>Posición</label>
          <select id="m-close-idx">${all.map((p,i)=>`<option value="${i}">${esc(p.label)}</option>`).join('')}</select>
        </div>
        <div class="form-group"><label>Precio venta / prima salida ($)</label><input type="number" id="m-close-price" step="0.01"></div>
        <div class="form-group"><label>Comisión cierre ($)</label><input type="number" id="m-close-comm" step="0.01" value="0"></div>
        <div class="form-group"><label>Fecha cierre</label><input type="date" id="m-close-date" value="${todayISO}"></div>
        <div class="form-group" style="grid-column:1/-1"><label>¿Integrar capital liberado al plan?</label><select id="m-close-integrar-plan"><option value="no">No, cerrar pero dejar fuera del plan</option><option value="si">Sí, sumar capital recuperado al plan</option></select><small>Úsalo cuando una posición ocupada se libera y quieres que ese capital entre al compound.</small></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-red" onclick='doCerrarPos(${JSON.stringify(all)})'>Cerrar posición</button>
        <button class="btn" onclick="closeModal()">Cancelar</button>
      </div>` : `<p style="color:var(--muted)">No hay posiciones abiertas.</p><div class="modal-footer"><button class="btn" onclick="closeModal()">Cerrar</button></div>`}`;
    return;
  }

  if (type === 'nueva-cuenta') {
    box.innerHTML = `<div class="modal-title">+ Nueva cuenta/subcuenta</div>
      <div class="alert-info">Ejemplo: Charles Schwab como cuenta principal, y "Opciones Charles" como subcuenta interna. Si Charles te da otro número de cuenta, créala como cuenta separada.</div>
      <div class="form-grid">
        <div class="form-group"><label>Nombre</label><input type="text" id="m-cuenta-nombre" placeholder="Charles Schwab"></div>
        <div class="form-group"><label>Tipo</label><select id="m-cuenta-tipo"><option>Broker</option><option>Banco</option><option>Subcuenta</option><option>Efectivo</option><option>Otro</option></select></div>
        <div class="form-group"><label>Moneda</label><select id="m-cuenta-moneda"><option>USD</option><option>MXN</option></select></div>
        <div class="form-group"><label>Cuenta padre</label><select id="m-cuenta-padre"><option value="">Ninguna</option>${(D.cuentas||[]).map(c=>`<option value="${esc(c.nombre)}">${esc(c.nombre)}</option>`).join('')}</select></div>
        <div class="form-group"><label>Estrategia</label><select id="m-cuenta-estrategia"><option>Libre</option><option>Acciones</option><option>Opciones</option><option>Mixta</option></select></div>
        <div class="form-group"><label>Saldo conciliado inicial ($)</label><input type="number" id="m-cuenta-saldo" step="0.01" value="0"></div>
        <div class="form-group" style="grid-column:1/-1"><label>Notas</label><input type="text" id="m-cuenta-notas" placeholder="Ej: cuenta principal, subcuenta de opciones, broker 2..."></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-green" onclick="doAddCuenta()">Guardar cuenta</button>
        <button class="btn" onclick="closeModal()">Cancelar</button>
      </div>`;
    return;
  }

  if (type === 'nuevo-socio') {
    box.innerHTML = `<div class="modal-title">+ Agregar inversionista</div>
      <div class="form-grid">
        <div class="form-group"><label>Nombre</label><input type="text" id="m-socio-nombre"></div>
        <div class="form-group"><label>Capital aportado ($)</label><input type="number" id="m-socio-capital" step="0.01"></div>
        <div class="form-group"><label>Fecha ingreso</label><input type="date" id="m-socio-fecha" value="${todayISO}"></div>
        <div class="form-group"><label>Notas</label><input type="text" id="m-socio-notas" placeholder="Ej: Capital de mi hijo"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-green" onclick="doAddSocio()">Guardar</button>
        <button class="btn" onclick="closeModal()">Cancelar</button>
      </div>`;
    return;
  }

  if (type === 'estado-cuenta') {
    const c = cfg();
    box.innerHTML = `<div class="modal-title">📥 Actualizar estado de cuenta Charles</div>
      <div class="alert-info">Usa esto cuando tu saldo real en Charles ya cambió y necesitas ajustar EVA sin meter depósitos/retiros falsos. Para historial de trades usa la sección Importar CSV.</div>
      <div class="form-grid">
        <div class="form-group"><label>Capital actual acciones ($)</label><input type="number" id="m-state-acc" value="${c.capAcc}" step="0.01"></div>
        <div class="form-group"><label>Capital actual opciones ($)</label><input type="number" id="m-state-opc" value="${c.capOpc}" step="0.01"></div>
        <div class="form-group"><label>Capital inicial plan acciones ($)</label><input type="number" id="m-state-plan-acc" value="${c.planCapAcc}" step="0.01"></div>
        <div class="form-group"><label>Capital inicial plan opciones ($)</label><input type="number" id="m-state-plan-opc" value="${c.planCapOpc}" step="0.01"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-green" onclick="saveAccountState()">Guardar estado</button>
        <button class="btn" onclick="closeModal()">Cancelar</button>
      </div>`;
    return;
  }

  if (type === 'nueva-watch') {
    box.innerHTML = `<div class="modal-title">+ Agregar ticker a Watchlist</div>
      <div class="form-grid">
        <div class="form-group"><label>Ticker</label><input type="text" id="m-watch-ticker" style="text-transform:uppercase" placeholder="TSLA"></div>
        <div class="form-group"><label>Precio meta ($)</label><input type="number" id="m-watch-meta" step="0.01"></div>
        <div class="form-group"><label>Nota</label><input type="text" id="m-watch-nota" placeholder="Ej: Esperar ruptura"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-green" onclick="doAddWatch()">Guardar</button>
        <button class="btn" onclick="closeModal()">Cancelar</button>
      </div>`;
    return;
  }
}

function openPlanQuestion(kind) {
  const plan = planSettings(kind);
  const box = $('modal-box');
  box.innerHTML = `<div class="modal-title">Nuevo trade de ${plan.label}</div>
    <p style="color:var(--muted);margin-bottom:1rem;line-height:1.5">¿Vas a continuar tu plan de <strong>${(plan.minPct*100).toFixed(1)}% a ${(plan.targetPct*100).toFixed(1)}%</strong>?</p>
    <div class="modal-footer">
      <button class="btn ${plan.isAcc?'btn-green':'btn-blue'}" onclick="closeModal();showPage('${plan.isAcc?'plan-acciones':'plan-opciones'}');openPlanPosition('${kind}', selectedPlanDay['${kind}'] || 1)">Sí, continuar el plan</button>
      <button class="btn" onclick="currentPlanContext=null;closeModal();openModal('nueva-pos-${plan.isAcc?'accion':'opcion'}')">No, registrar sin plan</button>
    </div>`;
  $('modal-overlay').classList.remove('hidden');
}

function openPlanPosition(kind, day) {
  const plan = planSettings(kind);
  const d = Math.max(1, Math.min(n(day) || selectedPlanDay[kind] || 1, plan.diasMes));
  selectedPlanDay[kind] = d;
  const daily = buildDailyFromPlan(plan, selectedPlanMonth[kind] || 1);
  const row = daily[d - 1];
  const st = statusForDay(plan, row);
  currentPlanContext = {
    kind,
    month: selectedPlanMonth[kind] || 1,
    day: d,
    globalDay: row.globalDay,
    date: row.date,
    amount: st.actualOperable,
    free: st.remaining,
    minPct: plan.minPct,
    targetPct: plan.targetPct
  };
  openModal(kind === 'acciones' ? 'nueva-pos-accion' : 'nueva-pos-opcion');
}


function openEditTrade(kind, rowIndex) {
  const row = n(rowIndex);
  const item = kind === 'acc'
    ? D.acciones.find(a => n(a.rowIndex) === row)
    : D.opciones.find(o => n(o.rowIndex) === row);
  if (!item) { showToast('No se encontró la operación. Sin rowIndex no puedo editar duplicados con seguridad.', 'error'); return; }
  const box = $('modal-box');
  const countSelect = `<div class="form-group"><label>¿Se contabiliza en resultados?</label><select id="e-contabiliza"><option value="si" ${isCounted(item)?'selected':''}>Sí, contabilizar</option><option value="no" ${!isCounted(item)?'selected':''}>No, solo guardar historial</option></select></div>
    <div class="form-group"><label>¿Incluir en el plan compuesto?</label><select id="e-incluir-plan"><option value="si" ${isIncludedInPlan(item)?'selected':''}>Sí, sumar al plan</option><option value="no" ${!isIncludedInPlan(item)?'selected':''}>No, sacar del plan</option></select></div>`;
  if (kind === 'acc') {
    box.innerHTML = `<div class="modal-title">✏ Editar acción — ${esc(item.ticker)}</div>
      <div class="form-grid">
        <div class="form-group"><label>Ticker</label><input type="text" id="e-ticker" value="${esc(item.ticker)}" style="text-transform:uppercase"></div>
        <div class="form-group"><label>Nº acciones</label><input type="number" id="e-acciones" value="${item.acciones}"></div>
        <div class="form-group"><label>Precio compra ($)</label><input type="number" id="e-compra" value="${item.precioCompra}" step="0.01"></div>
        <div class="form-group"><label>Precio venta ($)</label><input type="number" id="e-venta" value="${item.precioVenta||''}" step="0.01" placeholder="Vacío si sigue abierta"></div>
        <div class="form-group"><label>Comisión total ($)</label><input type="number" id="e-comision" value="${item.comision}" step="0.01"></div>
        <div class="form-group"><label>Fecha compra</label><input type="date" id="e-fecha-compra" value="${item.fechaCompra||''}"></div>
        <div class="form-group"><label>Fecha cierre</label><input type="date" id="e-fecha-cierre" value="${item.fechaCierre||''}"></div>
        <div class="form-group"><label>Cuenta/Subcuenta</label><select id="e-cuenta">${cuentaOptions(item.accountName || item.cuenta || '')}</select></div>
        ${countSelect}
      </div>
      <div class="modal-footer">
        <button class="btn btn-green" onclick="doEditAccion(${row})">Guardar cambios</button>
        <button class="btn btn-red" onclick="deleteTrade('acc',${row})">Eliminar</button>
        <button class="btn" onclick="closeModal()">Cancelar</button>
      </div>`;
  } else {
    box.innerHTML = `<div class="modal-title">✏ Editar opción — ${esc(item.empresa)}</div>
      <div class="form-grid">
        <div class="form-group"><label>Empresa</label><input type="text" id="e-empresa" value="${esc(item.empresa)}" style="text-transform:uppercase"></div>
        <div class="form-group"><label>Strike ($)</label><input type="number" id="e-strike" value="${item.strike}" step="0.5"></div>
        <div class="form-group"><label>Tipo</label><select id="e-tipo"><option ${item.tipo==='CALL'?'selected':''}>CALL</option><option ${item.tipo==='PUT'?'selected':''}>PUT</option></select></div>
        <div class="form-group"><label>Contratos</label><input type="number" id="e-contratos" value="${item.contratos}"></div>
        <div class="form-group"><label>Prima compra ($)</label><input type="number" id="e-prima-compra" value="${item.primaCompra}" step="0.01"></div>
        <div class="form-group"><label>Prima venta ($)</label><input type="number" id="e-prima-venta" value="${item.primaVenta||''}" step="0.01" placeholder="Vacío si sigue abierta"></div>
        <div class="form-group"><label>Comisión total ($)</label><input type="number" id="e-comision" value="${item.comision}" step="0.01"></div>
        <div class="form-group"><label>Fecha apertura</label><input type="date" id="e-fecha-apertura" value="${item.fechaApertura||''}"></div>
        <div class="form-group"><label>Fecha cierre</label><input type="date" id="e-fecha-cierre" value="${item.fechaCierre||''}"></div>
        <div class="form-group"><label>Fecha vencimiento</label><input type="date" id="e-fecha-venc" value="${item.fechaVencim||''}"></div>
        <div class="form-group"><label>Cuenta/Subcuenta</label><select id="e-cuenta">${cuentaOptions(item.accountName || item.cuenta || '')}</select></div>
        ${countSelect}
      </div>
      <div class="modal-footer">
        <button class="btn btn-green" onclick="doEditOpcion(${row})">Guardar cambios</button>
        <button class="btn btn-red" onclick="deleteTrade('opc',${row})">Eliminar</button>
        <button class="btn" onclick="closeModal()">Cancelar</button>
      </div>`;
  }
  $('modal-overlay').classList.remove('hidden');
}



function openEditCuenta(rowIndex) {
  const c = (D.cuentas || []).find(x => n(x.rowIndex) === n(rowIndex));
  if (!c) { showToast('No encontré la cuenta.', 'error'); return; }
  const box = $('modal-box');
  box.innerHTML = `<div class="modal-title">✏ Editar cuenta/subcuenta</div>
    <div class="form-grid">
      <div class="form-group"><label>Nombre</label><input type="text" id="m-cuenta-nombre" value="${esc(c.nombre)}"></div>
      <div class="form-group"><label>Tipo</label><select id="m-cuenta-tipo"><option ${c.tipo==='Broker'?'selected':''}>Broker</option><option ${c.tipo==='Banco'?'selected':''}>Banco</option><option ${c.tipo==='Subcuenta'?'selected':''}>Subcuenta</option><option ${c.tipo==='Efectivo'?'selected':''}>Efectivo</option><option ${c.tipo==='Otro'?'selected':''}>Otro</option></select></div>
      <div class="form-group"><label>Moneda</label><select id="m-cuenta-moneda"><option ${c.moneda==='USD'?'selected':''}>USD</option><option ${c.moneda==='MXN'?'selected':''}>MXN</option></select></div>
      <div class="form-group"><label>Cuenta padre</label><select id="m-cuenta-padre"><option value="">Ninguna</option>${(D.cuentas||[]).filter(x=>n(x.rowIndex)!==n(rowIndex)).map(x=>`<option value="${esc(x.nombre)}" ${x.nombre===c.cuentaPadre?'selected':''}>${esc(x.nombre)}</option>`).join('')}</select></div>
      <div class="form-group"><label>Estrategia</label><select id="m-cuenta-estrategia"><option ${c.estrategia==='Libre'?'selected':''}>Libre</option><option ${c.estrategia==='Acciones'?'selected':''}>Acciones</option><option ${c.estrategia==='Opciones'?'selected':''}>Opciones</option><option ${c.estrategia==='Mixta'?'selected':''}>Mixta</option></select></div>
      <div class="form-group"><label>Saldo conciliado ($)</label><input type="number" id="m-cuenta-saldo" step="0.01" value="${n(c.saldoConciliado)}"></div>
      <div class="form-group" style="grid-column:1/-1"><label>Notas</label><input type="text" id="m-cuenta-notas" value="${esc(c.notas||'')}"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-green" onclick="doUpdateCuenta(${n(rowIndex)})">Guardar</button>
      <button class="btn btn-red" onclick="deleteCuenta(${n(rowIndex)})">Eliminar</button>
      <button class="btn" onclick="closeModal()">Cancelar</button>
    </div>`;
  $('modal-overlay').classList.remove('hidden');
}

async function doAddCuenta() {
  const nombre = ($('m-cuenta-nombre')?.value || '').trim();
  if (!nombre) { showToast('Escribe el nombre de la cuenta.', 'error'); return; }
  const payload = {
    nombre,
    tipo: $('m-cuenta-tipo')?.value || 'Broker',
    moneda: $('m-cuenta-moneda')?.value || 'USD',
    cuentaPadre: $('m-cuenta-padre')?.value || '',
    estrategia: $('m-cuenta-estrategia')?.value || 'Libre',
    saldoConciliado: n($('m-cuenta-saldo')?.value),
    notas: $('m-cuenta-notas')?.value || ''
  };
  try { await api('saveCuenta', payload); closeModal(); await syncAll(); showToast('Cuenta guardada.', 'success'); }
  catch(e) { showToast(e.message || 'No se pudo guardar la cuenta.', 'error'); }
}

async function doUpdateCuenta(rowIndex) {
  const nombre = ($('m-cuenta-nombre')?.value || '').trim();
  if (!nombre) { showToast('Escribe el nombre de la cuenta.', 'error'); return; }
  const payload = {
    rowIndex,
    nombre,
    tipo: $('m-cuenta-tipo')?.value || 'Broker',
    moneda: $('m-cuenta-moneda')?.value || 'USD',
    cuentaPadre: $('m-cuenta-padre')?.value || '',
    estrategia: $('m-cuenta-estrategia')?.value || 'Libre',
    saldoConciliado: n($('m-cuenta-saldo')?.value),
    notas: $('m-cuenta-notas')?.value || ''
  };
  try { await api('updateCuenta', payload); closeModal(); await syncAll(); showToast('Cuenta actualizada.', 'success'); }
  catch(e) { showToast(e.message || 'No se pudo actualizar la cuenta.', 'error'); }
}

async function deleteCuenta(rowIndex) {
  if (!confirm('¿Eliminar esta cuenta/subcuenta? No borra trades; solo elimina el registro de la cuenta.')) return;
  try { await api('deleteCuenta', { rowIndex }); closeModal(); await syncAll(); showToast('Cuenta eliminada.', 'success'); }
  catch(e) { showToast(e.message || 'No se pudo eliminar la cuenta.', 'error'); }
}

function openEditSocio(rowIndex, nombre, notas) {
  const box = $('modal-box');
  box.innerHTML = `<div class="modal-title">✏ Editar inversionista</div>
    <div class="form-grid">
      <div class="form-group"><label>Nombre</label><input type="text" id="m-edit-nombre" value="${nombre}"></div>
      <div class="form-group"><label>Notas</label><input type="text" id="m-edit-notas" value="${notas||''}"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-green" onclick="doUpdateSocio(${rowIndex})">Guardar</button>
      <button class="btn" onclick="closeModal()">Cancelar</button>
    </div>`;
  $('modal-overlay').classList.remove('hidden');
}


function openPlanConfig(kind) {
  const plan = planSettings(kind);
  const box = $('modal-box');
  box.innerHTML = `<div class="modal-title">⚙ Configurar plan de ${plan.label}</div>
    <div class="alert-info" style="margin-bottom:12px">Configura este plan por separado. La meta se escribe como porcentaje humano: 1 = 1%, 3 = 3%, 20 = 20%.</div>
    <div class="form-grid">
      <div class="form-group"><label>Capital actual de cuenta ${plan.label} ($)</label><input type="number" id="pc-cap-cuenta" value="${plan.capCuenta}" step="0.01"></div>
      <div class="form-group"><label>Capital inicial de este plan ($)</label><input type="number" id="pc-plan-cap" value="${plan.planCapital}" step="0.01"></div>
      <div class="form-group"><label>Fecha de inicio</label><input type="date" id="pc-inicio" value="${plan.startDate}"></div>
      <div class="form-group"><label>Mínimo esperado por trade/día (%)</label><input type="number" id="pc-min" value="${(plan.minPct*100).toFixed(2)}" step="0.1"></div>
      <div class="form-group"><label>Meta ideal por trade/día (%)</label><input type="number" id="pc-max" value="${(plan.targetPct*100).toFixed(2)}" step="0.1"></div>
      <div class="form-group"><label>Días operables por mes</label><input type="number" id="pc-dias" value="${plan.diasMes}" min="1" max="31"></div>
      <div class="form-group"><label>Meses del plan</label><input type="number" id="pc-meses" value="${plan.meses}" min="1" max="60"></div>
      <div class="form-group"><label>% de capital de cuenta que puedes usar</label><input type="number" id="pc-uso" value="${(plan.uso*100).toFixed(0)}" step="1"></div>
      ${!plan.isAcc ? `<div class="form-group"><label>Operaciones por semana</label><input type="number" id="pc-ops-semana" value="${plan.operacionesSemana}" min="1" max="10"></div>` : ''}
    </div>
    <div class="modal-footer">
      <button class="btn ${plan.isAcc?'btn-green':'btn-blue'}" onclick="savePlanConfig('${kind}')">Guardar plan</button>
      <button class="btn" onclick="closeModal()">Cancelar</button>
    </div>`;
  $('modal-overlay').classList.remove('hidden');
}

async function savePlanConfig(kind) {
  const isAcc = kind === 'acciones';
  const min = n($('pc-min')?.value) / 100;
  const max = n($('pc-max')?.value) / 100;
  if (min < 0 || max <= 0 || min > max) { showToast('Revisa el rango: el mínimo no puede ser mayor que la meta.', 'error'); return; }
  const payload = {
    diasMes: Math.max(1, Math.min(31, Math.round(n($('pc-dias')?.value) || 20))),
    meses: Math.max(1, Math.min(60, Math.round(n($('pc-meses')?.value) || 12))),
    tipoCambio: FX
  };
  if (isAcc) {
    payload.capitalAcciones = n($('pc-cap-cuenta')?.value);
    payload.planCapitalAcciones = n($('pc-plan-cap')?.value);
    payload.planFechaInicioAcciones = $('pc-inicio')?.value || todayISO;
    payload.planMetaMinAcciones = min;
    payload.planMetaMaxAcciones = max;
    payload.metaAcciones = max;
    payload.usoCapitalAcciones = n($('pc-uso')?.value) / 100;
  } else {
    payload.capitalOpciones = n($('pc-cap-cuenta')?.value);
    payload.planCapitalOpciones = n($('pc-plan-cap')?.value);
    payload.planFechaInicioOpciones = $('pc-inicio')?.value || todayISO;
    payload.planMetaMinOpciones = min;
    payload.planMetaMaxOpciones = max;
    payload.metaOpciones = max;
    payload.usoCapitalOpciones = n($('pc-uso')?.value) / 100;
    payload.operacionesSemanaOpciones = Math.max(1, Math.min(10, Math.round(n($('pc-ops-semana')?.value) || 3)));
  }
  try {
    await api('saveConfig', payload);
    closeModal(); await syncAll();
    showToast('Plan actualizado.', 'success');
  } catch(e) { showToast(e.message, 'error'); }
}

function closeModal() { $('modal-overlay').classList.add('hidden'); }

// ── Actions ───────────────────────────────────────────────────
async function saveConfig() {
  const payload = {
    nombre: $('m-cfg-nombre')?.value || '',
    capitalAcciones: n($('m-cfg-cap-acc')?.value),
    capitalOpciones: n($('m-cfg-cap-opc')?.value),
    planCapitalAcciones: n($('m-cfg-plan-cap-acc')?.value),
    planCapitalOpciones: n($('m-cfg-plan-cap-opc')?.value),
    planFechaInicioAcciones: $('m-cfg-plan-inicio-acc')?.value || todayISO,
    planFechaInicioOpciones: $('m-cfg-plan-inicio-opc')?.value || todayISO,
    planMetaMinAcciones: n($('m-cfg-min-acc')?.value) / 100,
    planMetaMaxAcciones: n($('m-cfg-meta-acc')?.value) / 100,
    planMetaMinOpciones: n($('m-cfg-min-opc')?.value) / 100,
    planMetaMaxOpciones: n($('m-cfg-meta-opc')?.value) / 100,
    metaAcciones: n($('m-cfg-meta-acc')?.value) / 100,
    metaOpciones: n($('m-cfg-meta-opc')?.value) / 100,
    diasMes: Math.max(1, Math.round(n($('m-cfg-dias')?.value) || 20)),
    usoCapitalAcciones: n($('m-cfg-uso-acc')?.value) / 100,
    usoCapitalOpciones: n($('m-cfg-uso-opc')?.value) / 100,
    meses: Math.max(1, Math.round(n($('m-cfg-meses')?.value) || 12)),
    tipoCambio: n($('m-cfg-fx')?.value) || FX,
    operacionesSemanaOpciones: Math.max(1, Math.min(10, Math.round(n($('m-cfg-ops-opc')?.value) || 3)))
  };
  if (payload.planMetaMinAcciones > payload.planMetaMaxAcciones) { showToast('En acciones, el mínimo no puede ser mayor que la meta ideal.', 'error'); return; }
  if (payload.planMetaMinOpciones > payload.planMetaMaxOpciones) { showToast('En opciones, el mínimo no puede ser mayor que la meta ideal.', 'error'); return; }
  try {
    await api('saveConfig', payload);
    D.config = { ...D.config, ...payload, capAcciones: payload.capitalAcciones, capOpciones: payload.capitalOpciones };
    localStorage.setItem('eva_nombre', payload.nombre);
    closeModal();
    await syncAll();
    showToast('Configuración guardada.', 'success');
  } catch(e) { showToast(e.message, 'error'); }
}


async function saveAccountState() {
  const payload = {
    capitalAcciones: n($('m-state-acc')?.value),
    capitalOpciones: n($('m-state-opc')?.value),
    planCapitalAcciones: n($('m-state-plan-acc')?.value),
    planCapitalOpciones: n($('m-state-plan-opc')?.value)
  };
  try {
    await api('saveConfig', payload);
    closeModal(); await syncAll();
    showToast('Estado de cuenta actualizado.', 'success');
  } catch(e) { showToast(e.message, 'error'); }
}

async function doNuevaAccion() {
  const ticker = ($('m-ticker')?.value||'').toUpperCase().trim();
  const acciones = n($('m-acciones')?.value);
  const precio = n($('m-precio')?.value);
  const comision = n($('m-comision')?.value);
  const fecha = $('m-fecha')?.value || todayISO;
  if (!ticker || !acciones || !precio) { showToast('Completa ticker, acciones y precio.', 'error'); return; }
  try {
    const ctx = currentPlanContext && currentPlanContext.kind === 'acciones' ? currentPlanContext : null;
    await api('saveAccion', { ticker, acciones, precioCompra: precio, comision, fechaCompra: fecha, contabiliza: ($('m-contabiliza')?.value || 'si') === 'si', planTipo: (($('m-incluir-plan')?.value || 'si') === 'si') ? 'acciones' : 'fuera_plan', planMes: ctx ? ctx.month : '', planUnidad: ctx ? ctx.day : '', planGlobalUnit: ctx ? ctx.globalDay : '', planFecha: ctx ? ctx.date : '', accountName: $('m-cuenta')?.value || accountNameDefault() });
    currentPlanContext = null;
    closeModal(); await syncAll();
    showToast('Acción registrada y ligada por fecha al plan.', 'success');
  } catch(e) { showToast(e.message, 'error'); }
}

async function doNuevaOpcion() {
  const empresa = ($('m-empresa')?.value||'').toUpperCase().trim();
  const strike = n($('m-strike')?.value);
  const tipo = $('m-tipo')?.value || 'CALL';
  const contratos = n($('m-contratos')?.value);
  const prima = n($('m-prima')?.value);
  const comision = n($('m-comision')?.value);
  const fecha = $('m-fecha')?.value || todayISO;
  const venc = $('m-vencimiento')?.value || '';
  if (!empresa || !strike || !contratos || !prima) { showToast('Completa todos los campos.', 'error'); return; }
  try {
    const ctx = currentPlanContext && currentPlanContext.kind === 'opciones' ? currentPlanContext : null;
    await api('saveOpcion', { empresa, strike, tipo, contratos, primaCompra: prima, comision, fechaApertura: fecha, fechaVencim: venc, contabiliza: ($('m-contabiliza')?.value || 'si') === 'si', planTipo: (($('m-incluir-plan')?.value || 'si') === 'si') ? 'opciones' : 'fuera_plan', planMes: ctx ? ctx.month : '', planUnidad: ctx ? ctx.day : '', planGlobalUnit: ctx ? ctx.globalDay : '', planFecha: ctx ? ctx.date : '', accountName: $('m-cuenta')?.value || accountNameDefault() });
    currentPlanContext = null;
    closeModal(); await syncAll();
    showToast('Opción registrada y ligada por fecha al plan.', 'success');
  } catch(e) { showToast(e.message, 'error'); }
}

async function doCerrarPos(all) {
  const idx = n($('m-close-idx')?.value);
  const pos = all[idx];
  const price = n($('m-close-price')?.value);
  const comm = n($('m-close-comm')?.value);
  const date = $('m-close-date')?.value || todayISO;
  if (!pos || !price) { showToast('Ingresa precio de salida.', 'error'); return; }
  try {
    let result;
    const integrar = ($('m-close-integrar-plan')?.value || 'no') === 'si';
    const planTipoLiberado = integrar ? (pos.kind === 'acc' ? 'acciones_liberado' : 'opciones_liberado') : undefined;
    if (pos.kind === 'acc') result = await api('closeAccion', { rowIndex: pos.key, precioVenta: price, comisionCierre: comm, fechaCierre: date, planTipo: planTipoLiberado });
    else result = await api('closeOpcion', { rowIndex: pos.key, primaVenta: price, comisionCierre: comm, fechaCierre: date, planTipo: planTipoLiberado });
    const pnl = n(result?.pnl);
    const invested = n(result?.subtotal || 0);
    const recovered = Math.max(0, invested + pnl);
    const p = planSettings(pos.kind === 'acc' ? 'acciones' : 'opciones');
    const expected = invested * p.targetPct;
    const missed = expected - pnl;
    if (integrar) {
      lastCloseMsg = pnl >= 0
        ? { kind: 'success', text: `Capital integrado al plan. Recuperaste ${money(recovered)}: inversión ${money(invested)} + ganancia ${money(pnl)}. Contra tu meta ideal, ${missed>0 ? 'dejaste de ganar ' + money(missed) : 'superaste por ' + money(Math.abs(missed))}.` }
        : { kind: 'warning', text: `Capital integrado al plan. Recuperaste ${money(recovered)} de ${money(invested)}. Pérdida: ${money(pnl)}. Dejaste de ganar ${money(Math.max(0, missed))} contra tu meta ideal.` };
    } else {
      lastCloseMsg = pnl >= 0
        ? { kind: 'success', text: `¡Eres increíble por seguir tu plan! 🎉 Cerraste con ${money(pnl)}. Capital recuperado: ${money(recovered)}.` }
        : { kind: 'warning', text: `Ánimo, vamos por más. Sigue tu plan. 💪 Cerraste con ${money(pnl)}. Capital recuperado: ${money(recovered)}.` };
    }
    closeModal(); await syncAll();
    showToast('Posición cerrada.', pnl >= 0 ? 'success' : 'error');
  } catch(e) { showToast(e.message, 'error'); }
}

async function doEditAccion(rowIndex) {
  const payload = {
    rowIndex,
    ticker: ($('e-ticker')?.value||'').toUpperCase().trim(),
    acciones: n($('e-acciones')?.value),
    precioCompra: n($('e-compra')?.value),
    precioVenta: $('e-venta')?.value || '',
    comision: n($('e-comision')?.value),
    fechaCompra: $('e-fecha-compra')?.value || '',
    fechaCierre: $('e-fecha-cierre')?.value || '',
    contabiliza: ($('e-contabiliza')?.value || 'si') === 'si',
    planTipo: (($('e-incluir-plan')?.value || 'si') === 'si') ? 'acciones' : 'fuera_plan',
    accountName: $('e-cuenta')?.value || ''
  };
  try {
    await api('updateAccion', payload);
    closeModal(); await syncAll();
    showToast('Acción actualizada.', 'success');
  } catch(e) { showToast(e.message, 'error'); }
}

async function doEditOpcion(rowIndex) {
  const payload = {
    rowIndex,
    empresa: ($('e-empresa')?.value||'').toUpperCase().trim(),
    strike: n($('e-strike')?.value),
    tipo: $('e-tipo')?.value || 'CALL',
    contratos: n($('e-contratos')?.value),
    primaCompra: n($('e-prima-compra')?.value),
    primaVenta: $('e-prima-venta')?.value || '',
    comision: n($('e-comision')?.value),
    fechaApertura: $('e-fecha-apertura')?.value || '',
    fechaCierre: $('e-fecha-cierre')?.value || '',
    fechaVencim: $('e-fecha-venc')?.value || '',
    contabiliza: ($('e-contabiliza')?.value || 'si') === 'si',
    planTipo: (($('e-incluir-plan')?.value || 'si') === 'si') ? 'opciones' : 'fuera_plan',
    accountName: $('e-cuenta')?.value || ''
  };
  try {
    await api('updateOpcion', payload);
    closeModal(); await syncAll();
    showToast('Opción actualizada.', 'success');
  } catch(e) { showToast(e.message, 'error'); }
}

async function deleteTrade(kind, rowIndex) {
  if (!confirm('¿Eliminar este trade? Esta acción borra la fila del registro.')) return;
  try {
    await api(kind === 'acc' ? 'deleteAccion' : 'deleteOpcion', { rowIndex });
    closeModal(); await syncAll();
    showToast('Trade eliminado.', 'success');
  } catch(e) { showToast(e.message, 'error'); }
}


async function doAddSocio() {
  const nombre = $('m-socio-nombre')?.value.trim();
  const capital = n($('m-socio-capital')?.value);
  if (!nombre || !capital) { showToast('Nombre y capital son requeridos.', 'error'); return; }
  try {
    await api('saveSocio', { nombre, capital, fechaIngreso: $('m-socio-fecha')?.value || todayISO, notas: $('m-socio-notas')?.value || '' });
    closeModal(); await syncAll();
    showToast('Socio agregado.', 'success');
  } catch(e) { showToast(e.message, 'error'); }
}

async function doUpdateSocio(rowIndex) {
  const nombre = $('m-edit-nombre')?.value.trim();
  if (!nombre) { showToast('El nombre es requerido.', 'error'); return; }
  try {
    await api('updateSocio', { rowIndex, nombre, notas: $('m-edit-notas')?.value || '' });
    closeModal(); await syncAll();
    showToast('Socio actualizado.', 'success');
  } catch(e) { showToast(e.message, 'error'); }
}

async function doAddWatch() {
  const ticker = $('m-watch-ticker')?.value.trim().toUpperCase();
  if (!ticker) { showToast('Ingresa un ticker.', 'error'); return; }
  try {
    await api('saveWatch', { ticker, precioMeta: n($('m-watch-meta')?.value), nota: $('m-watch-nota')?.value || '' });
    closeModal(); await syncAll();
    showToast('Ticker agregado.', 'success');
  } catch(e) { showToast(e.message, 'error'); }
}

async function deleteWatch(rowIndex) {
  if (!rowIndex || !confirm('¿Eliminar ticker?')) return;
  try {
    await api('deleteWatch', { rowIndex });
    await syncAll();
    showToast('Ticker eliminado.', 'success');
  } catch(e) { showToast(e.message, 'error'); }
}

// ── Toast ─────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.add('hidden'), 3500);
}

// ── Demo ──────────────────────────────────────────────────────
function loadDemoData() {
  D.config = { nombre:'Luis', capAcciones:1500, capitalAcciones:1500, capOpciones:500, capitalOpciones:500, metaAcciones:0.03, metaOpciones:0.20, planMetaMinAcciones:0.01, planMetaMaxAcciones:0.03, planMetaMinOpciones:0.10, planMetaMaxOpciones:0.20, planCapitalAcciones:1000, planCapitalOpciones:500, planFechaInicioAcciones:todayISO, planFechaInicioOpciones:todayISO, meses:12, tipoCambio:17.5, diasMes:20, usoCapitalAcciones:1, usoCapitalOpciones:0.33 };
  FX = 17.5;
  D.acciones = [
    calcA({ fechaCompra:'2026-05-01', ticker:'AAPL', acciones:10, precioCompra:170, precioVenta:181, comision:1.30, estado:'Cerrada', fechaCierre:'2026-05-10' }),
    calcA({ fechaCompra:'2026-05-12', ticker:'NVDA', acciones:5, precioCompra:880, comision:0.65, estado:'Abierta' })
  ];
  D.opciones = [
    calcO({ empresa:'SPY', strike:520, tipo:'CALL', contratos:2, primaCompra:3.5, primaVenta:5.8, comision:1.30, estado:'Cerrada', fechaApertura:'2026-05-05', fechaCierre:'2026-05-09', fechaVencim:'2026-05-30' }),
    calcO({ empresa:'AAPL', strike:185, tipo:'CALL', contratos:1, primaCompra:2.2, comision:0.65, estado:'Abierta', fechaApertura:'2026-05-13', fechaVencim:'2026-05-19' })
  ];
  D.cuentas = [
    { rowIndex:4, nombre:'Charles Schwab', tipo:'Broker', moneda:'USD', cuentaPadre:'', estrategia:'Mixta', saldoConciliado:3500, capitalOcupado:1250, disponible:2250, notas:'Cuenta principal demo', activa:'SI' },
    { rowIndex:5, nombre:'Opciones Charles', tipo:'Subcuenta', moneda:'USD', cuentaPadre:'Charles Schwab', estrategia:'Opciones', saldoConciliado:500, capitalOcupado:165, disponible:335, notas:'Presupuesto interno demo', activa:'SI' }
  ];
  D.socios = [
    { nombre:'Luis', capital:1500, pct:0.75, ganancia:97.5, retiros:0, saldo:1597.5, notas:'Principal', rowIndex:4 },
    { nombre:'Hijo', capital:500, pct:0.25, ganancia:32.5, retiros:0, saldo:532.5, notas:'Capital familiar', rowIndex:5 }
  ];
  D.watchlist = [{ rowIndex:4, ticker:'TSLA', nota:'Esperar ruptura', precioActual:175, cambioHoy:0.02, precioMeta:200, faltaMeta:0.14, alerta:'Esperando' }];
}
function demoResp(action) {
  const map = { getConfig: D.config, getAcciones: { acciones: D.acciones }, getOpciones: { opciones: D.opciones }, getSocios: { socios: D.socios }, getCuentas: { cuentas: D.cuentas }, getWatchlist: { watchlist: D.watchlist } };
  return map[action] || { ok: true };
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  $('modal-overlay').addEventListener('click', e => { if (e.target.id === 'modal-overlay') closeModal(); });
  const savedUrl = DEFAULT_API_URL || localStorage.getItem('eva_api_url');
  API_TOKEN = DEFAULT_ACCESS_TOKEN || localStorage.getItem('eva_api_token') || '';
  const savedNombre = localStorage.getItem('eva_nombre') || DEFAULT_USER_NAME;
  if (savedNombre) { $('setup-nombre').value = savedNombre; D.config.nombre = savedNombre; }
  if (savedUrl && savedUrl.includes('script.google.com')) { $('script-url').value = savedUrl; if ($('script-token')) $('script-token').value = API_TOKEN; API_URL = savedUrl; startApp(true); }
  $('header-date').textContent = new Date().toLocaleDateString('es-MX', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  updateLiveFX(false);
});

function updateLiveFX(saveToSheet = false) {
  fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json')
    .then(r => r.json())
    .then(d => {
      if (d.usd?.mxn) {
        FX = n(d.usd.mxn) || FX;
        D.config.tipoCambio = FX;
        renderAll();
        if (saveToSheet && API_URL && API_URL !== 'DEMO') {
          api('saveConfig', { tipoCambio: FX }).catch(() => {});
        }
      }
    })
    .catch(() => {});
}

