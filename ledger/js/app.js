/*
 * Ledger — demo pública. Estado, vistas y eventos.
 *
 * Aislamiento: el estado vive en memoria y en localStorage de este navegador
 * (clave propia). No hay fetch, ni API, ni base de datos: la demo no sabe que
 * el sistema principal existe.
 */
(function () {
  'use strict';
  const L = window.LedgerLogic;
  const D = window.LedgerData;
  const Charts = window.LedgerCharts;

  const STORE_KEY = 'ledger-demo-state-v1';
  const THEME_KEY = 'ledger-demo-theme';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = (n, o) => L.formatMoney(n, o);
  const today = () => L.ymd(new Date());
  const digits = (v) => {
    const n = parseInt(String(v).replace(/\D/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  };

  /* ─── Estado ───────────────────────────────────────────── */

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.version === 1 && Array.isArray(s.transactions)) return s;
      }
    } catch (e) { /* sin almacenamiento: se usa la semilla */ }
    return D.seed();
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* modo privado */ }
  }

  let state = load();
  const ui = {
    tx: { q: '', type: 'todos', cat: '', month: '', limit: 60 },
    importText: '',
    importRows: null,
    importError: null,
    modal: null,
  };

  const cat = (id) => state.categories.find((c) => c.id === id);
  const account = (id) => state.accounts.find((a) => a.id === id);
  const rulesWithKind = () => state.rules.map((r) => ({ ...r, kind: cat(r.categoryId)?.kind }));
  const sortTx = () => state.transactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));

  /* ─── Datos derivados ──────────────────────────────────── */

  function derive() {
    const td = today();
    const cur = L.monthKey(td);
    const prev = L.shiftMonthKey(cur, -1);
    const tx = state.transactions;
    const inMonth = (mk) => tx.filter((t) => t.date.startsWith(mk));
    const income = (list) => list.reduce((a, t) => a + (t.amount > 0 ? t.amount : 0), 0);
    const expenses = (list) => list.reduce((a, t) => a + (t.amount < 0 ? -t.amount : 0), 0);
    const curTx = inMonth(cur);
    const prevTx = inMonth(prev);
    const month = { income: income(curTx), expenses: expenses(curTx) };
    const prevMonth = { income: income(prevTx), expenses: expenses(prevTx) };

    const accounts = state.accounts.map((a) => ({
      ...a,
      balance: a.initial + tx.filter((t) => t.accountId === a.id).reduce((s, t) => s + t.amount, 0),
    }));
    const netWorth = accounts.reduce((s, a) => s + a.balance, 0);
    const reserved = state.goals.reduce((s, g) => s + g.balance, 0);
    const savings = accounts.find((a) => a.id === 2);

    const cashflow = [];
    for (let back = 5; back >= 0; back--) {
      const mk = L.shiftMonthKey(cur, -back);
      const list = inMonth(mk);
      cashflow.push({ label: L.monthLabel(mk, true), full: L.monthLabel(mk), income: income(list), expenses: expenses(list) });
    }

    const spendByCat = new Map();
    const spentTodayByCat = new Map();
    for (const t of curTx) {
      if (t.amount >= 0) continue;
      spendByCat.set(t.categoryId, (spendByCat.get(t.categoryId) || 0) - t.amount);
      if (t.date === td) spentTodayByCat.set(t.categoryId, (spentTodayByCat.get(t.categoryId) || 0) - t.amount);
    }

    const plan = buildPlan({ cur, curTx, month, spendByCat, spentTodayByCat });
    const daily = L.dailyAllowance(
      plan.lines.filter((l) => l.kind === 'categoria').map((l) => ({ assigned: l.effective, spent: l.spent, spentToday: l.spentToday })),
      td
    );

    return {
      td, cur, month, prevMonth, accounts, netWorth, reserved, savings, cashflow,
      spendByCat, plan, daily, shortcuts: shortcuts(td), alerts: alerts(plan),
    };
  }

  function buildPlan({ cur, curTx, month, spendByCat, spentTodayByCat }) {
    const received = month.income;
    const available = state.plan.incomeOverride ?? received;
    const lines = [];

    for (const c of state.commitments) {
      const label = L.normalizeText(c.label);
      const paid = curTx.some((t) => t.amount < 0 && L.normalizeText(t.description).includes(label));
      lines.push({ key: `compromiso:${c.id}`, label: c.label, tier: c.tier, order: c.day, demand: c.amount, kind: 'compromiso', paid, note: paid ? 'Pagado este mes' : `Vence el día ${c.day}` });
    }

    for (const c of state.categories) {
      if (c.group !== 'esencial' && c.group !== 'opcional') continue;
      const history = [1, 2, 3].map((b) => {
        const mk = L.shiftMonthKey(cur, -b);
        return state.transactions.filter((t) => t.categoryId === c.id && t.amount < 0 && t.date.startsWith(mk)).reduce((s, t) => s - t.amount, 0);
      });
      const med = L.median(history);
      const auto = med > 0 ? L.ceilToStep(med) : c.budget || 0;
      const key = `categoria:${c.id}`;
      const manual = state.plan.manual[key];
      const isManual = manual !== undefined && manual !== null;
      lines.push({
        key, label: c.name, tier: c.group === 'esencial' ? 2 : 6, demand: isManual ? manual : auto, auto, manual: isManual,
        kind: 'categoria', categoryId: c.id, color: c.color,
        spent: spendByCat.get(c.id) || 0, spentToday: spentTodayByCat.get(c.id) || 0,
        note: isManual ? 'Monto manual' : med > 0 ? `Mediana de 3 meses: ${money(med)}` : 'Presupuesto de la categoría',
      });
    }

    for (const g of state.goals) {
      if (g.balance >= g.target) continue;
      // Lo aportado este mes descuenta lo que la meta pide al plan del mes.
      const contributed = g.lastContribution === cur ? g.monthContrib || 0 : 0;
      const m = L.goalMetrics({ balance: g.balance - contributed, target: g.target, deadline: g.deadline, monthly: 0, contributedThisMonth: false, currentMonth: cur });
      lines.push({
        key: `meta:${g.id}`, label: g.name, tier: g.priority === 1 ? 3 : 5, order: g.priority, demand: Math.max(0, m.required - contributed), kind: 'meta', goalId: g.id,
        note: contributed ? `Ya aportaste ${money(contributed)} de ${money(m.required)} este mes` : `Requerido para llegar en ${m.periodsLeft} ${m.periodsLeft === 1 ? 'mes' : 'meses'}`,
      });
    }

    const result = L.allocatePlan(available, lines);
    const confirmed = state.plan.confirmed && state.plan.confirmed.month === cur ? state.plan.confirmed : null;
    result.lines.forEach((l) => {
      l.effective = confirmed && confirmed.lines[l.key] !== undefined ? confirmed.lines[l.key] : l.assigned;
    });
    const assignedTotal = result.lines.reduce((s, l) => s + l.assigned, 0);
    const effectiveUnassigned = confirmed ? confirmed.available - Object.values(confirmed.lines).reduce((s, v) => s + v, 0) : result.unassigned;
    const dirty = !!confirmed && (confirmed.available !== available || result.lines.some((l) => confirmed.lines[l.key] !== l.assigned));
    return { ...result, received, assignedTotal, confirmed, dirty, effectiveUnassigned };
  }

  function alerts(plan) {
    const out = [];
    const essential = plan.lines.filter((l) => l.tier <= 2).reduce((s, l) => s + l.demand, 0);
    if (plan.available < essential) {
      out.push({ level: 'critica', tag: 'Déficit esencial', text: `Lo disponible no cubre compromisos y gastos esenciales: faltan ${money(essential - plan.available)}.` });
    }
    for (const l of plan.lines) {
      if (l.shortfall <= 0) continue;
      if (l.kind === 'meta') out.push({ level: 'alta', tag: 'Meta en riesgo', text: `${l.label}: el plan aporta ${money(l.assigned)} de ${money(l.demand)} requeridos; no llegaría en plazo.` });
      else if (l.tier > 2) out.push({ level: 'media', tag: 'Recortado', text: `${l.label}: recibe ${money(l.assigned)} de ${money(l.demand)} (nivel N${l.tier}).` });
    }
    for (const l of plan.lines) {
      if (l.kind === 'categoria' && l.shortfall <= 0 && l.spent > l.effective) {
        out.push({ level: 'media', tag: 'Sobregasto', text: `${l.label}: llevas ${money(l.spent)} de ${money(l.effective)} asignados este mes.` });
      }
    }
    if (!out.length) out.push({ level: 'info', tag: 'Al día', text: `Todo el plan está financiado y quedan ${money(plan.unassigned)} sin asignar.` });
    return out;
  }

  /** Atajos: gastos que se repiten al menos tres veces en los últimos 90 días. */
  function shortcuts(td) {
    const since = new Date();
    since.setDate(since.getDate() - 90);
    const from = L.ymd(since);
    const groups = new Map();
    for (const t of state.transactions) {
      if (t.amount >= 0 || t.date < from || t.date > td) continue;
      if (cat(t.categoryId)?.group === 'compromiso') continue;
      const k = L.normalizeText(t.description);
      const g = groups.get(k) || { description: t.description, categoryId: t.categoryId, amounts: [], count: 0 };
      g.count++;
      g.amounts.push(-t.amount);
      groups.set(k, g);
    }
    return [...groups.values()]
      .filter((g) => g.count >= 3)
      .sort((a, b) => b.count - a.count || a.description.localeCompare(b.description))
      .slice(0, 4)
      .map((g) => ({ ...g, amount: Math.round(L.median(g.amounts) / 100) * 100 }));
  }

  /* ─── Piezas de interfaz ───────────────────────────────── */

  const sectionLabel = (title, right = '') => `<div class="section-label"><h2>${title}</h2>${right ? `<span class="eyebrow">${right}</span>` : ''}</div>`;

  function pageHead(title, sub, actions = '') {
    return `<header class="page-head"><div><h1 class="page-title">${title}</h1><div class="page-sub">${sub}</div></div><div class="head-actions">${actions}</div></header>`;
  }

  const newTxBtn = `<button class="btn btn-accent" data-action="new-tx"><span aria-hidden="true">+</span> Movimiento</button>`;

  function kpi(label, value, sub, trend, good, extra = '', delay = 0) {
    const arrow = trend ? `<span aria-hidden="true" class="${good === null ? '' : good ? 'good' : 'danger'}">${trend === 'up' ? '↗' : '↘'}</span>` : '';
    return `<div class="kpi" style="animation-delay:${delay}s"><div class="eyebrow">${label}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${arrow}<span>${sub}</span></div>${extra}</div>`;
  }

  function txRow(t, { showDate = true } = {}) {
    const c = cat(t.categoryId);
    const label = showDate ? L.dateLabel(t.date) : account(t.accountId)?.name || '';
    return `<div class="tx-row">
      <button class="tx-name" data-action="edit-tx" data-id="${t.id}" title="Editar">${esc(t.description)}</button>
      <span class="tx-cat"><i style="background:${c?.color}"></i>${esc(c?.name || 'Sin categoría')}</span>
      <span class="tx-date">${esc(label)}</span>
      <span class="tx-amount ${t.amount > 0 ? 'in' : ''}">${money(t.amount, { signed: true })}</span>
      <button class="tx-del" data-action="del-tx" data-id="${t.id}" aria-label="Eliminar ${esc(t.description)}">×</button>
    </div>`;
  }

  function alertList(list) {
    return `<div class="alerts">${list.map((a) => `<div class="alert" data-level="${a.level}"><span class="tag">${a.tag}</span><span>${esc(a.text)}</span></div>`).join('')}</div>`;
  }

  /* ─── Vista: Inicio ────────────────────────────────────── */

  function viewInicio(d) {
    const net = d.month.income - d.month.expenses;
    const pct = (a, b) => (b === 0 ? null : ((a - b) / b) * 100);
    const incPct = pct(d.month.income, d.prevMonth.income);
    const expPct = pct(d.month.expenses, d.prevMonth.expenses);
    const vs = (p) => (p === null ? 'sin datos previos' : `${p >= 0 ? '+ ' : '− '}${Math.abs(p).toFixed(1).replace('.', ',')} % vs. mes anterior`);
    const savingsRate = d.month.income > 0 ? Math.round((net / d.month.income) * 100) : 0;

    const netDetails = `<details style="margin-top:10px;font-size:12px;color:var(--muted)"><summary style="cursor:pointer">Ver desglose</summary>
      <dl class="dl" style="margin-top:8px;grid-template-columns:1fr auto">
        ${d.accounts.map((a) => `<dt>${esc(a.name)}</dt><dd class="num">${money(a.balance)}</dd>`).join('')}
        <dt>Reservado en metas</dt><dd class="num">${money(d.reserved)}</dd>
      </dl></details>`;

    const kpis = `<section class="kpi-grid" aria-label="Indicadores del mes">
      ${kpi('Patrimonio', money(d.netWorth), `${net >= 0 ? '+ ' : '− '}${money(Math.abs(net))} este mes`, net >= 0 ? 'up' : 'down', net >= 0, netDetails, 0.05)}
      ${kpi('Ingresos', money(d.month.income), vs(incPct), incPct === null ? null : incPct >= 0 ? 'up' : 'down', incPct === null ? null : incPct >= 0, '', 0.1)}
      ${kpi('Gastos', money(d.month.expenses), vs(expPct), expPct === null ? null : expPct <= 0 ? 'down' : 'up', expPct === null ? null : expPct <= 0, '', 0.15)}
      ${kpi('Sin asignar', money(d.plan.effectiveUnassigned), `${d.plan.confirmed ? 'plan confirmado' : 'plan sugerido'} · ${savingsRate} % ahorro`, null, null, '', 0.2)}
    </section>`;

    let allowance = '';
    if (d.daily) {
      const a = d.daily;
      const over = a.leftToday < 0;
      const exhausted = a.leftMonth <= 0;
      const headline = exhausted ? 'Ya usaste todo el presupuesto de categorías del mes'
        : over ? `Hoy te pasaste en <span class="nowrap">${money(-a.leftToday)}</span>`
          : `Hoy puedes gastar <span class="nowrap">${money(a.leftToday)}</span>`;
      allowance = `<section class="allowance ${over || exhausted ? 'over' : ''}" aria-label="Cuánto puedes gastar hoy" aria-live="polite">
        <div><div class="headline">${headline}</div>
          <div class="muted" style="font-size:13px;margin-top:8px">${exhausted ? `Te pasaste en ${money(-a.leftMonth)} entre todas las categorías.` : `Monto del día ${money(a.perDay)} · llevas ${money(a.spentToday)} hoy`}</div></div>
        <dl class="dl">
          <dt>Queda del mes</dt><dd class="num ${exhausted ? 'danger' : ''}">${money(a.leftMonth)}</dd>
          <dt>Para</dt><dd>${a.daysLeft === 1 ? 'hoy, último día del mes' : `${a.daysLeft} días, contando hoy`}</dd>
          <dt>${d.plan.confirmed ? 'Asignado' : 'Sugerido'} a categorías</dt><dd class="num"><a href="#/plan" style="color:inherit">${money(a.budget)}</a></dd>
        </dl></section>`;
    }

    const chips = d.shortcuts.length ? `<div class="shortcuts" aria-label="Gastos frecuentes"><span class="eyebrow" style="margin-right:8px">Frecuentes</span>
      ${d.shortcuts.map((s, i) => `<button class="chip" data-action="shortcut" data-i="${i}">${esc(s.description)} <span class="num">${money(s.amount)}</span></button>`).join('')}</div>` : '';

    const cats = [...d.spendByCat.entries()].map(([id, value]) => ({ c: cat(id), value })).filter((x) => x.c).sort((a, b) => b.value - a.value);
    const totalSpend = cats.reduce((s, x) => s + x.value, 0);
    const planLine = (id) => d.plan.lines.find((l) => l.categoryId === id);
    const catList = cats.map((x, i) => {
      const l = planLine(x.c.id);
      const pctOf = l && l.effective > 0 ? Math.min(100, (x.value / l.effective) * 100) : 0;
      const over = l && x.value > l.effective;
      return `<li class="cat-item" data-cat-i="${i}">
        <div class="top"><span><i style="background:${x.c.color}"></i>${esc(x.c.name)}</span><span class="num">${money(x.value)}</span></div>
        ${l ? `<div class="bar" title="${money(x.value)} de ${money(l.effective)}"><span style="width:${pctOf}%;background:${over ? 'var(--danger-ink)' : x.c.color}"></span></div>
        <div class="muted" style="font-size:11px;margin-top:4px">${over ? `<span class="danger">Sobre lo asignado en ${money(x.value - l.effective)}</span>` : `de ${money(l.effective)} asignados`}</div>` : '<div class="muted" style="font-size:11px;margin-top:4px">compromisos fijos</div>'}
      </li>`;
    }).join('');

    const goals = state.goals.map((g) => {
      const p = Math.min(100, Math.floor((g.balance * 100) / g.target));
      return `<div class="mini-goal"><div class="top"><span>${esc(g.name)}</span><span class="num muted">${p} %</span></div>
        <div class="progress" style="height:4px"><span style="width:${p}%;background:${g.color}"></span></div>
        <div class="muted" style="font-size:11px;margin-top:6px">${money(g.balance)} de ${money(g.target)}</div></div>`;
    }).join('');

    const recent = state.transactions.slice(0, 8);
    const sub = `Finanzas personales · ${L.monthLabel(d.cur)}`;
    return `${pageHead('Ledger<span class="accent-dot">.</span>', sub, newTxBtn)}
      ${kpis}
      ${allowance}
      ${chips}
      ${alertList(d.alerts.slice(0, 3))}
      <div class="main-grid">
        <div>
          <section class="section fade-up" style="animation-delay:.2s">
            ${sectionLabel('Flujo de caja', '<a class="btn btn-sm" href="#/movimientos">Movimientos</a>')}
            <div class="legend"><span><i style="background:var(--green)"></i>Ingresos</span><span><i style="background:var(--terracotta)"></i>Gastos</span></div>
            <div class="chart-wrap" id="area" style="height:260px"></div>
          </section>
          <section class="section fade-up" style="animation-delay:.25s">
            ${sectionLabel('Movimientos recientes', `${state.transactions.length} registrados`)}
            <div class="tx-list">${recent.map((t) => txRow(t)).join('') || '<div class="empty">Sin movimientos.</div>'}</div>
          </section>
        </div>
        <div>
          <section class="section fade-up" style="animation-delay:.3s">
            ${sectionLabel('Gasto por categoría', 'este mes')}
            ${cats.length ? `<div class="donut-box" id="donut">${Charts.donutSvg(cats.map((x) => ({ value: x.value, color: x.c.color })), null)}
              <div class="donut-center"><div class="eyebrow" style="font-size:10px">Total</div><div class="num" style="font-size:20px;margin-top:6px">${money(totalSpend)}</div></div></div>
              <ul class="cat-list">${catList}</ul>` : '<div class="empty">Sin gastos registrados este mes.</div>'}
          </section>
          <section class="section fade-up" style="animation-delay:.35s">
            ${sectionLabel('Metas', '<a class="btn btn-sm" href="#/metas">Ver metas</a>')}
            <div style="border-top:1px solid var(--hairline)">${goals}</div>
          </section>
        </div>
      </div>`;
  }

  /* ─── Vista: Movimientos ───────────────────────────────── */

  function filteredTx() {
    const f = ui.tx;
    const q = L.normalizeText(f.q);
    return state.transactions.filter((t) =>
      (f.type === 'todos' || (f.type === 'gastos' ? t.amount < 0 : t.amount > 0)) &&
      (!f.cat || t.categoryId === Number(f.cat)) &&
      (!f.month || t.date.startsWith(f.month)) &&
      (!q || L.normalizeText(t.description).includes(q))
    );
  }

  function txResults() {
    const list = filteredTx();
    const inc = list.reduce((s, t) => s + (t.amount > 0 ? t.amount : 0), 0);
    const exp = list.reduce((s, t) => s + (t.amount < 0 ? -t.amount : 0), 0);
    const shown = list.slice(0, ui.tx.limit);
    let html = '';
    let lastDate = null;
    for (const t of shown) {
      if (t.date !== lastDate) {
        const dayNet = list.filter((x) => x.date === t.date).reduce((s, x) => s + x.amount, 0);
        html += `<div class="day-head"><span>${t.date === today() ? 'Hoy · ' : ''}${L.dateLabel(t.date)}</span><span class="num">${money(dayNet, { signed: true })}</span></div>`;
        lastDate = t.date;
      }
      html += txRow(t, { showDate: false });
    }
    return `<div class="totals" aria-live="polite"><span>${list.length} movimientos</span><span>Ingresos <span class="num">${money(inc)}</span></span><span>Gastos <span class="num">${money(exp)}</span></span><span>Neto <span class="num ${inc - exp < 0 ? 'danger' : ''}">${money(inc - exp, { signed: true })}</span></span></div>
      <div class="tx-list">${html || '<div class="empty">Ningún movimiento coincide con los filtros.</div>'}</div>
      ${list.length > shown.length ? `<div style="text-align:center;margin-top:24px"><button class="btn" data-action="more-tx">Mostrar más (${list.length - shown.length})</button></div>` : ''}`;
  }

  function viewMovimientos(d) {
    const months = [0, 1, 2, 3, 4, 5].map((b) => L.shiftMonthKey(d.cur, -b));
    const f = ui.tx;
    const opt = (v, label, sel) => `<option value="${v}" ${String(sel) === String(v) ? 'selected' : ''}>${esc(label)}</option>`;
    return `${pageHead('Movimientos', 'Registro, búsqueda y edición', newTxBtn)}
      <div class="filters">
        <label><span class="field-label">Buscar</span><input type="search" data-filter="q" value="${esc(f.q)}" placeholder="Descripción, p. ej. farmacia"></label>
        <label><span class="field-label">Tipo</span><select data-filter="type">${opt('todos', 'Todos', f.type)}${opt('gastos', 'Gastos', f.type)}${opt('ingresos', 'Ingresos', f.type)}</select></label>
        <label><span class="field-label">Categoría</span><select data-filter="cat">${opt('', 'Todas', f.cat)}${state.categories.map((c) => opt(c.id, c.name, f.cat)).join('')}</select></label>
        <label><span class="field-label">Mes</span><select data-filter="month">${opt('', 'Últimos 6 meses', f.month)}${months.map((m) => opt(m, L.monthLabel(m), f.month)).join('')}</select></label>
      </div>
      <div id="tx-results">${txResults()}</div>`;
  }

  /* ─── Vista: Plan ──────────────────────────────────────── */

  function planResults(d) {
    const p = d.plan;
    const tiers = [1, 2, 3, 4, 5, 6].map((tier) => {
      const lines = p.lines.filter((l) => l.tier === tier);
      if (!lines.length) return '';
      const info = L.TIER_INFO[tier];
      const demand = lines.reduce((s, l) => s + l.demand, 0);
      const assigned = lines.reduce((s, l) => s + l.assigned, 0);
      const rows = lines.map((l) => {
        const fill = l.demand > 0 ? Math.min(100, (l.assigned / l.demand) * 100) : 100;
        const marker = l.kind === 'categoria' && l.assigned > 0 ? `<b style="left:${Math.min(100, (l.spent / l.assigned) * 100)}%" title="Gastado: ${money(l.spent)}"></b>` : '';
        const pill = l.kind === 'compromiso' && l.paid ? '<span class="pill ok">Pagado</span>'
          : l.kind === 'categoria' && l.spent > l.assigned ? '<span class="pill warn">Sobregasto</span>' : '';
        const demandCell = l.kind === 'categoria'
          ? `<label class="sr-only" for="pl-${l.key}">Monto para ${esc(l.label)}</label>
             <input id="pl-${l.key}" class="num" inputmode="numeric" data-plan-line="${l.key}" value="${L.formatAmount(l.demand)}">
             ${l.manual ? `<button class="btn-link" data-action="plan-auto" data-key="${l.key}" style="font-size:11px">volver a ${money(l.auto)}</button>` : ''}`
          : `<span class="num muted">${money(l.demand)}</span>`;
        return `<div class="line">
          <div><div>${esc(l.label)} ${pill}</div><div class="note">${esc(l.note)}${l.kind === 'categoria' ? ` · gastado ${money(l.spent)}` : ''}</div></div>
          <div class="meter"><span style="width:${fill}%;background:${l.shortfall > 0 ? 'var(--danger-ink)' : 'var(--green)'}"></span>${marker}</div>
          <div class="amt">${demandCell}</div>
          <div class="amt num ${l.shortfall > 0 ? 'danger' : ''}">${money(l.assigned)}${l.shortfall > 0 ? `<div class="note danger">faltan ${money(l.shortfall)}</div>` : ''}</div>
        </div>`;
      }).join('');
      return `<section class="tier" aria-label="Nivel ${tier}">
        <div class="tier-head"><h3><span class="badge">N${tier}</span>${info.name}</h3>
          <span class="eyebrow">${info.strategy} · ${money(assigned)} de ${money(demand)}</span></div>
        ${rows}</section>`;
    }).join('');

    return `<div class="plan-summary">
        <div><span class="eyebrow">Disponible</span><span class="num">${money(p.available)}</span></div>
        <div><span class="eyebrow">Demanda total</span><span class="num">${money(p.demandTotal)}</span></div>
        <div><span class="eyebrow">Asignado</span><span class="num">${money(p.assignedTotal)}</span></div>
        <div><span class="eyebrow">N7 · Sin asignar</span><span class="num ${p.unassigned > 0 ? 'good' : ''}">${money(p.unassigned)}</span></div>
      </div>
      ${alertList(d.alerts)}
      <div class="line line-head" style="border-bottom:1px solid var(--hairline)" aria-hidden="true">
        <span class="eyebrow">Línea</span><span class="eyebrow">Cobertura · marca = gastado</span><span class="eyebrow amt">Pide</span><span class="eyebrow amt">Recibe</span>
      </div>
      ${tiers}`;
  }

  function viewPlan(d) {
    const p = d.plan;
    const max = Math.max(2500000, p.received * 1.6);
    const status = p.confirmed ? (p.dirty ? 'Confirmado · hay cambios sin confirmar' : `Confirmado el ${L.dateLabel(p.confirmed.at)}`) : 'Plan sugerido, sin confirmar';
    return `${pageHead('Plan del mes', `${L.monthLabel(d.cur)} · <span id="plan-status">${status}</span>`, `<button class="btn btn-primary" data-action="confirm-plan">Confirmar plan</button>`)}
      <p class="muted" style="max-width:720px;font-size:14px;line-height:1.6;margin:-24px 0 32px">
        El motor reparte lo disponible por prioridad: primero compromisos y gastos esenciales, después metas y opcionales.
        Si no alcanza, los niveles secuenciales cubren línea por línea y los proporcionales reparten según lo que pide cada línea.
        Mueve el ingreso o edita el monto de una categoría y mira cómo se reacomoda todo.</p>
      <div class="plan-controls">
        <div class="card">
          <label for="income-range" class="field-label">Ingreso del mes (simulación)</label>
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin:8px 0 14px">
            <span class="num" id="income-out" style="font-size:28px">${money(p.available)}</span>
            <span class="muted" style="font-size:12px">recibido real ${money(p.received)}</span>
          </div>
          <input type="range" id="income-range" min="0" max="${Math.round(max / 10000) * 10000}" step="10000" value="${p.available}" aria-valuetext="${money(p.available)}">
        </div>
        <div>
          <span class="field-label">¿Qué pasa si…?</span>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
            <button class="btn btn-sm" data-action="scenario" data-v="0.7">Bajan los ingresos 30 %</button>
            <button class="btn btn-sm" data-action="scenario" data-v="bonus">Llega un bono de $ 300.000</button>
            <button class="btn btn-sm" data-action="scenario" data-v="real">Ingreso real</button>
          </div>
        </div>
      </div>
      <div id="plan-results">${planResults(d)}</div>`;
  }

  /* ─── Vista: Metas ─────────────────────────────────────── */

  function simText(g, monthly, cur) {
    const m = L.goalMetrics({ balance: g.balance, target: g.target, deadline: g.deadline, monthly, contributedThisMonth: g.lastContribution === cur, currentMonth: cur });
    if (m.remaining <= 0) return 'Meta cumplida.';
    if (!m.estimatedMonth) return 'Sin aporte mensual no hay fecha estimada.';
    const late = L.monthsBetween(g.deadline.slice(0, 7), m.estimatedMonth);
    const when = `Llegas en <strong>${L.monthLabel(m.estimatedMonth)}</strong>`;
    return late > 0 ? `${when} · <span class="danger">${late} ${late === 1 ? 'mes' : 'meses'} después del plazo</span>` : `${when} · <span class="good">a tiempo</span>`;
  }

  function viewMetas(d) {
    const free = d.savings.balance - d.reserved;
    const cards = state.goals.map((g, idx) => {
      const line = d.plan.lines.find((l) => l.goalId === g.id);
      const planMonthly = line ? line.effective : 0;
      const m = L.goalMetrics({ balance: g.balance, target: g.target, deadline: g.deadline, monthly: planMonthly, contributedThisMonth: g.lastContribution === d.cur, currentMonth: d.cur });
      const done = m.remaining <= 0;
      const riskPill = done ? '<span class="pill ok">Cumplida</span>' : m.risk === 'vencida' ? '<span class="pill warn">Vencida</span>' : m.risk === 'en_riesgo' ? '<span class="pill warn">En riesgo</span>' : '<span class="pill ok">En plazo</span>';
      const simDefault = planMonthly || m.required;
      const simMax = Math.max(100000, Math.ceil((m.required * 2.5) / 10000) * 10000);
      return `<article class="goal-card" style="animation-delay:${idx * 0.06}s">
        <div class="goal-top"><div><h3>${esc(g.name)}</h3><div class="muted" style="font-size:12px;margin-top:6px">Prioridad P${g.priority} · nivel N${g.priority === 1 ? 3 : 5} del plan</div></div>${riskPill}</div>
        <div><div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:4px 12px;margin-bottom:10px"><span class="num" style="font-size:24px">${money(g.balance)}</span><span class="muted num" style="font-size:13px">de ${money(g.target)} · ${m.progressPct} %</span></div>
          <div class="progress"><span style="width:${m.progressPct}%;background:${g.color}"></span></div></div>
        <div class="goal-stats">
          <div><div class="eyebrow">Faltante</div><span class="num">${money(m.remaining)}</span></div>
          <div><div class="eyebrow">Requerido/mes</div><span class="num">${money(m.required)}</span></div>
          <div><div class="eyebrow">Plazo</div><span class="num" style="font-family:var(--font-sans)">${L.monthLabel(g.deadline.slice(0, 7))}</span></div>
        </div>
        ${done ? '' : `<div class="sim">
          <div class="sim-row"><span class="muted">El plan aporta este mes</span><span class="num">${money(planMonthly)}</span></div>
          <label class="field-label" for="sim-${g.id}" style="margin-top:12px">Simular aporte mensual: <span class="num" data-sim-val="${g.id}">${money(simDefault)}</span></label>
          <input type="range" id="sim-${g.id}" data-sim="${g.id}" min="0" max="${simMax}" step="5000" value="${simDefault}">
          <div data-sim-out="${g.id}" style="margin-top:8px">${simText(g, simDefault, d.cur)}</div>
        </div>`}
        <div class="goal-actions">${done ? '' : `<button class="btn btn-sm" data-action="contribute" data-id="${g.id}">Aportar</button>`}
          ${g.balance > 0 ? `<button class="btn btn-sm" data-action="withdraw" data-id="${g.id}">Liberar</button>` : ''}</div>
      </article>`;
    }).join('');
    return `${pageHead('Metas de ahorro', `Reservado ${money(d.reserved)} · libre en Cuenta de ahorro ${money(free)}`, '<button class="btn btn-accent" data-action="new-goal"><span aria-hidden="true">+</span> Nueva meta</button>')}
      <p class="muted" style="max-width:720px;font-size:14px;line-height:1.6;margin:-24px 0 32px">
        Un aporte es una reserva, no un gasto: el dinero sigue en la cuenta de ahorro, apartado para la meta. Lo reservado nunca puede superar el saldo de la cuenta.
        El aporte requerido entra solo al plan del mes según la prioridad de cada meta.</p>
      <div class="goal-grid">${cards}</div>`;
  }

  /* ─── Vista: Importar ──────────────────────────────────── */

  function importPreview() {
    if (ui.importError) return `<div class="alert" data-level="critica" style="margin-top:24px"><span class="tag">Error</span><span>${esc(ui.importError)}</span></div>`;
    const rows = ui.importRows;
    if (!rows) return '';
    const ok = rows.filter((r) => r.include);
    const missing = ok.filter((r) => !r.categoryId).length;
    const dups = rows.filter((r) => r.duplicate).length;
    const bad = rows.filter((r) => r.problems.length).length;
    const body = rows.map((r, i) => {
      const kind = (r.amount || 0) > 0 ? 'income' : 'expense';
      const why = r.problems.length ? `<span class="danger">${r.problems.join(', ')}</span>`
        : r.duplicate ? 'posible duplicado: ya existe'
          : r.rulePattern ? `regla «${esc(r.rulePattern)}»` : r.categoryId ? 'elegida a mano' : '<span class="danger">elige categoría</span>';
      return `<tr class="${r.duplicate || r.problems.length ? 'dup' : ''}">
        <td><input type="checkbox" data-imp-inc="${i}" ${r.include ? 'checked' : ''} ${r.problems.length ? 'disabled' : ''} aria-label="Incluir fila ${r.line}"></td>
        <td class="num" style="text-align:left">${r.date ? L.dateLabel(r.date) : '—'}</td>
        <td>${esc(r.description)}<div class="why">${why}</div></td>
        <td class="num ${(r.amount || 0) > 0 ? 'good' : ''}">${r.amount ? money(r.amount, { signed: true }) : '—'}</td>
        <td>${r.problems.length ? '' : `<select data-imp-cat="${i}" aria-label="Categoría de la fila ${r.line}"><option value="">Elige…</option>${state.categories.filter((c) => c.kind === kind).map((c) => `<option value="${c.id}" ${r.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`}</td>
      </tr>`;
    }).join('');
    return `<div style="margin-top:32px">
      ${sectionLabel('Vista previa', `${ok.length} listas · ${dups} duplicadas · ${bad} con error`)}
      <div class="table-scroll"><table class="preview"><thead><tr><th></th><th>Fecha</th><th>Descripción</th><th style="text-align:right">Monto</th><th>Categoría</th></tr></thead><tbody>${body}</tbody></table></div>
      <div style="display:flex;justify-content:flex-end;align-items:center;gap:16px;margin-top:20px;flex-wrap:wrap">
        ${missing ? `<span class="danger" style="font-size:13px">Falta la categoría en ${missing} ${missing === 1 ? 'fila' : 'filas'}</span>` : ''}
        <button class="btn" data-action="import-cancel">Descartar</button>
        <button class="btn btn-primary" data-action="import-confirm" ${!ok.length || missing ? 'disabled' : ''}>Importar ${ok.length} ${ok.length === 1 ? 'movimiento' : 'movimientos'}</button>
      </div></div>`;
  }

  function viewImportar() {
    const rules = state.rules.map((r, i) => `<div class="rule-row"><span>contiene «<strong>${esc(r.pattern)}</strong>»</span><span class="muted">→ ${esc(cat(r.categoryId)?.name || '—')}</span>
      <button class="tx-del" style="opacity:1" data-action="del-rule" data-i="${i}" aria-label="Eliminar regla ${esc(r.pattern)}">×</button></div>`).join('');
    return `${pageHead('Importar cartola', 'CSV del banco · se procesa solo en este navegador')}
      <div class="import-grid">
        <section>
          <div class="steps muted" style="font-size:13px"><span>1. Pega o sube el CSV</span><span>2. Revisa categorías y duplicados</span><span>3. Importa</span></div>
          <label class="field-label" for="imp-text">Contenido de la cartola</label>
          <textarea id="imp-text" rows="10" placeholder="Fecha;Descripción;Cargo;Abono">${esc(ui.importText)}</textarea>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px">
            <button class="btn" data-action="import-sample">Cargar cartola de ejemplo</button>
            <label class="btn" style="cursor:pointer">Subir CSV<input type="file" id="imp-file" accept=".csv,.txt,text/csv" class="sr-only"></label>
            <button class="btn btn-primary" data-action="import-parse">Analizar</button>
          </div>
          <div class="field-hint">Acepta separador ; , o tabulador, fechas DD/MM/AAAA o AAAA-MM-DD, montos chilenos (1.234.567) y columnas Monto o Cargo/Abono.</div>
          <div id="imp-preview">${importPreview()}</div>
        </section>
        <aside>
          ${sectionLabel('Reglas de categoría')}
          <p class="muted" style="font-size:13px;line-height:1.6;margin-top:-12px">Si la descripción contiene el texto, se sugiere la categoría. Se compara sin mayúsculas ni tildes y gana la primera regla. También se usan al registrar un movimiento a mano.</p>
          <div style="border-top:1px solid var(--hairline)">${rules}</div>
          <form class="rule-form" data-form="rule" novalidate>
            <label><span class="field-label">Si contiene</span><input name="pattern" maxlength="60" placeholder="p. ej. panaderia" autocomplete="off"></label>
            <label><span class="field-label">Categoría</span><select name="categoryId">${state.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
            <button class="btn btn-sm" type="submit">Agregar</button>
          </form>
          <div class="field-error" data-err="rule"></div>
        </aside>
      </div>`;
  }

  /* ─── Render y navegación ──────────────────────────────── */

  const ROUTES = { inicio: viewInicio, movimientos: viewMovimientos, plan: viewPlan, metas: viewMetas, importar: viewImportar };
  const route = () => {
    const r = (location.hash.replace(/^#\/?/, '') || 'inicio').split('?')[0];
    return ROUTES[r] ? r : 'inicio';
  };

  let current = null;
  function render({ keepScroll = false } = {}) {
    const r = route();
    const d = derive();
    const y = window.scrollY;
    $('#view').innerHTML = `<div class="pad"><div class="wrap">${ROUTES[r](d)}
      <footer class="page-foot"><span>Demo de portafolio · datos ficticios · ${state.transactions.length} movimientos en este navegador</span><span class="display" style="font-style:italic">Ledger — un libro, una vida</span></footer></div></div>`;
    $$('[data-nav]').forEach((a) => (a.dataset.nav === r ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    if (r === 'inicio') drawArea(d);
    if (r !== current) {
      document.title = `${r === 'inicio' ? 'Inicio' : r[0].toUpperCase() + r.slice(1)} · Ledger demo`;
      window.scrollTo(0, 0);
      if (current !== null) $('#view').focus({ preventScroll: true });
      current = r;
    } else if (keepScroll) window.scrollTo(0, y);
  }

  function drawArea(d = derive()) {
    const el = $('#area');
    if (el) Charts.areaChart(el, d.cashflow, 260);
  }

  function refreshPlan() {
    const d = derive();
    const box = $('#plan-results');
    if (!box) return;
    box.innerHTML = planResults(d);
    $('#income-out').textContent = money(d.plan.available);
    $('#income-range').setAttribute('aria-valuetext', money(d.plan.available));
    const st = $('#plan-status');
    if (st) st.textContent = d.plan.confirmed ? (d.plan.dirty ? 'Confirmado · hay cambios sin confirmar' : `Confirmado el ${L.dateLabel(d.plan.confirmed.at)}`) : 'Plan sugerido, sin confirmar';
  }

  /* ─── Toasts ───────────────────────────────────────────── */

  function toast(text, action) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.innerHTML = `<span>${esc(text)}</span>`;
    if (action) {
      const b = document.createElement('button');
      b.textContent = action.label;
      b.addEventListener('click', () => { action.fn(); el.remove(); });
      el.appendChild(b);
    }
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 6000);
  }

  /* ─── Modales ──────────────────────────────────────────── */

  const dialog = () => $('#modal');
  function openModal(html, state_) {
    ui.modal = state_;
    const dlg = dialog();
    dlg.innerHTML = html;
    if (!dlg.open) dlg.showModal();
    const first = dlg.querySelector('input:not([type=hidden]), select');
    if (first) first.focus();
  }
  const closeModal = () => { if (dialog().open) dialog().close(); };
  const modalHead = (title) => `<div class="modal-head"><h2>${title}</h2><button type="button" class="modal-close" data-action="close-modal" aria-label="Cerrar">×</button></div>`;
  const setErr = (form, name, msg) => { const e = form.querySelector(`[data-err="${name}"]`); if (e) e.textContent = msg || ''; };

  function categoryOptions(kind, selected) {
    return `<option value="">Elige…</option>${state.categories.filter((c) => c.kind === (kind === 'ingreso' ? 'income' : 'expense'))
      .map((c) => `<option value="${c.id}" ${Number(selected) === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}`;
  }

  function txModal({ editing = null, preset = null } = {}) {
    const t = editing;
    const kind = t ? (t.amount > 0 ? 'ingreso' : 'gasto') : 'gasto';
    const amount = t ? Math.abs(t.amount) : preset ? preset.amount : '';
    const desc = t ? t.description : preset ? preset.description : '';
    const catId = t ? t.categoryId : preset ? preset.categoryId : '';
    openModal(`<form data-form="tx" novalidate>
      ${modalHead(t ? 'Editar movimiento' : 'Nuevo movimiento')}
      <div class="field"><div class="seg" role="group" aria-label="Tipo de movimiento">
        <button type="button" data-action="tx-kind" data-kind="gasto" aria-pressed="${kind === 'gasto'}">Gasto</button>
        <button type="button" data-action="tx-kind" data-kind="ingreso" aria-pressed="${kind === 'ingreso'}">Ingreso</button></div></div>
      <label class="field"><span class="field-label">Monto</span><input name="amount" class="amount-input" inputmode="numeric" autocomplete="off" value="${amount ? L.formatAmount(amount) : ''}" placeholder="0"><div class="field-error" data-err="amount"></div></label>
      <label class="field"><span class="field-label">Descripción</span><input name="description" maxlength="80" autocomplete="off" value="${esc(desc)}" placeholder="p. ej. Farmacia Vida"><div class="field-hint" data-hint="rule"></div><div class="field-error" data-err="description"></div></label>
      <div class="form-grid-2">
        <label class="field"><span class="field-label">Categoría</span><select name="categoryId">${categoryOptions(kind, catId)}</select><div class="field-error" data-err="categoryId"></div></label>
        <label class="field"><span class="field-label">Cuenta</span><select name="accountId">${state.accounts.map((a) => `<option value="${a.id}" ${(t ? t.accountId : 1) === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span class="field-label">Fecha</span><input type="date" name="date" value="${t ? t.date : today()}" max="${today()}"><div class="field-error" data-err="date"></div></label>
      <div class="modal-actions">
        ${t ? `<button type="button" class="btn" data-action="del-tx" data-id="${t.id}" style="margin-right:auto">Eliminar</button>` : ''}
        <button type="button" class="btn" data-action="close-modal">Cancelar</button>
        <button type="submit" class="btn btn-primary">Guardar</button>
      </div></form>`, { type: 'tx', kind, catTouched: !!catId, editingId: t ? t.id : null });
  }

  function suggestCategory(form) {
    const m = ui.modal;
    const input = form.elements.description;
    const hint = form.querySelector('[data-hint="rule"]');
    const kind = m.kind === 'ingreso' ? 'income' : 'expense';
    const rule = L.matchRule(input.value, rulesWithKind().filter((r) => r.kind === kind));
    if (!m.catTouched && rule) form.elements.categoryId.value = String(rule.categoryId);
    hint.textContent = rule ? `Categoría sugerida por la regla «${rule.pattern}» → ${cat(rule.categoryId).name}` : '';
  }

  function saveTx(form) {
    const m = ui.modal;
    const amount = digits(form.elements.amount.value);
    const description = form.elements.description.value.trim();
    const categoryId = Number(form.elements.categoryId.value) || null;
    const accountId = Number(form.elements.accountId.value) || 1;
    const date = form.elements.date.value;
    let ok = true;
    const check = (name, cond, msg) => { setErr(form, name, cond ? '' : msg); if (!cond) ok = false; };
    check('amount', amount && amount > 0 && amount <= 100000000, 'Ingresa un monto mayor que cero.');
    check('description', description.length > 0, 'Escribe una descripción.');
    check('categoryId', !!categoryId, 'Elige una categoría.');
    check('date', !!L.parseDate(date) && date <= today(), 'La fecha no puede ser futura.');
    if (!ok) { form.querySelector('.field-error:not(:empty)')?.closest('.field')?.querySelector('input,select')?.focus(); return; }

    const signed = m.kind === 'ingreso' ? amount : -amount;
    if (m.editingId) {
      const t = state.transactions.find((x) => x.id === m.editingId);
      Object.assign(t, { amount: signed, description, categoryId, accountId, date });
    } else {
      state.transactions.push({ id: state.nextId++, date, description, amount: signed, categoryId, accountId });
    }
    sortTx();
    save();
    closeModal();
    render({ keepScroll: true });
    const daily = derive().daily;
    const extra = m.kind === 'gasto' && daily && date === today() ? (daily.leftToday >= 0 ? ` · hoy te quedan ${money(daily.leftToday)}` : ` · hoy vas ${money(-daily.leftToday)} sobre el monto del día`) : '';
    toast(`${m.editingId ? 'Movimiento actualizado' : m.kind === 'gasto' ? 'Gasto registrado' : 'Ingreso registrado'}${extra}`);
  }

  function deleteTx(id) {
    const i = state.transactions.findIndex((t) => t.id === id);
    if (i < 0) return;
    const [t] = state.transactions.splice(i, 1);
    save();
    closeModal();
    render({ keepScroll: true });
    toast(`Eliminado: ${t.description}`, { label: 'Deshacer', fn: () => { state.transactions.push(t); sortTx(); save(); render({ keepScroll: true }); } });
  }

  function goalModal(g, mode) {
    const d = derive();
    const free = d.savings.balance - d.reserved;
    const remaining = Math.max(0, g.target - g.balance);
    const line = d.plan.lines.find((l) => l.goalId === g.id);
    const suggested = mode === 'contribute' ? Math.min(remaining, free, line ? line.effective || line.demand : remaining) : g.balance;
    openModal(`<form data-form="goal" novalidate>
      ${modalHead(mode === 'contribute' ? `Aportar a ${esc(g.name)}` : `Liberar de ${esc(g.name)}`)}
      <label class="field"><span class="field-label">Monto</span><input name="amount" class="amount-input" inputmode="numeric" autocomplete="off" value="${suggested > 0 ? L.formatAmount(suggested) : ''}">
        <div class="field-hint">${mode === 'contribute' ? `Libre para reservar en Cuenta de ahorro: ${money(free)} · faltante de la meta: ${money(remaining)}` : `Saldo de la meta: ${money(g.balance)}. Lo liberado vuelve a quedar libre en la cuenta.`}</div>
        <div class="field-error" data-err="amount"></div></label>
      <div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Cancelar</button><button type="submit" class="btn btn-primary">${mode === 'contribute' ? 'Aportar' : 'Liberar'}</button></div>
    </form>`, { type: 'goal', mode, goalId: g.id, free, remaining });
  }

  function saveGoalMove(form) {
    const m = ui.modal;
    const g = state.goals.find((x) => x.id === m.goalId);
    const amount = digits(form.elements.amount.value) || 0;
    let msg = '';
    if (amount <= 0) msg = 'Ingresa un monto mayor que cero.';
    else if (m.mode === 'contribute' && amount > m.free) msg = `Lo reservado no puede superar el saldo de la cuenta: quedan ${money(m.free)} libres.`;
    else if (m.mode === 'contribute' && amount > m.remaining) msg = `El aporte supera lo que falta para la meta (${money(m.remaining)}).`;
    else if (m.mode === 'withdraw' && amount > g.balance) msg = `La meta solo tiene ${money(g.balance)}.`;
    setErr(form, 'amount', msg);
    if (msg) return;
    const before = { balance: g.balance, lastContribution: g.lastContribution, monthContrib: g.monthContrib || 0 };
    if (m.mode === 'contribute') {
      const cur = L.monthKey(today());
      g.monthContrib = (g.lastContribution === cur ? g.monthContrib || 0 : 0) + amount;
      g.lastContribution = cur;
      g.balance += amount;
    } else g.balance -= amount;
    save();
    closeModal();
    render({ keepScroll: true });
    toast(`${m.mode === 'contribute' ? 'Aporte' : 'Liberación'} de ${money(amount)} en ${g.name}`, { label: 'Deshacer', fn: () => { Object.assign(g, before); save(); render({ keepScroll: true }); } });
  }

  function newGoalModal() {
    const def = L.shiftMonthKey(L.monthKey(today()), 12);
    openModal(`<form data-form="new-goal" novalidate>
      ${modalHead('Nueva meta')}
      <label class="field"><span class="field-label">Nombre</span><input name="name" maxlength="40" placeholder="p. ej. Curso de idiomas" autocomplete="off"><div class="field-error" data-err="name"></div></label>
      <div class="form-grid-2">
        <label class="field"><span class="field-label">Objetivo</span><input name="target" class="num" inputmode="numeric" placeholder="1.000.000" autocomplete="off"><div class="field-error" data-err="target"></div></label>
        <label class="field"><span class="field-label">Fecha límite</span><input type="month" name="deadline" value="${def}" min="${L.monthKey(today())}"><div class="field-error" data-err="deadline"></div></label>
      </div>
      <label class="field"><span class="field-label">Prioridad</span><select name="priority">
        <option value="1">P1 · como fondo de emergencia (N3)</option><option value="2">P2 (N5)</option><option value="3" selected>P3 (N5)</option><option value="4">P4 (N5)</option><option value="5">P5 (N5)</option></select></label>
      <div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Cancelar</button><button type="submit" class="btn btn-primary">Crear meta</button></div>
    </form>`, { type: 'new-goal' });
  }

  function saveNewGoal(form) {
    const name = form.elements.name.value.trim();
    const target = digits(form.elements.target.value) || 0;
    const deadline = form.elements.deadline.value;
    let ok = true;
    const check = (n, cond, msg) => { setErr(form, n, cond ? '' : msg); if (!cond) ok = false; };
    check('name', name.length > 0, 'Escribe un nombre.');
    check('target', target >= 10000 && target <= 1000000000, 'El objetivo debe ser de al menos $ 10.000.');
    check('deadline', /^\d{4}-\d{2}$/.test(deadline) && deadline >= L.monthKey(today()), 'Elige un mes desde el actual.');
    if (!ok) return;
    const colors = ['var(--slate)', 'var(--clay)', 'var(--sage)', 'var(--sand)'];
    const id = Math.max(0, ...state.goals.map((g) => g.id)) + 1;
    state.goals.push({ id, name, target, balance: 0, deadline: `${deadline}-28`, priority: Number(form.elements.priority.value), lastContribution: null, color: colors[id % colors.length] });
    save();
    closeModal();
    render();
    toast(`Meta «${name}» creada · ya pide su aporte en el plan`);
  }

  /* ─── Importación ──────────────────────────────────────── */

  function parseImport() {
    const res = L.parseStatement(ui.importText, { rules: rulesWithKind(), existing: state.transactions });
    ui.importError = res.error || null;
    ui.importRows = res.rows || null;
    $('#imp-preview').innerHTML = importPreview();
  }

  function reapplyRules() {
    if (!ui.importRows) return;
    const rules = rulesWithKind();
    for (const r of ui.importRows) {
      if (r.problems.length || r.manualCat) continue;
      const kind = r.amount > 0 ? 'income' : 'expense';
      const rule = L.matchRule(r.description, rules.filter((x) => x.kind === kind));
      r.categoryId = rule ? rule.categoryId : null;
      r.rulePattern = rule ? rule.pattern : null;
    }
  }

  function confirmImport() {
    const rows = (ui.importRows || []).filter((r) => r.include && r.categoryId);
    const added = rows.map((r) => ({ id: state.nextId++, date: r.date, description: r.description, amount: r.amount, categoryId: r.categoryId, accountId: 1 }));
    state.transactions.push(...added);
    sortTx();
    save();
    ui.importRows = null;
    ui.importText = '';
    render();
    const ids = new Set(added.map((t) => t.id));
    toast(`${added.length} movimientos importados`, {
      label: 'Deshacer', fn: () => { state.transactions = state.transactions.filter((t) => !ids.has(t.id)); save(); render(); },
    });
  }

  /* ─── Eventos ──────────────────────────────────────────── */

  const actions = {
    'new-tx': () => txModal(),
    'edit-tx': (el) => txModal({ editing: state.transactions.find((t) => t.id === Number(el.dataset.id)) }),
    'del-tx': (el) => deleteTx(Number(el.dataset.id)),
    'close-modal': () => closeModal(),
    shortcut: (el) => txModal({ preset: derive().shortcuts[Number(el.dataset.i)] }),
    'tx-kind': (el) => {
      const form = el.closest('form');
      ui.modal.kind = el.dataset.kind;
      ui.modal.catTouched = false;
      $$('[data-action="tx-kind"]', form).forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
      form.elements.categoryId.innerHTML = categoryOptions(ui.modal.kind, '');
      suggestCategory(form);
    },
    'more-tx': () => { ui.tx.limit += 60; $('#tx-results').innerHTML = txResults(); },
    'confirm-plan': () => {
      const p = derive().plan;
      state.plan.confirmed = { month: L.monthKey(today()), at: today(), available: p.available, lines: Object.fromEntries(p.lines.map((l) => [l.key, l.assigned])) };
      save();
      refreshPlan();
      toast('Plan confirmado · Inicio y "cuánto puedo gastar hoy" usan estos montos');
    },
    'plan-auto': (el) => { delete state.plan.manual[el.dataset.key]; save(); refreshPlan(); },
    scenario: (el) => {
      const received = derive().plan.received;
      const v = el.dataset.v;
      state.plan.incomeOverride = v === 'real' ? null : v === 'bonus' ? received + 300000 : Math.round((received * Number(v)) / 10000) * 10000;
      save();
      const range = $('#income-range');
      const value = state.plan.incomeOverride ?? received;
      if (Number(range.max) < value) range.max = String(value);
      range.value = String(value);
      refreshPlan();
    },
    contribute: (el) => goalModal(state.goals.find((g) => g.id === Number(el.dataset.id)), 'contribute'),
    withdraw: (el) => goalModal(state.goals.find((g) => g.id === Number(el.dataset.id)), 'withdraw'),
    'new-goal': () => newGoalModal(),
    'import-sample': () => { ui.importText = D.sampleStatement(state); $('#imp-text').value = ui.importText; parseImport(); },
    'import-parse': () => { ui.importText = $('#imp-text').value; parseImport(); },
    'import-cancel': () => { ui.importRows = null; ui.importError = null; $('#imp-preview').innerHTML = ''; },
    'import-confirm': () => confirmImport(),
    'del-rule': (el) => { state.rules.splice(Number(el.dataset.i), 1); save(); reapplyRules(); render({ keepScroll: true }); },
    theme: () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'),
    reset: () => {
      if (!window.confirm('¿Restablecer la demo? Se borran los cambios hechos en este navegador y se vuelven a generar los datos ficticios.')) return;
      try { localStorage.removeItem(STORE_KEY); } catch (e) { /* nada */ }
      state = D.seed();
      Object.assign(ui, { importText: '', importRows: null, importError: null, tx: { q: '', type: 'todos', cat: '', month: '', limit: 60 } });
      save();
      render();
      toast('Demo restablecida con datos nuevos');
    },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = actions[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el); }
  });

  document.addEventListener('submit', (e) => {
    const form = e.target;
    const kind = form.dataset.form;
    if (!kind) return;
    e.preventDefault();
    if (kind === 'tx') saveTx(form);
    else if (kind === 'goal') saveGoalMove(form);
    else if (kind === 'new-goal') saveNewGoal(form);
    else if (kind === 'rule') {
      const pattern = form.elements.pattern.value.trim();
      const normalized = L.normalizeText(pattern);
      let msg = '';
      if (normalized.length < 3) msg = 'El texto de la regla necesita al menos 3 letras.';
      else if (state.rules.some((r) => L.normalizeText(r.pattern) === normalized)) msg = 'Ya existe una regla con ese texto.';
      setErr(form.parentElement, 'rule', msg);
      if (msg) return;
      state.rules.push({ pattern, categoryId: Number(form.elements.categoryId.value) });
      save();
      reapplyRules();
      ui.importText = $('#imp-text')?.value ?? ui.importText;
      render({ keepScroll: true });
      toast(`Regla «${pattern}» agregada${ui.importRows ? ' · vista previa actualizada' : ''}`);
    }
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.filter) {
      ui.tx[t.dataset.filter] = t.value;
      ui.tx.limit = 60;
      $('#tx-results').innerHTML = txResults();
    } else if (t.id === 'income-range') {
      const v = Number(t.value);
      state.plan.incomeOverride = v;
      refreshPlan();
    } else if (t.dataset.sim) {
      const g = state.goals.find((x) => x.id === Number(t.dataset.sim));
      const v = Number(t.value);
      $(`[data-sim-val="${g.id}"]`).textContent = money(v);
      $(`[data-sim-out="${g.id}"]`).innerHTML = simText(g, v, L.monthKey(today()));
    } else if (t.id === 'imp-text') {
      ui.importText = t.value;
    } else if (ui.modal && ui.modal.type === 'tx' && t.name === 'description') {
      suggestCategory(t.form);
    }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'income-range') save();
    else if (t.dataset.planLine) {
      const v = digits(t.value);
      if (v === null) delete state.plan.manual[t.dataset.planLine];
      else state.plan.manual[t.dataset.planLine] = Math.min(v, 100000000);
      save();
      refreshPlan();
    } else if (t.dataset.impInc !== undefined) {
      ui.importRows[Number(t.dataset.impInc)].include = t.checked;
      $('#imp-preview').innerHTML = importPreview();
    } else if (t.dataset.impCat !== undefined) {
      const r = ui.importRows[Number(t.dataset.impCat)];
      r.categoryId = Number(t.value) || null;
      r.rulePattern = null;
      r.manualCat = true;
      $('#imp-preview').innerHTML = importPreview();
    } else if (t.id === 'imp-file' && t.files && t.files[0]) {
      const file = t.files[0];
      if (file.size > 512 * 1024) { toast('El archivo supera 512 KB'); return; }
      const reader = new FileReader();
      reader.onload = () => { ui.importText = String(reader.result); $('#imp-text').value = ui.importText; parseImport(); };
      reader.readAsText(file);
    } else if (ui.modal && ui.modal.type === 'tx' && t.name === 'categoryId') {
      ui.modal.catTouched = !!t.value;
    } else if (ui.modal && t.name === 'amount' && t.classList.contains('amount-input')) {
      const v = digits(t.value);
      t.value = v ? L.formatAmount(v) : '';
    }
  });

  // Donut ↔ leyenda: resaltar la categoría bajo el cursor.
  document.addEventListener('mouseover', (e) => {
    const s = e.target.closest('[data-slice], [data-cat-i]');
    const box = $('#donut');
    if (!box) return;
    const i = s ? Number(s.dataset.slice ?? s.dataset.catI) : null;
    $$('[data-slice]', box).forEach((p) => { p.style.opacity = i === null || Number(p.dataset.slice) === i ? 1 : 0.28; });
    $$('[data-cat-i]').forEach((li) => li.classList.toggle('dim', i !== null && Number(li.dataset.catI) !== i));
  });

  dialog().addEventListener('click', (e) => { if (e.target === dialog()) closeModal(); });
  dialog().addEventListener('close', () => { ui.modal = null; dialog().innerHTML = ''; });

  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => drawArea(), 150); });
  window.addEventListener('hashchange', () => { closeModal(); render(); });

  /* ─── Tema ─────────────────────────────────────────────── */

  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* nada */ }
    $$('[data-action="theme"]').forEach((b) => (b.textContent = t === 'dark' ? 'Tema claro' : 'Tema oscuro'));
  }
  setTheme(document.documentElement.dataset.theme || 'light');

  save();
  render();
})();
