// ── EVA.js — Lógica principal ──────────────────────────────────
let API_URL = '';
let FX = 17.5;
let D = { config:{}, socios:[], acciones:[], opciones:[], watchlist:[], dashboard:{} };
let planType = 'stocks';
let planTrades = [];
let charts = {};
let currentPeriod = 'hoy';
let currentPosTab = 'abiertas';

const today = new Date();
const todayISO = today.toISOString().slice(0,10);
const todayStr = today.toLocaleDateString('es-MX',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

const f$ = n => {
  if(n===null||n===undefined||n==='') return '—';
  const abs = Math.abs(Number(n));
  const str = '$' + abs.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  return Number(n) < 0 ? '-' + str : str;
};
const fM = n => {
  if(n===null||n===undefined||n==='') return '—';
  return f$(Number(n)*FX);
};
const fp = n => {
  if(n===null||n===undefined||n==='') return '—';
  return (Number(n)>=0?'+':'') + (Number(n)*100).toFixed(2) + '%';
};
const fpR = n => (n>=0?'+':'') + n.toFixed(2) + '%';
const uid = () => Math.random().toString(36).slice(2,8);

// ── SETUP ──────────────────────────────────────────────────────
function saveSetup() {
  const url = document.getElementById('setup-url').value.trim();
  if(!url || !url.includes('script.google.com')) {
    showToast('Pega la URL correcta de Apps Script'); return;
  }
  localStorage.setItem('eva_api_url', url);
  API_URL = url;
  startApp();
}

function demoMode() {
  API_URL = 'DEMO';
  loadDemoData();
  startApp();
}

function startApp() {
  document.getElementById('setup-screen').style.display = 'none';
  document.getElementById('main-app').style.display = 'block';
  document.getElementById('corte-fecha').textContent = todayStr;
  fetchFX();
  syncAll();
}

// ── API ────────────────────────────────────────────────────────
async function api(action, data={}) {
  if(API_URL === 'DEMO') return getDemoResponse(action);
  try {
    const url = API_URL + '?action=' + action;
    const res = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ action, ...data }),
    });
    const json = await res.json();
    if(!json.ok) throw new Error(json.error);
    return json.data;
  } catch(e) {
    console.error('API error:', e);
    showToast('Error de conexión. Verifica tu URL de Apps Script.');
    return null;
  }
}

async function syncAll() {
  const btn = document.getElementById('sync-btn');
  btn.textContent = '↻ Cargando...';
  btn.classList.add('loading');
  try {
    const [cfg, dash, acc, opc, socios, watch] = await Promise.all([
      api('getConfig'), api('getDashboard'), api('getAcciones'),
      api('getOpciones'), api('getSocios'), api('getWatchlist')
    ]);
    if(cfg) D.config = cfg;
    if(dash) D.dashboard = dash;
    if(acc) D.acciones = acc.acciones || [];
    if(opc) D.opciones = opc.opciones || [];
    if(socios) D.socios = socios.socios || [];
    if(watch) D.watchlist = watch.watchlist || [];
    if(D.config.tipoCambio) FX = D.config.tipoCambio;
    renderAll();
    const t = new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'});
    document.getElementById('sync-time').textContent = 'Actualizado ' + t;
  } finally {
    btn.textContent = '↻ Sincronizar';
    btn.classList.remove('loading');
  }
}

// ── FX ─────────────────────────────────────────────────────────
async function fetchFX() {
  try {
    const r = await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json');
    const d = await r.json();
    if(d.usd?.mxn) { FX = d.usd.mxn; D.config.tipoCambio = FX; }
  } catch(e) {}
  document.getElementById('fx-rate').textContent = '$' + FX.toFixed(2);
  document.getElementById('plan-fx').textContent = '$' + FX.toFixed(2);
}

// ── RENDER ALL ─────────────────────────────────────────────────
function renderAll() {
  renderDashboard();
  renderAlertas();
  renderPosTbl(currentPosTab);
  renderSocios();
  renderWatchlist();
  renderCorte();
}

// ── NAV ────────────────────────────────────────────────────────
function goTab(tab) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('nav-' + tab).classList.add('active');
}

// ── DASHBOARD ──────────────────────────────────────────────────
function renderDashboard() {
  const d = D.dashboard;
  const noData = !d || !d.capTotal;
  document.getElementById('dash-capital').innerHTML = noData ? `
    <div style="grid-column:1/-1" class="empty">Sin datos. Agrega capital para comenzar.</div>` : `
    <div class="mc teal"><div class="ml">Capital acciones</div><div class="mv">${f$(d.capAcciones)}</div><div class="msub">${fM(d.capAcciones)} MXN</div></div>
    <div class="mc blue"><div class="ml">Capital opciones</div><div class="mv">${f$(d.capOpciones)}</div><div class="msub">${fM(d.capOpciones)} MXN</div></div>
    <div class="mc teal"><div class="ml">Capital total</div><div class="mv">${f$(d.capTotal)}</div><div class="msub">${fM(d.capTotal)} MXN</div></div>
    <div class="mc"><div class="ml">Comisiones pagadas</div><div class="mv" style="color:var(--red)">-${f$(d.comisiones)}</div></div>
    <div class="mc ${Number(d.pnlTotal)>=0?'teal':'red'}"><div class="ml">P&L total</div><div class="mv">${f$(d.pnlTotal)}</div><div class="msub">${fM(d.pnlTotal)} MXN</div></div>
    <div class="mc amber"><div class="ml">Rendimiento</div><div class="mv">${fp(d.rendimiento)}</div></div>`;
  setPeriod(currentPeriod);
  renderLastTrades();
}

function setPeriod(p) {
  currentPeriod = p;
  document.querySelectorAll('.ptab').forEach((b,i) => b.classList.toggle('active', ['hoy','semana','mes','anio','total'][i]===p));
  const d = D.dashboard;
  const pd = d && d[p] ? d[p] : {pnlAcc:0,pnlOpc:0,total:0,mxn:0};
  document.getElementById('dash-periodo').innerHTML = `
    <div class="mc teal"><div class="ml">P&L acciones</div><div class="mv">${f$(pd.pnlAcc)}</div></div>
    <div class="mc blue"><div class="ml">P&L opciones</div><div class="mv">${f$(pd.pnlOpc)}</div></div>
    <div class="mc ${Number(pd.total)>=0?'teal':'red'}"><div class="ml">Total USD</div><div class="mv">${f$(pd.total)}</div></div>
    <div class="mc ${Number(pd.mxn)>=0?'teal':'red'}"><div class="ml">Total MXN</div><div class="mv">${fM(pd.total)}</div></div>`;
}

function renderLastTrades() {
  const acc = D.acciones.filter(a=>a.estado==='Cerrada').slice(-5).reverse();
  const opc = D.opciones.filter(o=>o.estado==='Cerrada').slice(-3).reverse();
  const all = [...acc.map(a=>({...a,_tipo:'Acción'})), ...opc.map(o=>({...o,_tipo:'Opción'}))];
  if(!all.length) { document.getElementById('dash-trades').innerHTML='<div class="empty">Sin operaciones cerradas aún.</div>'; return; }
  document.getElementById('dash-trades').innerHTML = `<div class="tbl-wrap"><table>
    <thead><tr><th>Ticker</th><th>Tipo</th><th>Cierre</th><th>P&L $</th><th>P&L %</th></tr></thead>
    <tbody>${all.map(t=>`<tr>
      <td style="font-weight:600">${t.ticker||t.empresa}</td>
      <td><span class="bdg ${t._tipo==='Acción'?'green':'blue'}">${t._tipo}</span></td>
      <td>${t.fechaCierre||'—'}</td>
      <td class="${Number(t.pnl)>=0?'g':'r'}">${f$(t.pnl)}</td>
      <td class="${Number(t.pnlPct)>=0?'g':'r'}">${fp(t.pnlPct)}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

// ── ALERTAS ────────────────────────────────────────────────────
function renderAlertas() {
  const por = D.opciones.filter(o => {
    if(o.estado !== 'Abierta' || !o.fechaVencim) return false;
    const dias = Math.ceil((new Date(o.fechaVencim.split('/').reverse().join('-')) - new Date()) / 86400000);
    return dias <= 3 && dias >= 0;
  });
  const html = por.map(o=>{
    const dias = Math.ceil((new Date(o.fechaVencim.split('/').reverse().join('-')) - new Date()) / 86400000);
    return `<div class="alert-box">⚠️ <strong>${o.empresa}</strong> ${o.tipo} $${o.strike} — vence en <strong>${dias} día(s)</strong> (${o.fechaVencim})</div>`;
  }).join('');
  ['alertas-container','pos-alertas'].forEach(id => {
    const el = document.getElementById(id); if(el) el.innerHTML = html;
  });
}

// ── POSICIONES ─────────────────────────────────────────────────
function setPosTab(t) {
  currentPosTab = t;
  document.querySelectorAll('#tab-posiciones .tab').forEach((b,i) => b.classList.toggle('active',['abiertas','acciones','opciones','cerradas'][i]===t));
  renderPosTbl(t);
}

function renderPosTbl(tab) {
  let accRows = D.acciones;
  let opcRows = D.opciones;
  if(tab==='abiertas'||tab==='acciones') accRows = accRows.filter(a=>a.estado==='Abierta');
  if(tab==='abiertas'||tab==='opciones') opcRows = opcRows.filter(o=>o.estado==='Abierta');
  if(tab==='cerradas') { accRows=D.acciones.filter(a=>a.estado==='Cerrada'); opcRows=D.opciones.filter(o=>o.estado==='Cerrada'); }
  if(tab==='acciones'&&tab!=='abiertas') accRows=D.acciones.filter(a=>a.estado==='Abierta');
  if(tab==='opciones'&&tab!=='abiertas') opcRows=D.opciones.filter(o=>o.estado==='Abierta');
  if(tab==='acciones') opcRows=[];
  if(tab==='opciones') accRows=[];

  let html = '';
  if(accRows.length) html += `
    <div class="card-title" style="margin-bottom:6px;margin-top:${html?'14px':'0'}">Acciones</div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Ticker</th><th>Acciones</th><th>Compra</th><th>Venta</th><th>Precio actual</th><th>Comisión</th><th>P&L $</th><th>P&L %</th><th>Estado</th><th>Cierre</th></tr></thead>
      <tbody>${accRows.map(a=>`<tr>
        <td style="font-weight:600">${a.ticker}</td><td>${a.acciones}</td>
        <td>${f$(a.precioCompra)}</td><td>${f$(a.precioVenta)||'—'}</td>
        <td style="color:var(--teal-dk);font-weight:600">${a.precioActual&&a.precioActual!=='—'?f$(a.precioActual):'—'}</td>
        <td style="color:var(--red)">-${f$(a.comision)}</td>
        <td class="${Number(a.pnl)>=0?'g':'r'}">${f$(a.pnl)||'—'}</td>
        <td class="${Number(a.pnlPct)>=0?'g':'r'}">${fp(a.pnlPct)||'—'}</td>
        <td><span class="bdg ${a.estado==='Abierta'?'green':'gray'}">${a.estado}</span></td>
        <td>${a.fechaCierre||'—'}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;

  if(opcRows.length) html += `
    <div class="card-title" style="margin-bottom:6px;margin-top:${accRows.length?'14px':'0'}">Opciones</div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Empresa</th><th>Strike</th><th>Tipo</th><th>Contratos</th><th>Prima C.</th><th>Prima V.</th><th>Comisión</th><th>P&L $</th><th>P&L %</th><th>Estado</th><th>Vencim.</th></tr></thead>
      <tbody>${opcRows.map(o=>`<tr>
        <td style="font-weight:600">${o.empresa}</td><td>$${o.strike}</td>
        <td><span class="bdg ${o.tipo==='CALL'?'green':'red'}">${o.tipo}</span></td>
        <td>${o.contratos}</td><td>${f$(o.primaCompra)}</td><td>${f$(o.primaVenta)||'—'}</td>
        <td style="color:var(--red)">-${f$(o.comision)}</td>
        <td class="${Number(o.pnl)>=0?'g':'r'}">${f$(o.pnl)||'—'}</td>
        <td class="${Number(o.pnlPct)>=0?'g':'r'}">${fp(o.pnlPct)||'—'}</td>
        <td><span class="bdg ${o.estado==='Abierta'?'blue':'gray'}">${o.estado}</span></td>
        <td class="${o.alerta&&o.alerta.includes('VENCE')?'r':''}">${o.fechaVencim||'—'}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;

  if(!accRows.length && !opcRows.length) html = '<div class="empty">Sin posiciones en esta categoría.</div>';
  document.getElementById('pos-table').innerHTML = html;
}

// ── SOCIOS ─────────────────────────────────────────────────────
function renderSocios() {
  if(!D.socios.length) { document.getElementById('socios-table').innerHTML='<div class="empty">Sin socios registrados. Agrega el primero.</div>'; return; }
  const totalCap = D.socios.reduce((a,s)=>a+(Number(s.capital)||0),0);
  document.getElementById('socios-table').innerHTML = `<div class="tbl-wrap"><table>
    <thead><tr><th>Socio</th><th>Capital ($)</th><th>Participación</th><th>Ganancia ($)</th><th>Ganancia (MXN)</th><th>Retiros ($)</th><th>Saldo ($)</th></tr></thead>
    <tbody>${D.socios.map((s,i)=>`<tr>
      <td style="font-weight:600">${s.nombre}</td>
      <td>${f$(s.capital)}</td>
      <td><span class="bdg green">${(Number(s.pct)*100).toFixed(1)}%</span></td>
      <td class="g">${f$(s.ganancia)}</td>
      <td class="g">${fM(s.ganancia)}</td>
      <td style="color:var(--red)">${f$(s.retiros)||'—'}</td>
      <td style="font-weight:600">${f$(s.saldo)}</td>
    </tr>`).join('')}
    <tr style="background:var(--gray)">
      <td style="font-weight:700">TOTAL</td>
      <td style="font-weight:700">${f$(totalCap)}</td>
      <td style="font-weight:700">100%</td>
      <td style="font-weight:700" class="g">${f$(D.socios.reduce((a,s)=>a+(Number(s.ganancia)||0),0))}</td>
      <td colspan="3"></td>
    </tr>
    </tbody></table></div>`;
}

// ── WATCHLIST ──────────────────────────────────────────────────
function renderWatchlist() {
  const el = document.getElementById('watch-table');
  if(!D.watchlist.length) { el.innerHTML='<div class="empty">Sin tickers. Agrega uno arriba.</div>'; return; }
  el.innerHTML = `<div class="tbl-wrap"><table>
    <thead><tr><th>Ticker</th><th>Nota</th><th>Precio actual</th><th>Cambio hoy</th><th>Precio meta</th><th>Falta (%)</th><th>Estado</th><th></th></tr></thead>
    <tbody>${D.watchlist.map(w=>`<tr>
      <td style="font-weight:700">${w.ticker}</td>
      <td style="color:var(--text-2)">${w.nota||'—'}</td>
      <td style="color:var(--teal-dk);font-weight:600">${w.precioActual&&w.precioActual!=='—'?f$(w.precioActual):'—'}</td>
      <td class="${Number(w.cambioHoy)>=0?'g':'r'}">${fp(w.cambioHoy)}</td>
      <td>${w.precioMeta?f$(w.precioMeta):'—'}</td>
      <td class="${Number(w.faltaMeta)<=0?'g':'r'}">${fp(w.faltaMeta)}</td>
      <td>${w.alerta||'—'}</td>
      <td><button onclick="deleteWatch(${w.rowIndex})" style="border:none;background:none;cursor:pointer;color:var(--red);font-size:16px">✕</button></td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

async function deleteWatch(rowIndex) {
  await api('deleteWatch', { rowIndex });
  await syncAll();
}

// ── CORTE ──────────────────────────────────────────────────────
function renderCorte() {
  const d = D.dashboard;
  const pnlS = d?.hoy?.pnlAcc || 0;
  const pnlO = d?.hoy?.pnlOpc || 0;
  const total = pnlS + pnlO;
  document.getElementById('corte-cards').innerHTML = `
    <div class="mc teal"><div class="ml">P&L acciones hoy</div><div class="mv">${f$(pnlS)}</div><div class="msub">${fM(pnlS)} MXN</div></div>
    <div class="mc blue"><div class="ml">P&L opciones hoy</div><div class="mv">${f$(pnlO)}</div><div class="msub">${fM(pnlO)} MXN</div></div>
    <div class="mc ${total>=0?'teal':'red'}"><div class="ml">Neto del día</div><div class="mv">${f$(total)}</div><div class="msub">${fM(total)} MXN</div></div>
    <div class="mc amber"><div class="ml">Tipo de cambio</div><div class="mv">$${FX.toFixed(2)}</div><div class="msub">USD/MXN</div></div>`;
}

// ── PLAN SCREEN ────────────────────────────────────────────────
function openPlanScreen(type) {
  planType = type;
  planTrades = [];
  const isStocks = type === 'stocks';
  document.getElementById('plan-screen-title').textContent = isStocks ? '📈 Plan Acciones' : '🎯 Plan Opciones';
  document.getElementById('leg-usd').style.background = isStocks ? 'var(--teal)' : 'var(--blue)';
  document.getElementById('plan-cap').value = isStocks ? (D.config.capAcciones||1000) : (D.config.capOpciones||500);
  document.getElementById('plan-pct').value = isStocks ? ((D.config.metaAcciones||0.03)*100) : ((D.config.metaOpciones||0.20)*100);
  document.getElementById('plan-mes').value = 1;
  document.getElementById('plan-dia').value = 1;
  document.getElementById('plan-screen').style.display = 'block';
  renderPlanScreen();
}

function closePlanScreen() {
  document.getElementById('plan-screen').style.display = 'none';
}

function buildMonthly(cap, pct, months=12) {
  let arr=[], c=cap;
  for(let m=1;m<=months;m++){const s=c;c=c*Math.pow(1+pct/100,22);arr.push({mes:m,start:s,end:c,gain:c-s,pct:((c-s)/s)*100});}
  return arr;
}
function buildDaily(cap, pct, mesIdx) {
  let arr=[], c=cap*Math.pow(1+pct/100,(mesIdx-1)*22);
  for(let d=1;d<=22;d++){const p=c;c=c*(1+pct/100);arr.push({dia:d,prev:p,cap:c,meta:p*pct/100});}
  return arr;
}

function renderPlanScreen() {
  const cap = parseFloat(document.getElementById('plan-cap').value)||1000;
  const pct = parseFloat(document.getElementById('plan-pct').value)||3;
  const mes = parseInt(document.getElementById('plan-mes').value)||1;
  const dia = parseInt(document.getElementById('plan-dia').value)||1;
  const isS = planType === 'stocks';
  const color = isS ? 'var(--teal)' : 'var(--blue)';
  const mcClass = isS ? 'teal' : 'blue';

  const monthly = buildMonthly(cap, pct);
  const daily = buildDaily(cap, pct, mes);
  const final12 = monthly[11].end;
  const totalGain = final12 - cap;
  const mPct = (Math.pow(1+pct/100,22)-1)*100;
  const todayP = daily[dia-1];
  const realPnl = planTrades.reduce((a,t)=>a+t.pnl,0);
  const prog = todayP.meta>0 ? Math.min((realPnl/todayP.meta)*100,150) : 0;

  document.getElementById('plan-kpis').innerHTML = `
    <div class="mc ${mcClass}"><div class="ml">Capital base hoy</div><div class="mv">${f$(todayP.prev)}</div><div class="msub">${fM(todayP.prev)} MXN</div></div>
    <div class="mc ${mcClass}"><div class="ml">Meta mínima hoy</div><div class="mv">+${f$(todayP.meta)}</div><div class="msub">+${fpR(pct)}%</div></div>
    <div class="mc ${mcClass}"><div class="ml">Capital proyectado</div><div class="mv">${f$(todayP.cap)}</div><div class="msub">${fM(todayP.cap)} MXN</div></div>
    <div class="mc amber"><div class="ml">% mensual mínimo</div><div class="mv">${mPct.toFixed(1)}%</div><div class="msub">22 días trading</div></div>
    <div class="mc ${mcClass}"><div class="ml">Capital final 12m</div><div class="mv">${f$(final12)}</div><div class="msub">${fM(final12)} MXN</div></div>
    <div class="mc ${mcClass}"><div class="ml">Ganancia 12m</div><div class="mv">${f$(totalGain)}</div><div class="msub">${fM(totalGain)} MXN</div></div>
    <div class="mc ${realPnl>=0?mcClass:'red'}"><div class="ml">P&L real hoy</div><div class="mv">${f$(realPnl)}</div><div class="msub">${fM(realPnl)} MXN</div></div>
    <div class="mc ${realPnl>=todayP.meta?mcClass:'amber'}"><div class="ml">Estado del día</div><div class="mv" style="font-size:14px">${realPnl>=todayP.meta?'✅ Meta lograda':'⏳ En progreso'}</div><div class="msub">${Math.max(prog,0).toFixed(0)}% completado</div></div>`;

  document.getElementById('plan-prog-detail').innerHTML = `<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px"><span style="color:var(--text-2)">Día ${dia} de 22 · Mes ${mes} de 12</span><span>Real: <strong style="color:${realPnl>=0?'var(--teal-dk)':'var(--red)'}">${f$(realPnl)}</strong> / Meta: <strong>${f$(todayP.meta)}</strong></span></div>`;
  const fill = document.getElementById('plan-prog-fill');
  fill.style.width = Math.max(Math.min(prog,100),0) + '%';
  fill.style.background = prog>=100 ? (isS?'var(--teal)':'var(--blue)') : 'var(--red)';
  document.getElementById('plan-prog-lbl').textContent = prog>=100 ? 'Meta del día alcanzada ✓' : 'Faltan: ' + f$(Math.max(todayP.meta-realPnl,0));

  renderPlanTradeForm(isS);
  renderPlanTradesTbl();

  const l12 = monthly.map(m=>'Mes '+m.mes);
  const d12usd = monthly.map(m=>parseFloat(m.end.toFixed(2)));
  const d12mxn = d12usd.map(v=>parseFloat((v*FX).toFixed(2)));
  if(charts.p12) charts.p12.destroy();
  charts.p12 = new Chart(document.getElementById('plan-chart-12'),{
    type:'line',
    data:{labels:l12,datasets:[
      {label:'USD',data:d12usd,borderColor:isS?'#1D9E75':'#185FA5',backgroundColor:isS?'rgba(29,158,117,0.1)':'rgba(24,95,165,0.1)',borderWidth:2.5,pointRadius:4,pointBackgroundColor:isS?'#1D9E75':'#185FA5',fill:true,tension:0.3},
      {label:'MXN',data:d12mxn,borderColor:'#BA7517',backgroundColor:'rgba(186,117,23,0.04)',borderWidth:1.5,borderDash:[5,4],pointRadius:3,pointBackgroundColor:'#BA7517',fill:false,tension:0.3}
    ]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>ctx.datasetIndex===0?'USD: '+f$(ctx.parsed.y):'MXN: '+f$(ctx.parsed.y/FX)+'='+f$(ctx.parsed.y)}}},
    scales:{x:{ticks:{font:{size:10},color:'#888'},grid:{display:false}},y:{ticks:{callback:v=>f$(v),font:{size:10},color:'#888'},grid:{color:'rgba(0,0,0,0.05)'}}}}
  });

  document.getElementById('plan-meses-tbl').innerHTML = monthly.map((m,i)=>`<tr${i===mes-1?' class="hl"':''}><td>Mes ${m.mes}</td><td>${f$(m.start)}</td><td>${f$(m.end)}</td><td class="g">+${f$(m.gain)}</td><td class="g">+${fM(m.gain)}</td><td>${fM(m.end)}</td><td class="g">+${m.pct.toFixed(2)}%</td></tr>`).join('');

  const dl = daily.map(d=>'D'+d.dia);
  const dd = daily.map(d=>parseFloat(d.cap.toFixed(2)));
  if(charts.pDias) charts.pDias.destroy();
  charts.pDias = new Chart(document.getElementById('plan-chart-dias'),{
    type:'bar',
    data:{labels:dl,datasets:[{label:'Capital',data:dd,backgroundColor:dd.map((_,i)=>i===dia-1?(isS?'#1D9E75':'#185FA5'):isS?'rgba(29,158,117,0.3)':'rgba(24,95,165,0.3)'),borderRadius:3}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>'USD: '+f$(ctx.parsed.y)+' | MXN: '+fM(ctx.parsed.y/FX)}}},
    scales:{x:{ticks:{font:{size:9},color:'#888',autoSkip:false,maxRotation:0},grid:{display:false}},y:{ticks:{callback:v=>f$(v),font:{size:9},color:'#888'},grid:{color:'rgba(0,0,0,0.05)'}}}}
  });
}

function renderPlanTradeForm(isStocks) {
  const el = document.getElementById('plan-trade-form');
  if(isStocks) {
    el.innerHTML = `<div class="tr-row">
      <input type="text" id="pt-tk" placeholder="Ticker" style="text-transform:uppercase">
      <input type="number" id="pt-sh" placeholder="Acciones">
      <input type="number" id="pt-bp" placeholder="Compra ($)" step="0.01">
      <input type="number" id="pt-sp" placeholder="Venta ($)" step="0.01">
      <input type="number" id="pt-cm" placeholder="Comisión" step="0.01" value="0">
    </div>
    <button class="btn green" onclick="addPlanTrade()">+ Agregar trade</button>`;
  } else {
    el.innerHTML = `<div class="tr-row">
      <input type="text" id="pt-tk" placeholder="Empresa" style="text-transform:uppercase">
      <input type="number" id="pt-sk" placeholder="Strike" step="0.5">
      <input type="text" id="pt-tp" placeholder="CALL/PUT" value="CALL" style="width:80px">
      <input type="number" id="pt-ct" placeholder="Contratos">
      <input type="number" id="pt-pb" placeholder="Prima C." step="0.01">
      <input type="number" id="pt-ps" placeholder="Prima V." step="0.01">
      <input type="number" id="pt-cm" placeholder="Comisión" step="0.01" value="0">
    </div>
    <button class="btn blue" onclick="addPlanTrade()">+ Agregar opción</button>`;
  }
}

function addPlanTrade() {
  const tk = (document.getElementById('pt-tk')?.value||'').toUpperCase().trim();
  const cm = parseFloat(document.getElementById('pt-cm')?.value)||0;
  let pnl=0, detail='';
  if(planType==='stocks') {
    const sh=parseFloat(document.getElementById('pt-sh')?.value)||0;
    const bp=parseFloat(document.getElementById('pt-bp')?.value)||0;
    const sp=parseFloat(document.getElementById('pt-sp')?.value)||0;
    if(!tk||!sh||!bp||!sp){showToast('Completa todos los campos');return;}
    pnl=(sp-bp)*sh-cm; detail=`${sh} acc @${f$(bp)}→${f$(sp)}`;
  } else {
    const sk=parseFloat(document.getElementById('pt-sk')?.value)||0;
    const ct=parseInt(document.getElementById('pt-ct')?.value)||0;
    const pb=parseFloat(document.getElementById('pt-pb')?.value)||0;
    const ps=parseFloat(document.getElementById('pt-ps')?.value)||0;
    if(!tk||!sk||!ct||!pb||!ps){showToast('Completa todos los campos');return;}
    pnl=(ps-pb)*ct*100-cm; detail=`${ct}ct @${f$(pb)}→${f$(ps)}`;
  }
  const cap = parseFloat(document.getElementById('plan-cap')?.value)||1000;
  const pct = parseFloat(document.getElementById('plan-pct')?.value)||3;
  const mes = parseInt(document.getElementById('plan-mes')?.value)||1;
  const dia = parseInt(document.getElementById('plan-dia')?.value)||1;
  const daily = buildDaily(cap, pct, mes);
  const base = daily[dia-1].prev;
  planTrades.push({id:uid(),ticker:tk,pnl,pnlPct:base>0?(pnl/base)*100:0,detail,commission:cm});
  ['pt-tk','pt-sh','pt-sp','pt-bp','pt-sk','pt-ct','pt-pb','pt-ps'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  document.getElementById('pt-cm').value='0';
  renderPlanScreen();
}

function renderPlanTradesTbl() {
  const el = document.getElementById('plan-trades-tbl');
  if(!planTrades.length){el.innerHTML='';return;}
  el.innerHTML=`<div class="tbl-wrap"><table>
    <thead><tr><th>Ticker</th><th>Detalle</th><th>Comisión</th><th>P&L $</th><th>P&L %</th><th>P&L MXN</th><th></th></tr></thead>
    <tbody>${planTrades.map(t=>`<tr>
      <td style="font-weight:600">${t.ticker}</td>
      <td style="color:var(--text-2);font-size:11px">${t.detail}</td>
      <td style="color:var(--red)">-${f$(t.commission)}</td>
      <td class="${t.pnl>=0?'g':'r'}">${f$(t.pnl)}</td>
      <td class="${t.pnlPct>=0?'g':'r'}">${fpR(t.pnlPct)}%</td>
      <td class="${t.pnl>=0?'g':'r'}">${fM(t.pnl)}</td>
      <td><button onclick="rmPlanTrade('${t.id}')" style="border:none;background:none;cursor:pointer;color:var(--red);font-size:16px">✕</button></td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function rmPlanTrade(id) { planTrades=planTrades.filter(t=>t.id!==id); renderPlanScreen(); }

// ── MODALS ─────────────────────────────────────────────────────
function openModal(type) {
  const overlay = document.getElementById('modal-overlay');
  const inner = document.getElementById('modal-inner');
  overlay.classList.add('open');

  if(type==='cap-acc') {
    inner.innerHTML=`<h3>Agregar capital — Acciones</h3>
      <div class="form-grid"><div class="form-group"><label>Monto ($)</label><input type="number" id="m-amt" step="0.01" placeholder="1000.00"></div></div>
      <div class="modal-footer"><button class="btn green" onclick="doCapital('deposito_acc')">Depositar</button><button class="btn" onclick="closeModal()">Cancelar</button></div>`;
  } else if(type==='cap-opc') {
    inner.innerHTML=`<h3>Agregar capital — Opciones</h3>
      <div class="form-grid"><div class="form-group"><label>Monto ($)</label><input type="number" id="m-amt" step="0.01" placeholder="500.00"></div></div>
      <div class="modal-footer"><button class="btn blue" onclick="doCapital('deposito_opc')">Depositar</button><button class="btn" onclick="closeModal()">Cancelar</button></div>`;
  } else if(type==='retiro') {
    inner.innerHTML=`<h3>Registrar retiro</h3>
      <div class="form-grid">
        <div class="form-group"><label>Cuenta</label><select id="m-rc"><option value="retiro_acc">Acciones</option><option value="retiro_opc">Opciones</option></select></div>
        <div class="form-group"><label>Monto ($)</label><input type="number" id="m-amt" step="0.01" placeholder="500.00"></div>
      </div>
      <div class="modal-footer"><button class="btn red" onclick="doCapital(document.getElementById('m-rc').value)">Retirar</button><button class="btn" onclick="closeModal()">Cancelar</button></div>`;
  } else if(type==='nueva-pos') {
    inner.innerHTML=`<h3>Agregar posición nueva</h3>
      <div class="form-grid">
        <div class="form-group"><label>Tipo</label><select id="m-pt" onchange="togglePosFields()"><option value="A">Acción</option><option value="O">Opción</option></select></div>
        <div class="form-group"><label>Ticker / Empresa</label><input type="text" id="m-ptk" placeholder="AAPL" style="text-transform:uppercase"></div>
        <div class="form-group"><label>Fecha apertura</label><input type="date" id="m-pd" value="${todayISO}"></div>
      </div>
      <div id="m-pex"></div>
      <div class="modal-footer"><button class="btn green" onclick="addPos()">Agregar</button><button class="btn" onclick="closeModal()">Cancelar</button></div>`;
    togglePosFields();
  } else if(type==='cerrar-pos') {
    const abiertas = [...D.acciones.filter(a=>a.estado==='Abierta').map(a=>({id:a.ticker,label:`${a.ticker} — Acción (${f$(a.precioCompra)}×${a.acciones})`,tipo:'A'})),
                      ...D.opciones.filter(o=>o.estado==='Abierta').map(o=>({id:o.empresa+'_'+o.strike,label:`${o.empresa} ${o.tipo} $${o.strike} (${o.contratos} ct)`,tipo:'O',empresa:o.empresa}))];
    if(!abiertas.length){inner.innerHTML=`<h3>Cerrar posición</h3><p style="color:var(--text-2);margin-bottom:16px">No hay posiciones abiertas.</p><button class="btn" onclick="closeModal()">Cerrar</button>`;return;}
    inner.innerHTML=`<h3>Cerrar posición</h3>
      <div class="form-grid" style="grid-template-columns:1fr">
        <div class="form-group"><label>Posición</label><select id="m-cpos">${abiertas.map((p,i)=>`<option value="${i}">${p.label}</option>`).join('')}</select></div>
      </div>
      <div class="form-grid">
        <div class="form-group"><label>Precio venta / salida ($)</label><input type="number" id="m-cs" step="0.01" placeholder="0.00"></div>
        <div class="form-group"><label>Comisión de cierre ($)</label><input type="number" id="m-cc" step="0.01" value="0"></div>
        <div class="form-group"><label>Fecha de cierre</label><input type="date" id="m-cd" value="${todayISO}"></div>
      </div>
      <div class="modal-footer"><button class="btn red" onclick="cerrarPos(${JSON.stringify(abiertas)})">Cerrar posición</button><button class="btn" onclick="closeModal()">Cancelar</button></div>`;
  } else if(type==='nuevo-socio') {
    inner.innerHTML=`<h3>Agregar socio</h3>
      <div class="form-grid">
        <div class="form-group"><label>Nombre</label><input type="text" id="m-sn" placeholder="Nombre del socio"></div>
        <div class="form-group"><label>Capital aportado ($)</label><input type="number" id="m-sc" step="0.01" placeholder="1000.00"></div>
        <div class="form-group"><label>Fecha de ingreso</label><input type="date" id="m-sd" value="${todayISO}"></div>
        <div class="form-group"><label>Notas</label><input type="text" id="m-sn2" placeholder="Opcional"></div>
      </div>
      <div class="modal-footer"><button class="btn green" onclick="addSocio()">Agregar socio</button><button class="btn" onclick="closeModal()">Cancelar</button></div>`;
  } else if(type==='nueva-watch') {
    inner.innerHTML=`<h3>Agregar a Watchlist</h3>
      <div class="form-grid">
        <div class="form-group"><label>Ticker</label><input type="text" id="m-wt" placeholder="AAPL" style="text-transform:uppercase"></div>
        <div class="form-group"><label>Precio meta ($)</label><input type="number" id="m-wm" step="0.01" placeholder="200.00"></div>
        <div class="form-group"><label>Nota</label><input type="text" id="m-wn" placeholder="Opcional"></div>
      </div>
      <div class="modal-footer"><button class="btn green" onclick="addWatch()">Agregar</button><button class="btn" onclick="closeModal()">Cancelar</button></div>`;
  }
}

function togglePosFields() {
  const t = document.getElementById('m-pt')?.value;
  const el = document.getElementById('m-pex'); if(!el) return;
  if(t==='A') el.innerHTML=`<div class="form-grid">
    <div class="form-group"><label>Nº acciones</label><input type="number" id="m-psh" placeholder="10"></div>
    <div class="form-group"><label>Precio compra ($)</label><input type="number" id="m-pbp" step="0.01" placeholder="150.00"></div>
    <div class="form-group"><label>Comisión ($)</label><input type="number" id="m-pcm" step="0.01" value="0"></div>
  </div>`;
  else el.innerHTML=`<div class="form-grid">
    <div class="form-group"><label>Tipo</label><select id="m-pot"><option>CALL</option><option>PUT</option></select></div>
    <div class="form-group"><label>Strike ($)</label><input type="number" id="m-psk" step="0.5" placeholder="450.00"></div>
    <div class="form-group"><label>Contratos</label><input type="number" id="m-pct" placeholder="1"></div>
    <div class="form-group"><label>Prima compra ($)</label><input type="number" id="m-pbp" step="0.01" placeholder="2.50"></div>
    <div class="form-group"><label>Fecha vencim.</label><input type="date" id="m-pex2"></div>
    <div class="form-group"><label>Comisión ($)</label><input type="number" id="m-pcm" step="0.01" value="0"></div>
  </div>`;
}

function closeModal() { document.getElementById('modal-overlay').classList.remove('open'); }
document.getElementById('modal-overlay').addEventListener('click', function(e){ if(e.target===this) closeModal(); });

// ── ACTIONS ────────────────────────────────────────────────────
async function doCapital(tipo) {
  const amt = parseFloat(document.getElementById('m-amt')?.value)||0;
  if(!amt||amt<=0){showToast('Ingresa un monto válido');return;}
  await api('saveCapital',{tipo,monto:amt});
  closeModal(); showToast('Capital actualizado'); await syncAll();
}

async function addPos() {
  const tipo=document.getElementById('m-pt')?.value;
  const ticker=(document.getElementById('m-ptk')?.value||'').toUpperCase().trim();
  const openDate=document.getElementById('m-pd')?.value||todayISO;
  const comm=parseFloat(document.getElementById('m-pcm')?.value)||0;
  const buyPrice=parseFloat(document.getElementById('m-pbp')?.value)||0;
  if(!ticker||!buyPrice){showToast('Completa ticker y precio');return;}
  if(tipo==='A'){
    const sh=parseInt(document.getElementById('m-psh')?.value)||0;
    if(!sh){showToast('Ingresa número de acciones');return;}
    await api('saveAccion',{fechaCompra:openDate,ticker,acciones:sh,precioCompra:buyPrice,comision:comm});
  } else {
    const sk=parseFloat(document.getElementById('m-psk')?.value)||0;
    const ct=parseInt(document.getElementById('m-pct')?.value)||0;
    const ot=document.getElementById('m-pot')?.value||'CALL';
    const ex=document.getElementById('m-pex2')?.value||'';
    if(!sk||!ct){showToast('Completa strike y contratos');return;}
    await api('saveOpcion',{empresa:ticker,strike:sk,tipo:ot,contratos:ct,primaCompra:buyPrice,comision:comm,fechaApertura:openDate,fechaVencim:ex});
  }
  closeModal(); showToast('Posición agregada'); await syncAll();
}

async function cerrarPos(abiertas) {
  const idx=parseInt(document.getElementById('m-cpos')?.value)||0;
  const sel=abiertas[idx];
  const sell=parseFloat(document.getElementById('m-cs')?.value)||0;
  const comm=parseFloat(document.getElementById('m-cc')?.value)||0;
  const cd=document.getElementById('m-cd')?.value||todayISO;
  if(!sell){showToast('Ingresa precio de venta');return;}
  if(sel.tipo==='A') await api('closeAccion',{ticker:sel.id,precioVenta:sell,comisionCierre:comm,fechaCierre:cd});
  else await api('closeOpcion',{empresa:sel.empresa,primaVenta:sell,comisionCierre:comm,fechaCierre:cd});
  closeModal(); showToast('Posición cerrada'); await syncAll();
}

async function addSocio() {
  const nombre=document.getElementById('m-sn')?.value.trim();
  const capital=parseFloat(document.getElementById('m-sc')?.value)||0;
  const fecha=document.getElementById('m-sd')?.value||todayISO;
  const notas=document.getElementById('m-sn2')?.value||'';
  if(!nombre||!capital){showToast('Nombre y capital son requeridos');return;}
  await api('saveSocio',{nombre,capital,fechaIngreso:fecha,notas});
  closeModal(); showToast('Socio agregado'); await syncAll();
}

async function addWatch() {
  const ticker=(document.getElementById('m-wt')?.value||'').toUpperCase().trim();
  const meta=parseFloat(document.getElementById('m-wm')?.value)||0;
  const nota=document.getElementById('m-wn')?.value||'';
  if(!ticker){showToast('Ingresa un ticker');return;}
  await api('saveWatch',{ticker,precioMeta:meta,nota});
  closeModal(); showToast('Ticker agregado'); await syncAll();
}

// ── DEMO DATA ──────────────────────────────────────────────────
function loadDemoData() {
  D.config = {capAcciones:1000,capOpciones:500,metaAcciones:0.03,metaOpciones:0.20,meses:12,tipoCambio:17.5};
  D.dashboard = {
    capAcciones:1030,capOpciones:600,capTotal:1630,capTotalMXN:28525,
    pnlAcciones:30,pnlOpciones:100,pnlTotal:130,pnlTotalMXN:2275,
    comisiones:4.5,rendimiento:0.087,
    hoy:{pnlAcc:30,pnlOpc:100,total:130,mxn:2275},
    semana:{pnlAcc:80,pnlOpc:200,total:280,mxn:4900},
    mes:{pnlAcc:200,pnlOpc:500,total:700,mxn:12250},
    anio:{pnlAcc:800,pnlOpc:1500,total:2300,mxn:40250},
    total:{pnlAcc:800,pnlOpc:1500,total:2300,mxn:40250},
    tipoCambio:17.5,
  };
  D.acciones = [
    {ticker:'AAPL',acciones:10,precioCompra:170,subtotal:1700,precioVenta:181,ingresosVenta:1810,comision:1.30,pnl:108.70,pnlPct:0.064,estado:'Cerrada',fechaCompra:'01/05/2025',fechaCierre:'10/05/2025',precioActual:'—',difObjetivo:'—'},
    {ticker:'NVDA',acciones:5,precioCompra:880,subtotal:4400,precioVenta:'',ingresosVenta:'',comision:0.65,pnl:'',pnlPct:'',estado:'Abierta',fechaCompra:'12/05/2025',fechaCierre:'',precioActual:910,difObjetivo:0.034},
  ];
  D.opciones = [
    {empresa:'SPY',strike:520,tipo:'CALL',contratos:2,primaCompra:3.50,subtotal:700,comision:1.30,primaVenta:5.80,ingresos:1160,pnl:458.70,pnlPct:0.655,estado:'Cerrada',fechaApertura:'05/05/2025',fechaCierre:'09/05/2025',fechaVencim:'16/05/2025',diasVencim:'—',alerta:'—'},
    {empresa:'AAPL',strike:185,tipo:'CALL',contratos:1,primaCompra:2.20,subtotal:220,comision:0.65,primaVenta:'',ingresos:'',pnl:'',pnlPct:'',estado:'Abierta',fechaApertura:'13/05/2025',fechaCierre:'',fechaVencim:'17/05/2025',diasVencim:4,alerta:'⚠️ VENCE PRONTO'},
  ];
  D.socios = [
    {nombre:'Luis (Principal)',fechaIngreso:'01/01/2025',capital:1500,pct:0.75,ganancia:97.5,gananciaMXN:1706.25,retiros:0,saldo:1597.5,notas:'Trader principal'},
    {nombre:'Mi hijo',fechaIngreso:'15/03/2025',capital:500,pct:0.25,ganancia:32.5,gananciaMXN:568.75,retiros:0,saldo:532.5,notas:'Capital compartido'},
  ];
  D.watchlist = [
    {rowIndex:3,ticker:'TSLA',nota:'Esperar break 200',precioActual:175,cambioHoy:0.02,precioMeta:200,faltaMeta:0.14,alerta:'⏳ Esperando'},
    {rowIndex:4,ticker:'META',nota:'',precioActual:510,cambioHoy:-0.01,precioMeta:480,faltaMeta:-0.06,alerta:'✅ Llegó'},
  ];
  FX = 17.5;
  document.getElementById('fx-rate').textContent = '$17.50';
  document.getElementById('plan-fx').textContent = '$17.50';
}

function getDemoResponse(action) {
  const map = {getConfig:D.config,getDashboard:D.dashboard,getAcciones:{acciones:D.acciones},getOpciones:{opciones:D.opciones},getSocios:{socios:D.socios},getWatchlist:{watchlist:D.watchlist}};
  return map[action] || {saved:true};
}

// ── TOAST ──────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),3000);
}

// ── INIT ───────────────────────────────────────────────────────
const savedUrl = localStorage.getItem('eva_api_url');
if(savedUrl){ API_URL=savedUrl; startApp(); }
