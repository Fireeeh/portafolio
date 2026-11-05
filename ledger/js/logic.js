/*
 * Lógica pura de la demo. Versiones reducidas de los módulos puros de Ledger
 * (lib/format.ts, lib/category-rules.ts, lib/planning/daily-allowance.ts,
 * lib/planning/engine.ts, lib/goals/metrics.ts, lib/import/statement.ts),
 * reescritas aquí para que la demo no importe nada del sistema principal.
 * Sin DOM, sin red, sin almacenamiento. Montos en pesos enteros.
 */
(function (global) {
  'use strict';

  const LOCALE = 'es-CL';
  const STEP = 1000;
  const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  /* ─── Formato ──────────────────────────────────────────── */

  function formatAmount(n) {
    return Math.abs(Math.round(n)).toLocaleString(LOCALE);
  }

  /** "−$ 1.000", "+$ 500" (signed) o "$ 500". El signo nunca queda al final. */
  function formatMoney(n, { signed = false } = {}) {
    const sign = n < 0 ? '−' : signed && n > 0 ? '+' : '';
    return `${sign}$ ${formatAmount(n)}`;
  }

  /* ─── Fechas (hora local del navegador) ───────────────── */

  const pad2 = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const monthKey = (date) => date.slice(0, 7);

  function shiftMonthKey(key, n) {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  }

  function monthsBetween(a, b) {
    const [ya, ma] = a.split('-').map(Number);
    const [yb, mb] = b.split('-').map(Number);
    return (yb - ya) * 12 + (mb - ma);
  }

  function monthLabel(key, short = false) {
    const [y, m] = key.split('-').map(Number);
    return short ? MONTHS_SHORT[m - 1] : `${MONTHS[m - 1]} ${y}`;
  }

  function dateLabel(date) {
    const [y, m, d] = date.split('-').map(Number);
    return `${d} ${MONTHS_SHORT[m - 1].toLowerCase()} ${y}`;
  }

  /* ─── Utilidades de montos ────────────────────────────── */

  const ceilToStep = (n, step = STEP) => Math.ceil(n / step) * step;
  const floorToStep = (n, step = STEP) => Math.floor(n / step) * step;

  function median(values) {
    if (!values.length) return 0;
    const s = [...values].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
  }

  /* ─── Reglas de categoría ─────────────────────────────── */

  /** Minúsculas, sin tildes y con espacios simples. */
  function normalizeText(s) {
    return String(s)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Primera regla cuyo texto aparece en la descripción (gana el orden). */
  function matchRule(description, rules) {
    const text = normalizeText(description);
    if (!text) return null;
    for (const r of rules) {
      const p = normalizeText(r.pattern);
      if (p && text.includes(p)) return r;
    }
    return null;
  }

  /* ─── Cuánto puedo gastar hoy ─────────────────────────── */

  /**
   * Lo que queda del presupuesto de categorías repartido entre los días que
   * faltan del mes, contando hoy. El monto del día se fija con lo gastado hasta
   * ayer: lo que se gasta hoy lo va descontando.
   */
  function dailyAllowance(lines, today) {
    const budget = lines.reduce((a, l) => a + Math.max(0, l.assigned), 0);
    if (budget <= 0) return null;
    const spent = lines.reduce((a, l) => a + l.spent, 0);
    const spentToday = lines.reduce((a, l) => a + l.spentToday, 0);
    const [y, m, d] = today.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const daysLeft = Math.max(1, lastDay - d + 1);
    const atStartOfDay = budget - (spent - spentToday);
    const perDay = atStartOfDay > 0 ? Math.floor(atStartOfDay / daysLeft) : 0;
    return { budget, spent, spentToday, daysLeft, perDay, leftToday: perDay - spentToday, leftMonth: budget - spent };
  }

  /* ─── Metas ───────────────────────────────────────────── */

  /** Aporte por período para llegar en plazo, redondeado hacia arriba. */
  function requiredContribution(remaining, periodsLeft, step = STEP) {
    if (remaining <= 0) return 0;
    if (periodsLeft <= 0) return remaining;
    return Math.min(remaining, ceilToStep(Math.ceil(remaining / periodsLeft), step));
  }

  function goalMetrics({ balance, target, deadline, monthly, contributedThisMonth, currentMonth }) {
    const remaining = Math.max(0, target - balance);
    const progressPct = Math.min(100, Math.floor((Math.max(0, balance) * 100) / target));
    const firstMonth = contributedThisMonth ? shiftMonthKey(currentMonth, 1) : currentMonth;
    const periodsLeft = Math.max(0, monthsBetween(firstMonth, deadline.slice(0, 7)) + 1);
    const required = requiredContribution(remaining, periodsLeft);
    const estimatedMonth = remaining > 0 && monthly > 0 ? shiftMonthKey(firstMonth, Math.ceil(remaining / monthly) - 1) : null;
    let risk = null;
    if (remaining > 0 && periodsLeft === 0) risk = 'vencida';
    else if (remaining > 0 && monthly < required) risk = 'en_riesgo';
    return { remaining, progressPct, periodsLeft, required, estimatedMonth, risk };
  }

  /* ─── Motor del plan (N1–N7) ──────────────────────────── */

  const TIER_INFO = {
    1: { name: 'Compromisos esenciales', strategy: 'secuencial' },
    2: { name: 'Gastos esenciales variables', strategy: 'proporcional' },
    3: { name: 'Fondo de emergencia y metas prioritarias', strategy: 'secuencial' },
    4: { name: 'Compromisos opcionales', strategy: 'proporcional' },
    5: { name: 'Otras metas', strategy: 'secuencial' },
    6: { name: 'Gastos opcionales variables', strategy: 'proporcional' },
    7: { name: 'Remanente', strategy: 'secuencial' },
  };

  /**
   * Reparte lo disponible por niveles de prioridad. Si un nivel no alcanza:
   * los secuenciales cubren línea por línea en orden; los proporcionales
   * reparten según la demanda de cada línea. Lo que sobra queda "Sin asignar".
   * Mismas entradas ⇒ mismas salidas.
   */
  function allocatePlan(available, lines) {
    let left = Math.max(0, available);
    const out = [];
    for (let tier = 1; tier <= 6; tier++) {
      const tl = lines
        .filter((l) => l.tier === tier)
        .sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.key.localeCompare(b.key));
      const demand = tl.reduce((a, l) => a + l.demand, 0);
      if (left >= demand) {
        tl.forEach((l) => out.push({ ...l, assigned: l.demand }));
        left -= demand;
      } else if (TIER_INFO[tier].strategy === 'secuencial') {
        for (const l of tl) {
          const a = Math.min(l.demand, left);
          out.push({ ...l, assigned: a });
          left -= a;
        }
      } else {
        const pool = left;
        for (const l of tl) {
          const a = demand > 0 ? floorToStep((l.demand * pool) / demand) : 0;
          out.push({ ...l, assigned: a });
          left -= a;
        }
      }
    }
    const demandTotal = lines.reduce((a, l) => a + l.demand, 0);
    return {
      available,
      demandTotal,
      unassigned: left,
      lines: out.map((l) => ({ ...l, shortfall: l.demand - l.assigned })),
    };
  }

  /* ─── Cartola CSV ─────────────────────────────────────── */

  function detectDelimiter(firstLine) {
    const counts = [';', ',', '\t'].map((d) => ({ d, n: firstLine.split(d).length - 1 }));
    counts.sort((a, b) => b.n - a.n);
    return counts[0].n > 0 ? counts[0].d : ',';
  }

  /** Filas del CSV como celdas (respeta comillas). */
  function parseCsv(text) {
    const src = text.replace(/^﻿/, '');
    const delim = detectDelimiter(src.split(/\r?\n/, 1)[0] || '');
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (quoted) {
        if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && src[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
  }

  /** Monto chileno ("1.234.567", "-12.345", "$ 12.345", "12.345,50", "(5.000)") o null. */
  function parseAmount(raw) {
    let s = String(raw).replace(/\s|\$|CLP/gi, '');
    if (!s) return null;
    let negative = false;
    if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
    if (s.startsWith('-')) { negative = !negative; s = s.slice(1); }
    else if (s.startsWith('+')) s = s.slice(1);
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const n = Math.round(Number(s));
    return negative ? -n : n;
  }

  /** DD/MM/AAAA, DD-MM-AAAA, DD.MM.AAAA, DD/MM/AA o AAAA-MM-DD → 'AAAA-MM-DD'. */
  function parseDate(raw) {
    const s = String(raw).trim();
    let y, m, d;
    let r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (r) { y = +r[1]; m = +r[2]; d = +r[3]; }
    else {
      r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
      if (!r) return null;
      d = +r[1]; m = +r[2]; y = +r[3];
      if (y < 100) y += 2000;
    }
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }

  function findColumns(header) {
    const h = header.map(normalizeText);
    const find = (re) => h.findIndex((c) => re.test(c));
    return {
      date: find(/fecha/),
      description: find(/descrip|detalle|glosa|concepto/),
      amount: find(/^monto|importe|^valor/),
      debit: find(/cargo|debito|egreso|giro/),
      credit: find(/abono|credito|deposito/),
    };
  }

  /**
   * Lee la cartola y devuelve filas listas para la vista previa. Cada fila trae
   * la categoría sugerida por las reglas y si parece duplicada de un movimiento
   * que ya existe (misma fecha, monto y descripción).
   */
  function parseStatement(text, { rules, existing }) {
    const rows = parseCsv(text);
    if (rows.length < 2) return { error: 'La cartola necesita una cabecera y al menos una fila.' };
    const cols = findColumns(rows[0]);
    if (cols.date < 0 || cols.description < 0 || (cols.amount < 0 && cols.debit < 0 && cols.credit < 0)) {
      return { error: 'No encontré las columnas Fecha, Descripción y Monto (o Cargo y Abono) en la cabecera.' };
    }
    const seen = new Set(existing.map((t) => `${t.date}|${t.amount}|${normalizeText(t.description)}`));
    const out = [];
    rows.slice(1, 501).forEach((r, i) => {
      const line = i + 2;
      const date = parseDate(r[cols.date] || '');
      const description = (r[cols.description] || '').slice(0, 80);
      let amount = null;
      if (cols.amount >= 0 && r[cols.amount]) amount = parseAmount(r[cols.amount]);
      else {
        const debit = cols.debit >= 0 && r[cols.debit] ? parseAmount(r[cols.debit]) : null;
        const credit = cols.credit >= 0 && r[cols.credit] ? parseAmount(r[cols.credit]) : null;
        if (debit) amount = -Math.abs(debit);
        else if (credit) amount = Math.abs(credit);
      }
      const problems = [];
      if (!date) problems.push('fecha no válida');
      if (!description) problems.push('sin descripción');
      if (!amount) problems.push('monto no válido');
      const rule = description ? matchRule(description, rules.filter((x) => (amount || 0) < 0 ? x.kind === 'expense' : x.kind === 'income')) : null;
      const key = `${date}|${amount}|${normalizeText(description)}`;
      const duplicate = !problems.length && seen.has(key);
      if (!problems.length) seen.add(key);
      out.push({
        line, date, description, amount,
        categoryId: rule ? rule.categoryId : null,
        rulePattern: rule ? rule.pattern : null,
        problems, duplicate,
        include: !problems.length && !duplicate,
      });
    });
    return { rows: out };
  }

  global.LedgerLogic = {
    STEP, TIER_INFO,
    formatAmount, formatMoney,
    ymd, monthKey, shiftMonthKey, monthsBetween, monthLabel, dateLabel,
    ceilToStep, floorToStep, median,
    normalizeText, matchRule,
    dailyAllowance, requiredContribution, goalMetrics, allocatePlan,
    parseCsv, parseAmount, parseDate, parseStatement,
  };
})(window);
