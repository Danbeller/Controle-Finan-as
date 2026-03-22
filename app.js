// ═══════════════════════════════════════════════════════════
// FinControl Pro — Frontend
// Conectado ao backend FastAPI + SQLite (.db)
// ═══════════════════════════════════════════════════════════

const API = window.location.origin.includes('localhost') ? 'http://localhost:8080' : '';

let currentUser   = null;
let authToken     = null;
let chartFluxo    = null, chartCat   = null, chartSaldo  = null;
let chartDespCat  = null, chartRecCat = null;
let movFilterType = 'todos';

// ═══════════════════════════════════════════════════════════
// HTTP HELPER
// ═══════════════════════════════════════════════════════════
async function api(method, path, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  if (res.status === 401) { doLogout(); return null; }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Erro desconhecido' }));
    throw new Error(err.detail || 'Erro na requisição');
  }
  return res.status === 204 ? null : res.json();
}

async function apiForm(path, formData) {
  const res = await fetch(API + path, { method: 'POST', body: formData });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Erro' }));
    throw new Error(err.detail || 'Erro');
  }
  return res.json();
}

// ═══════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════
async function doLogin() {
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  const errEl    = document.getElementById('auth-error');
  errEl.style.display = 'none';
  if (!username || !password) {
    errEl.textContent = 'Preencha todos os campos.';
    errEl.style.display = 'block';
    return;
  }
  try {
    const form = new FormData();
    form.append('username', username);
    form.append('password', password);
    const data  = await apiForm('/auth/login', form);
    authToken   = data.access_token;
    currentUser = data.usuario;
    localStorage.setItem('fincontrol_token', authToken);
    localStorage.setItem('fincontrol_user',  JSON.stringify(currentUser));
    initApp();
  } catch (e) {
    errEl.textContent = e.message || 'Usuário ou senha inválidos.';
    errEl.style.display = 'block';
  }
}

function doLogout() {
  authToken   = null;
  currentUser = null;
  localStorage.removeItem('fincontrol_token');
  localStorage.removeItem('fincontrol_user');
  document.getElementById('app').style.display         = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
}

function initApp() {
  document.getElementById('user-name-display').textContent = currentUser.nome;
  document.getElementById('user-role-display').textContent =
    currentUser.role === 'admin' ? 'Administrador' :
    currentUser.role === 'gerente' ? 'Gerente' : 'Operador';
  document.getElementById('user-avatar').textContent =
    currentUser.nome.split(' ').map(n => n[0]).join('').substring(0,2).toUpperCase();
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display         = 'flex';
  document.getElementById('today-date').textContent    =
    new Date().toLocaleDateString('pt-BR', {weekday:'long', year:'numeric', month:'long', day:'numeric'});
  navigate('dashboard');
}

window.addEventListener('DOMContentLoaded', () => {
  // ── LOGIN DESATIVADO PARA TESTES ──────────────────────────
  // Para reativar o login, comente o bloco abaixo (AUTO-LOGIN)
  // e descomente o bloco original (VERIFICAR SESSÃO SALVA).

  // AUTO-LOGIN como admin (bypass da tela de login)
  autoLoginAdmin();

  // ── VERIFICAR SESSÃO SALVA (login normal) ─────────────────
  // const savedToken = localStorage.getItem('fincontrol_token');
  // const savedUser  = localStorage.getItem('fincontrol_user');
  // if (savedToken && savedUser) {
  //   authToken   = savedToken;
  //   currentUser = JSON.parse(savedUser);
  //   initApp();
  // }
});

// Auto-login silencioso como admin (usado quando login está desativado)
async function autoLoginAdmin() {
  try {
    const form = new FormData();
    form.append('username', 'admin');
    form.append('password', 'admin123');
    const data  = await apiForm('/auth/login', form);
    authToken   = data.access_token;
    currentUser = data.usuario;
    initApp();
  } catch (e) {
    console.error('Auto-login falhou:', e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const passEl = document.getElementById('login-pass');
  if (passEl) passEl.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  const overlayEl = document.getElementById('modal-overlay');
  if (overlayEl) overlayEl.addEventListener('click', e => {
    if (e.target === overlayEl) closeModal();
  });
});

// ═══════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = document.getElementById('page-' + page);
  if (pageEl) pageEl.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.getAttribute('onclick')?.includes(`'${page}'`)) n.classList.add('active');
  });
  const loaders = {
    dashboard:    refreshDashboard,
    receitas:     loadReceitas,
    despesas:     loadDespesas,
    fluxo:        loadFluxo,
    produtos:     loadProdutos,
    movimentos:   loadMovimentos,
    clientes:     loadClientes,
    fornecedores: loadFornecedores,
    relatorios:   loadRelatorios,
  };
  if (loaders[page]) loaders[page]();
}

// ═══════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════
function fmt(v) {
  return 'R$ ' + Number(v||0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
}
function fmtDate(d) {
  if (!d) return '—';
  return String(d).substring(0,10).split('-').reverse().join('/');
}
function fmtDateTime(d) {
  if (!d) return '—';
  const parts = String(d).replace('T',' ').substring(0,16).split(' ');
  return `${parts[0].split('-').reverse().join('/')} ${parts[1]||''}`;
}

function toast(msg, type = 'success') {
  const t  = document.getElementById('toast');
  const el = document.createElement('div');
  el.className = 'toast-item ' + type;
  const icon = type === 'success'
    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="9 11 12 14 22 4"/></svg>'
    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  el.innerHTML = icon + msg;
  t.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ═══════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════
async function refreshDashboard() {
  try {
    const d = await api('GET', '/dashboard');
    if (!d) return;

    document.getElementById('dash-stats').innerHTML = [
      { label:'Saldo Total',     value: fmt(d.saldo),          change: d.saldo >= 0 ? '▲ Positivo' : '▼ Negativo', pos: d.saldo >= 0, icon:'💰' },
      { label:'Total Receitas',  value: fmt(d.total_receitas), change: 'Confirmadas', pos: true,                   icon:'📈' },
      { label:'Total Despesas',  value: fmt(d.total_despesas), change: 'Pagas',       pos: false,                  icon:'📉' },
      { label:'Produtos Ativos', value: d.total_produtos,
        change: d.estoque_baixo > 0 ? `⚠ ${d.estoque_baixo} abaixo mínimo` : '✓ Estoque ok',
        pos: d.estoque_baixo === 0, icon:'📦' },
    ].map(s => `
      <div class="stat-card">
        <div style="display:flex;justify-content:space-between;align-items:start;">
          <div class="stat-label">${s.label}</div>
          <div style="font-size:20px;">${s.icon}</div>
        </div>
        <div class="stat-value" style="font-size:18px;">${s.value}</div>
        <div class="stat-change ${s.pos?'pos':'neg'}">${s.change}</div>
      </div>`).join('');

    document.getElementById('dash-transactions').innerHTML =
      d.ultimas_transacoes.length
        ? d.ultimas_transacoes.map(t => `
            <div class="summary-row">
              <div>
                <div style="font-size:13px;font-weight:500;">${t.descricao}</div>
                <div style="font-size:11px;color:var(--text3);">${fmtDate(t.data)} · ${t.tipo}</div>
              </div>
              <div class="money ${t.tipo==='receita'?'money-green':'money-red'}">
                ${t.tipo==='receita'?'+':'-'}${fmt(t.valor)}
              </div>
            </div>`).join('')
        : '<div class="empty-state"><p>Nenhuma transação</p></div>';

    document.getElementById('dash-low-count').textContent = d.estoque_baixo;
    document.getElementById('dash-lowstock').innerHTML =
      d.estoque_critico.length
        ? d.estoque_critico.map(p => `
            <div class="summary-row">
              <div>
                <div style="font-size:13px;font-weight:500;">${p.nome}</div>
                <div style="font-size:11px;color:var(--text3);">${p.codigo}</div>
              </div>
              <div>
                <span class="stock-low">${p.estoque_atual}</span>
                <span style="color:var(--text3);font-size:11px;">/ mín ${p.estoque_minimo}</span>
              </div>
            </div>`).join('')
        : '<div class="empty-state" style="padding:24px;"><p>Nenhum produto crítico ✓</p></div>';

    buildChartFluxo();
    buildChartCat();
  } catch(e) {
    console.error(e);
    toast('Erro ao carregar dashboard', 'error');
  }
}

async function buildChartFluxo() {
  const rows = await api('GET', '/dashboard/fluxo-mensal');
  if (!rows) return;
  const meses = {}, labels = [];
  rows.forEach(r => {
    if (!meses[r.mes]) { meses[r.mes] = {rec:0,desp:0}; labels.push(r.mes); }
    if (r.tipo === 'receita') meses[r.mes].rec  += Number(r.total);
    else                      meses[r.mes].desp += Number(r.total);
  });
  const rec  = labels.map(m => meses[m].rec);
  const desp = labels.map(m => meses[m].desp);
  const fmtLabel = m => { const [y,mo]=m.split('-'); return new Date(y,mo-1).toLocaleDateString('pt-BR',{month:'short',year:'2-digit'}); };
  const ctx = document.getElementById('chart-fluxo').getContext('2d');
  if (chartFluxo) chartFluxo.destroy();
  chartFluxo = new Chart(ctx, {
    type:'bar',
    data:{labels:labels.map(fmtLabel), datasets:[
      {label:'Receitas', data:rec,  backgroundColor:'rgba(16,185,129,0.6)', borderRadius:4},
      {label:'Despesas', data:desp, backgroundColor:'rgba(239,68,68,0.5)',  borderRadius:4}
    ]},
    options:{responsive:true, maintainAspectRatio:false,
      plugins:{legend:{labels:{color:'#8b90a0',font:{size:11}}}},
      scales:{x:{ticks:{color:'#555a6e'},grid:{color:'rgba(255,255,255,0.04)'}},
              y:{ticks:{color:'#555a6e',callback:v=>'R$'+v.toLocaleString('pt-BR')},grid:{color:'rgba(255,255,255,0.04)'}}}}
  });
}

async function buildChartCat() {
  const cats = await api('GET', '/dashboard/categorias-despesas');
  if (!cats || !cats.length) return;
  const ctx = document.getElementById('chart-cat').getContext('2d');
  if (chartCat) chartCat.destroy();
  chartCat = new Chart(ctx, {
    type:'doughnut',
    data:{labels:cats.map(c=>c.categoria||'Outras'), datasets:[{
      data:cats.map(c=>c.total),
      backgroundColor:['#3b82f6','#8b5cf6','#ef4444','#f59e0b','#10b981','#06b6d4','#ec4899','#84cc16'],
      borderWidth:0
    }]},
    options:{responsive:true, maintainAspectRatio:false,
      plugins:{legend:{position:'right',labels:{color:'#8b90a0',font:{size:11},boxWidth:12}}}}
  });
}

// ═══════════════════════════════════════════════════════════
// RECEITAS
// ═══════════════════════════════════════════════════════════
async function loadReceitas() {
  const s   = document.getElementById('search-receitas')?.value || '';
  const cat = document.getElementById('filter-receitas-cat')?.value || '';
  let qs = `?tipo=receita`;
  if (s)   qs += `&q=${encodeURIComponent(s)}`;
  if (cat) qs += `&status=${encodeURIComponent(cat)}`;
  const rows = await api('GET', `/transacoes${qs}`) || [];
  const statusBadge = s => s==='pago'?'badge-green':s==='pendente'?'badge-amber':'badge-red';
  document.getElementById('tb-receitas').innerHTML = rows.length
    ? rows.map(r => `
        <tr>
          <td>${fmtDate(r.data)}</td>
          <td>${r.descricao}</td>
          <td><span class="badge badge-blue">${r.categoria_nome||'—'}</span></td>
          <td>${r.cliente_nome||'—'}</td>
          <td class="money money-green">+${fmt(r.valor)}</td>
          <td><span class="badge ${statusBadge(r.status)}">${r.status}</span></td>
          <td><button class="btn btn-danger btn-sm" onclick="deleteTransacao(${r.id},'receita')">✕</button></td>
        </tr>`).join('')
    : `<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:32px;">Nenhuma receita encontrada</td></tr>`;
}

// ═══════════════════════════════════════════════════════════
// DESPESAS
// ═══════════════════════════════════════════════════════════
async function loadDespesas() {
  const s   = document.getElementById('search-despesas')?.value || '';
  const cat = document.getElementById('filter-despesas-cat')?.value || '';
  let qs = `?tipo=despesa`;
  if (s)   qs += `&q=${encodeURIComponent(s)}`;
  if (cat) qs += `&status=${encodeURIComponent(cat)}`;
  const rows = await api('GET', `/transacoes${qs}`) || [];
  const statusBadge = s => s==='pago'?'badge-green':s==='pendente'?'badge-amber':'badge-red';
  document.getElementById('tb-despesas').innerHTML = rows.length
    ? rows.map(r => `
        <tr>
          <td>${fmtDate(r.data)}</td>
          <td>${r.descricao}</td>
          <td><span class="badge badge-red">${r.categoria_nome||'—'}</span></td>
          <td>${r.fornecedor_nome||'—'}</td>
          <td class="money money-red">-${fmt(r.valor)}</td>
          <td><span class="badge ${statusBadge(r.status)}">${r.status}</span></td>
          <td><button class="btn btn-danger btn-sm" onclick="deleteTransacao(${r.id},'despesa')">✕</button></td>
        </tr>`).join('')
    : `<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:32px;">Nenhuma despesa encontrada</td></tr>`;
}

// ═══════════════════════════════════════════════════════════
// FLUXO DE CAIXA
// ═══════════════════════════════════════════════════════════
async function loadFluxo() {
  const days = parseInt(document.getElementById('fluxo-period')?.value || 30);
  const rows = await api('GET', `/transacoes?status=pago`) || [];
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
  const filtered = rows
    .filter(r => new Date(r.data) >= cutoff)
    .sort((a,b) => a.data.localeCompare(b.data));
  let saldo = 0;
  const extrato = filtered.map(r => {
    saldo += r.tipo === 'receita' ? Number(r.valor) : -Number(r.valor);
    return {...r, saldo};
  });
  const totalRec  = extrato.filter(r=>r.tipo==='receita').reduce((a,r)=>a+Number(r.valor),0);
  const totalDesp = extrato.filter(r=>r.tipo==='despesa').reduce((a,r)=>a+Number(r.valor),0);

  document.getElementById('fluxo-stats').innerHTML = [
    {label:'Receitas no Período', value:fmt(totalRec),           c:'money-green'},
    {label:'Despesas no Período', value:fmt(totalDesp),          c:'money-red'},
    {label:'Resultado',           value:fmt(totalRec-totalDesp), c:totalRec>=totalDesp?'money-green':'money-red'},
    {label:'Saldo Acumulado',     value:fmt(saldo),              c:''},
  ].map(s=>`<div class="stat-card"><div class="stat-label">${s.label}</div><div class="stat-value ${s.c}" style="font-size:17px;">${s.value}</div></div>`).join('');

  const byDate = {};
  extrato.forEach(r => {
    const d = r.data.substring(0,10);
    if (!byDate[d]) byDate[d] = {saldo:0};
    byDate[d].saldo = r.saldo;
  });
  const chartLabels = Object.keys(byDate).sort();
  const saldos = chartLabels.map(d => byDate[d].saldo);
  const ctx = document.getElementById('chart-saldo').getContext('2d');
  if (chartSaldo) chartSaldo.destroy();
  chartSaldo = new Chart(ctx, {
    type:'line',
    data:{labels:chartLabels.map(fmtDate), datasets:[{
      label:'Saldo', data:saldos,
      borderColor:'#3b82f6', backgroundColor:'rgba(59,130,246,0.08)',
      tension:0.4, fill:true, pointRadius:3
    }]},
    options:{responsive:true, maintainAspectRatio:false,
      plugins:{legend:{labels:{color:'#8b90a0'}}},
      scales:{x:{ticks:{color:'#555a6e',maxTicksLimit:10},grid:{color:'rgba(255,255,255,0.04)'}},
              y:{ticks:{color:'#555a6e',callback:v=>'R$'+v.toLocaleString('pt-BR')},grid:{color:'rgba(255,255,255,0.04)'}}}}
  });

  document.getElementById('tb-fluxo').innerHTML =
    [...extrato].reverse().map(r => `
    <tr>
      <td>${fmtDate(r.data)}</td>
      <td>${r.descricao}</td>
      <td><span class="badge ${r.tipo==='receita'?'badge-green':'badge-red'}">${r.tipo}</span></td>
      <td class="money ${r.tipo==='receita'?'money-green':'money-red'}">${r.tipo==='receita'?'+':'-'}${fmt(r.valor)}</td>
      <td class="money ${r.saldo>=0?'money-green':'money-red'}">${fmt(r.saldo)}</td>
    </tr>`).join('')
    || `<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:32px;">Nenhuma transação no período</td></tr>`;
}

// ═══════════════════════════════════════════════════════════
// PRODUTOS
// ═══════════════════════════════════════════════════════════
async function loadProdutos() {
  const s = document.getElementById('search-produtos')?.value || '';
  const rows = await api('GET', `/produtos?q=${encodeURIComponent(s)}`) || [];
  const low = rows.filter(r => Number(r.estoque_atual) <= Number(r.estoque_minimo));
  const alertEl = document.getElementById('alert-estoque');
  if (low.length > 0) {
    alertEl.style.display = 'block';
    alertEl.textContent = `⚠ Atenção: ${low.length} produto(s) com estoque abaixo do mínimo: ${low.map(p=>p.nome).join(', ')}`;
  } else { alertEl.style.display = 'none'; }

  document.getElementById('tb-produtos').innerHTML = rows.length
    ? rows.map(r => {
        const margem = r.preco_venda > 0 ? ((r.preco_venda - r.custo) / r.preco_venda * 100).toFixed(1) : 0;
        const isLow  = Number(r.estoque_atual) <= Number(r.estoque_minimo);
        return `<tr>
          <td><code style="font-size:11px;color:var(--text2);">${r.codigo}</code></td>
          <td>
            <div style="font-weight:500;">${r.nome}</div>
            <div style="font-size:11px;color:var(--text3);">${r.descricao||''}</div>
          </td>
          <td><span class="badge badge-purple">—</span></td>
          <td class="${isLow?'stock-low':'stock-ok'}" style="font-weight:600;">${r.estoque_atual} ${r.unidade} ${isLow?'⚠':''}</td>
          <td style="color:var(--text2);">${r.estoque_minimo}</td>
          <td class="money">${fmt(r.custo)}</td>
          <td class="money money-green">${fmt(r.preco_venda)}</td>
          <td><span class="badge badge-amber">${margem}%</span></td>
          <td style="display:flex;gap:6px;">
            <button class="btn btn-ghost btn-sm" onclick="openModal('produto-edit',${r.id})">Editar</button>
            <button class="btn btn-danger btn-sm" onclick="deleteProduto(${r.id})">✕</button>
          </td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="9" style="text-align:center;color:var(--text3);padding:32px;">Nenhum produto encontrado</td></tr>`;
}

// ═══════════════════════════════════════════════════════════
// MOVIMENTAÇÕES
// ═══════════════════════════════════════════════════════════
function filterMov(type, el) {
  movFilterType = type;
  document.querySelectorAll('#mov-filter .pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  loadMovimentos();
}

async function loadMovimentos() {
  const qs   = movFilterType !== 'todos' ? `?tipo=${movFilterType}` : '';
  const rows = await api('GET', `/movimentos${qs}`) || [];
  const typeBadge = t => t==='entrada'?'badge-green':t==='saida'?'badge-red':'badge-amber';
  document.getElementById('tb-movimentos').innerHTML = rows.length
    ? rows.map(r => {
        const total = r.tipo === 'entrada' ? Number(r.quantidade) * Number(r.custo_unitario) : 0;
        return `<tr>
          <td style="font-size:12px;color:var(--text2);">${fmtDateTime(r.data_hora)}</td>
          <td>
            <div style="font-weight:500;">${r.produto_nome||r.produto_id}</div>
            <div style="font-size:11px;color:var(--text3);">${r.produto_codigo||''}</div>
          </td>
          <td><span class="badge ${typeBadge(r.tipo)}">${r.tipo}</span></td>
          <td style="font-weight:600;color:${r.tipo==='entrada'?'var(--green)':'var(--red)'};">${r.tipo==='saida'?'-':'+'} ${r.quantidade}</td>
          <td class="money">${r.custo_unitario > 0 ? fmt(r.custo_unitario) : '—'}</td>
          <td class="money">${total > 0 ? fmt(total) : '—'}</td>
          <td style="color:var(--text2);">${r.usuario_nome||'—'}</td>
          <td style="color:var(--text2);font-size:12px;">${r.observacao||'—'}</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:32px;">Nenhuma movimentação</td></tr>`;
}

// ═══════════════════════════════════════════════════════════
// CLIENTES
// ═══════════════════════════════════════════════════════════
async function loadClientes() {
  const s    = document.getElementById('search-clientes')?.value || '';
  const rows = await api('GET', `/clientes?q=${encodeURIComponent(s)}`) || [];
  document.getElementById('tb-clientes').innerHTML = rows.length
    ? rows.map(r => `
        <tr>
          <td>
            <div style="font-weight:500;">${r.nome}</div>
            <div style="font-size:11px;color:var(--text3);">${r.cidade||''} ${r.uf?'- '+r.uf:''}</div>
          </td>
          <td style="font-family:monospace;font-size:12px;">${r.cpf_cnpj||'—'}</td>
          <td style="color:var(--accent);">${r.email||'—'}</td>
          <td>${r.telefone||'—'}</td>
          <td>${r.cidade||'—'}</td>
          <td class="money money-green">—</td>
          <td><button class="btn btn-danger btn-sm" onclick="deleteCliente(${r.id})">✕</button></td>
        </tr>`).join('')
    : `<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:32px;">Nenhum cliente encontrado</td></tr>`;
}

// ═══════════════════════════════════════════════════════════
// FORNECEDORES
// ═══════════════════════════════════════════════════════════
async function loadFornecedores() {
  const s    = document.getElementById('search-fornecedores')?.value || '';
  const rows = await api('GET', `/fornecedores?q=${encodeURIComponent(s)}`) || [];
  document.getElementById('tb-fornecedores').innerHTML = rows.length
    ? rows.map(r => `
        <tr>
          <td><div style="font-weight:500;">${r.razao_social}</div></td>
          <td style="font-family:monospace;font-size:12px;">${r.cnpj||'—'}</td>
          <td>${r.contato||'—'}</td>
          <td style="color:var(--accent);">${r.email||'—'}</td>
          <td>${r.telefone||'—'}</td>
          <td class="money money-red">—</td>
          <td><button class="btn btn-danger btn-sm" onclick="deleteFornecedor(${r.id})">✕</button></td>
        </tr>`).join('')
    : `<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:32px;">Nenhum fornecedor</td></tr>`;
}

// ═══════════════════════════════════════════════════════════
// RELATÓRIOS
// ═══════════════════════════════════════════════════════════
async function loadRelatorios() {
  const [dre, tops, audit, despCats, recCats] = await Promise.all([
    api('GET', '/relatorios/dre'),
    api('GET', '/relatorios/top-produtos'),
    api('GET', '/relatorios/audit-log'),
    api('GET', '/dashboard/categorias-despesas'),
    api('GET', '/dashboard/categorias-receitas'),
  ]);

  document.getElementById('rel-dre').innerHTML = `
    <div class="summary-row"><span>Receita Bruta</span><span class="money money-green">${fmt(dre?.receita_bruta||0)}</span></div>
    <div class="summary-row"><span>(-) Despesas Totais</span><span class="money money-red">(${fmt(dre?.despesas_totais||0)})</span></div>
    <div class="summary-total">
      <span>Resultado Líquido</span>
      <span class="money ${(dre?.resultado||0)>=0?'money-green':'money-red'}">${fmt(dre?.resultado||0)}</span>
    </div>
    <div class="summary-row" style="margin-top:12px;">
      <span>Margem Líquida</span>
      <span class="${(dre?.margem||0)>=0?'money-green':'money-red'}">${dre?.margem||0}%</span>
    </div>`;

  document.getElementById('rel-top-produtos').innerHTML = (tops||[]).length
    ? tops.map((p,i) => `
        <div class="summary-row">
          <div><span style="color:var(--text3);font-size:12px;">#${i+1}</span> ${p.nome}</div>
          <div>
            <span class="badge badge-green">+${p.entradas||0}</span>
            <span class="badge badge-red">-${p.saidas||0}</span>
          </div>
        </div>`).join('')
    : '<div class="empty-state"><p>Sem dados de movimentação</p></div>';

  const colors = ['#ef4444','#f59e0b','#8b5cf6','#3b82f6','#10b981','#06b6d4','#ec4899','#84cc16'];

  const ctx1 = document.getElementById('chart-desp-cat').getContext('2d');
  if (chartDespCat) chartDespCat.destroy();
  if ((despCats||[]).length) {
    chartDespCat = new Chart(ctx1, {
      type:'pie',
      data:{labels:despCats.map(c=>c.categoria||'Outras'), datasets:[{
        data:despCats.map(c=>c.total), backgroundColor:colors, borderWidth:0
      }]},
      options:{responsive:true, maintainAspectRatio:false,
        plugins:{legend:{position:'right',labels:{color:'#8b90a0',font:{size:11},boxWidth:12}}}}
    });
  }

  const ctx2 = document.getElementById('chart-rec-cat').getContext('2d');
  if (chartRecCat) chartRecCat.destroy();
  if ((recCats||[]).length) {
    chartRecCat = new Chart(ctx2, {
      type:'pie',
      data:{labels:recCats.map(c=>c.categoria||'Outras'), datasets:[{
        data:recCats.map(c=>c.total), backgroundColor:colors, borderWidth:0
      }]},
      options:{responsive:true, maintainAspectRatio:false,
        plugins:{legend:{position:'right',labels:{color:'#8b90a0',font:{size:11},boxWidth:12}}}}
    });
  }

  document.getElementById('tb-audit').innerHTML = (audit||[]).map(a => `
    <tr>
      <td style="font-size:11px;color:var(--text2);">${fmtDateTime(a.data_hora)}</td>
      <td><span class="badge badge-blue">${a.username||'—'}</span></td>
      <td style="font-weight:500;">${a.acao}</td>
      <td style="color:var(--text2);">${a.tabela||'—'}</td>
      <td style="color:var(--text3);font-size:12px;">${a.detalhe||'—'}</td>
    </tr>`).join('');
}

// ═══════════════════════════════════════════════════════════
// MODALS
// ═══════════════════════════════════════════════════════════
async function openModal(type, id = null) {
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');

  const [clientes, fornecedores, produtos, catsFin] = await Promise.all([
    api('GET', '/clientes'),
    api('GET', '/fornecedores'),
    api('GET', '/produtos'),
    api('GET', '/categorias-financeiro'),
  ]);

  const cliOpts      = (clientes||[]).map(c=>`<option value="${c.id}">${c.nome}</option>`).join('');
  const fornOpts     = (fornecedores||[]).map(f=>`<option value="${f.id}">${f.razao_social}</option>`).join('');
  const prodOpts     = (produtos||[]).map(p=>`<option value="${p.id}" data-estoque="${p.estoque_atual}">[${p.codigo}] ${p.nome} — Estoque: ${p.estoque_atual} ${p.unidade}</option>`).join('');
  const catRecOpts   = (catsFin||[]).filter(c=>c.tipo==='receita').map(c=>`<option value="${c.id}">${c.nome}</option>`).join('');
  const catDespOpts  = (catsFin||[]).filter(c=>c.tipo==='despesa').map(c=>`<option value="${c.id}">${c.nome}</option>`).join('');

  const today = new Date().toISOString().split('T')[0];

  if (type === 'receita') {
    content.innerHTML = `<h3>📈 Nova Receita</h3>
      <div class="form-group"><label>Descrição*</label><input id="m-desc" placeholder="Descrição da receita"/></div>
      <div class="form-row">
        <div class="form-group"><label>Valor (R$)*</label><input id="m-valor" type="number" step="0.01" min="0.01" placeholder="0,00"/></div>
        <div class="form-group"><label>Data*</label><input id="m-data" type="date" value="${today}"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Categoria</label><select id="m-cat"><option value="">Selecione</option>${catRecOpts}</select></div>
        <div class="form-group"><label>Status</label><select id="m-status"><option value="pago">Pago</option><option value="pendente">Pendente</option><option value="cancelado">Cancelado</option></select></div>
      </div>
      <div class="form-group"><label>Cliente</label><select id="m-cli"><option value="">Nenhum</option>${cliOpts}</select></div>
      <div class="form-group"><label>Observação</label><textarea id="m-obs" placeholder="Observações..."></textarea></div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-blue" onclick="saveReceita()">Salvar Receita</button>
      </div>`;

  } else if (type === 'despesa') {
    content.innerHTML = `<h3>📉 Nova Despesa</h3>
      <div class="form-group"><label>Descrição*</label><input id="m-desc" placeholder="Descrição da despesa"/></div>
      <div class="form-row">
        <div class="form-group"><label>Valor (R$)*</label><input id="m-valor" type="number" step="0.01" min="0.01" placeholder="0,00"/></div>
        <div class="form-group"><label>Data*</label><input id="m-data" type="date" value="${today}"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Categoria</label><select id="m-cat"><option value="">Selecione</option>${catDespOpts}</select></div>
        <div class="form-group"><label>Status</label><select id="m-status"><option value="pago">Pago</option><option value="pendente">Pendente</option><option value="cancelado">Cancelado</option></select></div>
      </div>
      <div class="form-group"><label>Fornecedor</label><select id="m-forn"><option value="">Nenhum</option>${fornOpts}</select></div>
      <div class="form-group"><label>Observação</label><textarea id="m-obs" placeholder="Observações..."></textarea></div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-blue" onclick="saveDespesa()">Salvar Despesa</button>
      </div>`;

  } else if (type === 'produto' || type === 'produto-edit') {
    let p = {codigo:'',nome:'',descricao:'',estoque_atual:0,estoque_minimo:0,custo:0,preco_venda:0,unidade:'un'};
    if (type === 'produto-edit' && id) {
      const lista = await api('GET', '/produtos?q=') || [];
      const found = lista.find(x => x.id === id);
      if (found) p = found;
    }
    const isEdit = type === 'produto-edit';
    content.innerHTML = `<h3>📦 ${isEdit?'Editar Produto':'Novo Produto'}</h3>
      <div class="form-row">
        <div class="form-group"><label>Código*</label><input id="m-codigo" value="${p.codigo}" placeholder="PRD001" ${isEdit?'readonly':''}></div>
        <div class="form-group"><label>Unidade</label><select id="m-unidade">
          ${['un','kg','lt','cx','mt','pc'].map(u=>`<option ${p.unidade===u?'selected':''}>${u}</option>`).join('')}
        </select></div>
      </div>
      <div class="form-group"><label>Nome*</label><input id="m-nome" value="${p.nome}" placeholder="Nome do produto"/></div>
      <div class="form-row">
        <div class="form-group"><label>Estoque Mínimo</label><input id="m-estoque-min" type="number" value="${p.estoque_minimo}" min="0"/></div>
        <div class="form-group"><label>Estoque ${isEdit?'Atual (leia-só)':'Inicial'}</label><input id="m-estoque" type="number" value="${p.estoque_atual}" min="0" ${isEdit?'disabled':''}></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Custo (R$)</label><input id="m-custo" type="number" step="0.01" value="${p.custo}" min="0"/></div>
        <div class="form-group"><label>Preço Venda (R$)</label><input id="m-preco" type="number" step="0.01" value="${p.preco_venda}" min="0"/></div>
      </div>
      <div class="form-group"><label>Descrição</label><textarea id="m-desc" placeholder="Detalhes do produto...">${p.descricao||''}</textarea></div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-blue" onclick="saveProduto(${isEdit?id:null})">${isEdit?'Salvar Alterações':'Cadastrar Produto'}</button>
      </div>`;

  } else if (type === 'entrada' || type === 'saida') {
    const isEntrada = type === 'entrada';
    content.innerHTML = `<h3>${isEntrada?'📥 Entrada':'📤 Saída'} de Estoque</h3>
      <div class="form-group"><label>Produto*</label><select id="m-prod" onchange="updateMaxQty(this)">
        <option value="">Selecione um produto</option>${prodOpts}
      </select></div>
      <div class="form-row">
        <div class="form-group"><label>Quantidade*</label><input id="m-qty" type="number" min="0.01" step="0.01" placeholder="0" oninput="calcTotal()"/></div>
        <div class="form-group"><label>${isEntrada?'Custo Unitário (R$)':'Preço Unitário (R$)'}</label><input id="m-custo-unit" type="number" step="0.01" min="0" placeholder="0,00" oninput="calcTotal()"/></div>
      </div>
      ${!isEntrada?`<div id="qty-warning" class="alert alert-warning" style="display:none;">⚠ Quantidade maior que o estoque disponível!</div>`:''}
      <div class="form-group"><label>Total Estimado</label><div id="m-total" style="font-family:monospace;font-size:16px;color:var(--green);padding:8px 0;">R$ 0,00</div></div>
      <div class="form-group"><label>Observação</label><textarea id="m-obs" placeholder="${isEntrada?'Nota fiscal, fornecedor...':'Motivo da saída...'}"></textarea></div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
        <button class="btn ${isEntrada?'btn-success':'btn-danger'}" onclick="saveMovimento('${type}')">Registrar ${isEntrada?'Entrada':'Saída'}</button>
      </div>`;

  } else if (type === 'cliente') {
    content.innerHTML = `<h3>👤 Novo Cliente</h3>
      <div class="form-group"><label>Nome*</label><input id="m-nome" placeholder="Nome completo ou Razão Social"/></div>
      <div class="form-row">
        <div class="form-group"><label>CPF/CNPJ</label><input id="m-cpf" placeholder="000.000.000-00"/></div>
        <div class="form-group"><label>Telefone</label><input id="m-tel" placeholder="(11) 99999-9999"/></div>
      </div>
      <div class="form-group"><label>Email</label><input id="m-email" type="email" placeholder="email@exemplo.com"/></div>
      <div class="form-row">
        <div class="form-group"><label>Cidade</label><input id="m-cidade" placeholder="Cidade"/></div>
        <div class="form-group"><label>UF</label><input id="m-uf" placeholder="SP" maxlength="2"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Endereço</label><input id="m-end" placeholder="Rua, número"/></div>
        <div class="form-group"><label>CEP</label><input id="m-cep" placeholder="00000-000"/></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-blue" onclick="saveCliente()">Cadastrar Cliente</button>
      </div>`;

  } else if (type === 'fornecedor') {
    content.innerHTML = `<h3>🚛 Novo Fornecedor</h3>
      <div class="form-group"><label>Razão Social*</label><input id="m-nome" placeholder="Nome da empresa"/></div>
      <div class="form-row">
        <div class="form-group"><label>CNPJ</label><input id="m-cnpj" placeholder="00.000.000/0001-00"/></div>
        <div class="form-group"><label>Contato</label><input id="m-contato" placeholder="Nome do responsável"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Email</label><input id="m-email" type="email" placeholder="email@empresa.com"/></div>
        <div class="form-group"><label>Telefone</label><input id="m-tel" placeholder="(11) 4444-5555"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Cidade</label><input id="m-cidade" placeholder="Cidade"/></div>
        <div class="form-group"><label>UF</label><input id="m-uf" placeholder="SP" maxlength="2"/></div>
      </div>
      <div class="form-group"><label>Endereço</label><input id="m-end" placeholder="Endereço completo"/></div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-blue" onclick="saveFornecedor()">Cadastrar Fornecedor</button>
      </div>`;
  }

  overlay.classList.add('open');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

function calcTotal() {
  const q = parseFloat(document.getElementById('m-qty')?.value||0);
  const c = parseFloat(document.getElementById('m-custo-unit')?.value||0);
  const t = document.getElementById('m-total');
  if (t) t.textContent = fmt(q*c);
}

function updateMaxQty(sel) {
  const warn    = document.getElementById('qty-warning');
  if (!warn) return;
  const estoque = parseFloat(sel.options[sel.selectedIndex]?.dataset.estoque || 0);
  const qty     = parseFloat(document.getElementById('m-qty')?.value||0);
  warn.style.display = qty > estoque ? 'block' : 'none';
}

// ═══════════════════════════════════════════════════════════
// SAVES
// ═══════════════════════════════════════════════════════════
async function saveReceita() {
  const desc   = document.getElementById('m-desc').value.trim();
  const valor  = parseFloat(document.getElementById('m-valor').value);
  const data   = document.getElementById('m-data').value;
  const cat    = document.getElementById('m-cat').value || null;
  const status = document.getElementById('m-status').value;
  const cli    = document.getElementById('m-cli').value || null;
  const obs    = document.getElementById('m-obs').value;
  if (!desc || !valor || !data) { toast('Preencha os campos obrigatórios.', 'error'); return; }
  try {
    await api('POST', '/transacoes', {
      tipo:'receita', descricao:desc, categoria_id:cat?Number(cat):null,
      valor, data, cliente_id:cli?Number(cli):null, status, observacao:obs
    });
    closeModal(); loadReceitas(); refreshDashboard();
    toast('Receita registrada com sucesso!');
  } catch(e) { toast(e.message, 'error'); }
}

async function saveDespesa() {
  const desc   = document.getElementById('m-desc').value.trim();
  const valor  = parseFloat(document.getElementById('m-valor').value);
  const data   = document.getElementById('m-data').value;
  const cat    = document.getElementById('m-cat').value || null;
  const status = document.getElementById('m-status').value;
  const forn   = document.getElementById('m-forn').value || null;
  const obs    = document.getElementById('m-obs').value;
  if (!desc || !valor || !data) { toast('Preencha os campos obrigatórios.', 'error'); return; }
  try {
    await api('POST', '/transacoes', {
      tipo:'despesa', descricao:desc, categoria_id:cat?Number(cat):null,
      valor, data, fornecedor_id:forn?Number(forn):null, status, observacao:obs
    });
    closeModal(); loadDespesas(); refreshDashboard();
    toast('Despesa registrada com sucesso!');
  } catch(e) { toast(e.message, 'error'); }
}

async function saveProduto(id) {
  const codigo     = document.getElementById('m-codigo').value.trim();
  const nome       = document.getElementById('m-nome').value.trim();
  const desc       = document.getElementById('m-desc').value.trim();
  const estoque    = parseFloat(document.getElementById('m-estoque')?.value||0);
  const estoqueMin = parseFloat(document.getElementById('m-estoque-min').value||0);
  const custo      = parseFloat(document.getElementById('m-custo').value||0);
  const preco      = parseFloat(document.getElementById('m-preco').value||0);
  const unidade    = document.getElementById('m-unidade').value;
  if (!codigo || !nome) { toast('Código e nome são obrigatórios.', 'error'); return; }
  try {
    if (id) {
      await api('PUT', `/produtos/${id}`, {
        codigo, nome, descricao:desc, estoque_atual:estoque,
        estoque_minimo:estoqueMin, custo, preco_venda:preco, unidade
      });
      toast('Produto atualizado!');
    } else {
      await api('POST', '/produtos', {
        codigo, nome, descricao:desc, estoque_atual:estoque,
        estoque_minimo:estoqueMin, custo, preco_venda:preco, unidade
      });
      toast('Produto cadastrado!');
    }
    closeModal(); loadProdutos();
  } catch(e) { toast(e.message, 'error'); }
}

async function saveMovimento(tipo) {
  const pid   = parseInt(document.getElementById('m-prod').value);
  const qty   = parseFloat(document.getElementById('m-qty').value);
  const custo = parseFloat(document.getElementById('m-custo-unit').value||0);
  const obs   = document.getElementById('m-obs').value;
  if (!pid || !qty || qty <= 0) { toast('Selecione produto e quantidade válida.', 'error'); return; }
  try {
    await api('POST', '/movimentos', {
      produto_id:pid, tipo, quantidade:qty, custo_unitario:custo, observacao:obs
    });
    closeModal(); loadMovimentos(); loadProdutos();
    toast(`${tipo === 'entrada' ? 'Entrada' : 'Saída'} registrada!`);
  } catch(e) { toast(e.message, 'error'); }
}

async function saveCliente() {
  const nome = document.getElementById('m-nome').value.trim();
  if (!nome) { toast('Nome é obrigatório.', 'error'); return; }
  try {
    await api('POST', '/clientes', {
      nome,
      cpf_cnpj: document.getElementById('m-cpf').value,
      telefone: document.getElementById('m-tel').value,
      email:    document.getElementById('m-email').value,
      endereco: document.getElementById('m-end').value,
      cidade:   document.getElementById('m-cidade').value,
      uf:       document.getElementById('m-uf').value,
      cep:      document.getElementById('m-cep').value,
    });
    closeModal(); loadClientes();
    toast('Cliente cadastrado!');
  } catch(e) { toast(e.message, 'error'); }
}

async function saveFornecedor() {
  const nome = document.getElementById('m-nome').value.trim();
  if (!nome) { toast('Razão social é obrigatória.', 'error'); return; }
  try {
    await api('POST', '/fornecedores', {
      razao_social: nome,
      cnpj:     document.getElementById('m-cnpj').value,
      contato:  document.getElementById('m-contato').value,
      email:    document.getElementById('m-email').value,
      telefone: document.getElementById('m-tel').value,
      endereco: document.getElementById('m-end').value,
      cidade:   document.getElementById('m-cidade').value,
      uf:       document.getElementById('m-uf').value,
    });
    closeModal(); loadFornecedores();
    toast('Fornecedor cadastrado!');
  } catch(e) { toast(e.message, 'error'); }
}

// ═══════════════════════════════════════════════════════════
// DELETES
// ═══════════════════════════════════════════════════════════
async function deleteTransacao(id, tipo) {
  if (!confirm(`Excluir esta ${tipo}? Esta ação não pode ser desfeita.`)) return;
  try {
    await api('DELETE', `/transacoes/${id}`);
    if (tipo === 'receita') loadReceitas(); else loadDespesas();
    refreshDashboard();
    toast(`${tipo} excluída.`);
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteProduto(id) {
  if (currentUser.role !== 'admin') {
    toast('Apenas administradores podem excluir produtos.', 'error');
    return;
  }
  if (!confirm('Excluir produto? Movimentações serão preservadas.')) return;
  try {
    await api('DELETE', `/produtos/${id}`);
    loadProdutos();
    toast('Produto removido.');
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteCliente(id) {
  if (!confirm('Remover cliente?')) return;
  try {
    await api('DELETE', `/clientes/${id}`);
    loadClientes();
    toast('Cliente removido.');
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteFornecedor(id) {
  if (!confirm('Remover fornecedor?')) return;
  try {
    await api('DELETE', `/fornecedores/${id}`);
    loadFornecedores();
    toast('Fornecedor removido.');
  } catch(e) { toast(e.message, 'error'); }
}