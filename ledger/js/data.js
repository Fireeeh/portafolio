/*
 * Datos ficticios de la demo. Todo se genera aquí, en el navegador, con una
 * semilla fija: seis meses de movimientos que terminan hoy. Ningún nombre,
 * comercio ni monto proviene de datos reales.
 */
(function (global) {
  'use strict';
  const L = global.LedgerLogic;

  /** Generador pseudoaleatorio con semilla (mulberry32): misma semilla, mismos datos. */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const CATEGORIES = [
    { id: 1, name: 'Vivienda', color: 'var(--slate)', kind: 'expense', group: 'compromiso' },
    { id: 2, name: 'Servicios', color: 'var(--taupe)', kind: 'expense', group: 'compromiso' },
    { id: 3, name: 'Suscripciones', color: 'var(--sand)', kind: 'expense', group: 'compromiso' },
    { id: 4, name: 'Supermercado', color: 'var(--green)', kind: 'expense', group: 'esencial', budget: 260000 },
    { id: 5, name: 'Transporte', color: 'var(--amber)', kind: 'expense', group: 'esencial', budget: 120000 },
    { id: 6, name: 'Salud', color: 'var(--sage)', kind: 'expense', group: 'esencial', budget: 40000 },
    { id: 7, name: 'Restaurantes', color: 'var(--terracotta)', kind: 'expense', group: 'opcional', budget: 90000 },
    { id: 8, name: 'Ocio', color: 'var(--clay)', kind: 'expense', group: 'opcional', budget: 60000 },
    { id: 9, name: 'Compras', color: 'var(--ink-soft)', kind: 'expense', group: 'opcional', budget: 70000 },
    { id: 20, name: 'Sueldo', color: 'var(--green)', kind: 'income' },
    { id: 21, name: 'Freelance', color: 'var(--sage)', kind: 'income' },
    { id: 22, name: 'Otros ingresos', color: 'var(--sand)', kind: 'income' },
  ];

  const ACCOUNTS = [
    { id: 1, name: 'Cuenta corriente', initial: 620000 },
    { id: 2, name: 'Cuenta de ahorro', initial: 2900000 },
    { id: 3, name: 'Efectivo', initial: 45000 },
  ];

  /** Compromisos fijos: N1 esenciales, N4 opcionales. */
  const COMMITMENTS = [
    { id: 1, label: 'Arriendo departamento', amount: 450000, tier: 1, categoryId: 1, day: 5 },
    { id: 2, label: 'Cuenta de luz', amount: 40000, tier: 1, categoryId: 2, day: 10 },
    { id: 3, label: 'Cuenta de agua', amount: 20000, tier: 1, categoryId: 2, day: 12 },
    { id: 4, label: 'Gas', amount: 25000, tier: 1, categoryId: 2, day: 14 },
    { id: 5, label: 'Internet y celular', amount: 32000, tier: 1, categoryId: 2, day: 8 },
    { id: 6, label: 'Streaming', amount: 13000, tier: 4, categoryId: 3, day: 3 },
    { id: 7, label: 'Gimnasio', amount: 25000, tier: 4, categoryId: 3, day: 2 },
  ];

  const RULES = [
    { pattern: 'supermercado', categoryId: 4 },
    { pattern: 'minimarket', categoryId: 4 },
    { pattern: 'feria', categoryId: 4 },
    { pattern: 'transporte', categoryId: 5 },
    { pattern: 'taxi', categoryId: 5 },
    { pattern: 'bencina', categoryId: 5 },
    { pattern: 'farmacia', categoryId: 6 },
    { pattern: 'cafeteria', categoryId: 7 },
    { pattern: 'sushi', categoryId: 7 },
    { pattern: 'cine', categoryId: 8 },
    { pattern: 'sueldo', categoryId: 20 },
    { pattern: 'freelance', categoryId: 21 },
  ];

  /** Gastos variables: [descripción, categoría, mínimo, máximo, veces al mes (mín, máx)]. */
  const VARIABLE = [
    ['Supermercado Central', 4, 22000, 58000, 3, 4],
    ['Minimarket El Barrio', 4, 4500, 16000, 3, 5],
    ['Feria libre', 4, 9000, 21000, 2, 3],
    ['Recarga tarjeta transporte', 5, 10000, 20000, 3, 4],
    ['Taxi app viaje', 5, 4200, 11800, 2, 4],
    ['Bencina', 5, 26000, 38000, 1, 1],
    ['Farmacia Vida', 6, 6500, 24000, 1, 2],
    ['Cafetería La Esquina', 7, 3200, 6800, 3, 6],
    ['Almuerzo trabajo', 7, 6500, 9800, 2, 4],
    ['Sushi delivery', 7, 15000, 24000, 0, 2],
    ['Cine Estrella', 8, 8000, 14500, 0, 2],
    ['Librería Mundo Papel', 8, 11000, 26000, 0, 1],
    ['Tienda de ropa', 9, 18000, 52000, 0, 1],
    ['Ferretería Don Tito', 9, 6000, 22000, 0, 1],
  ];

  function seed(todayDate = new Date()) {
    const r = rng(20261105);
    const between = (a, b) => a + r() * (b - a);
    const today = L.ymd(todayDate);
    const curMonth = L.monthKey(today);
    const txs = [];
    let id = 1;
    const add = (date, description, amount, categoryId, accountId = 1) => {
      if (date > today) return;
      txs.push({ id: id++, date, description, amount, categoryId, accountId });
    };
    const dayIn = (mk, d) => {
      const [y, m] = mk.split('-').map(Number);
      const last = new Date(y, m, 0).getDate();
      return `${mk}-${String(Math.min(d, last)).padStart(2, '0')}`;
    };
    const round = (n, to = 10) => Math.round(n / to) * to;

    for (let back = 5; back >= 0; back--) {
      const mk = L.shiftMonthKey(curMonth, -back);
      add(dayIn(mk, 1), 'Sueldo Empresa Demo SpA', 1650000, 20);
      if (back === 4 || back === 2) add(dayIn(mk, 18), 'Proyecto freelance diseño web', back === 4 ? 180000 : 240000, 21);
      for (const c of COMMITMENTS) {
        const varies = c.categoryId === 2 && c.id !== 5;
        const amount = varies ? round(c.amount * between(0.85, 1.08), 10) : c.amount;
        add(dayIn(mk, c.day), c.label, -amount, c.categoryId);
      }
      for (const [desc, cat, min, max, nMin, nMax] of VARIABLE) {
        const n = Math.round(between(nMin, nMax));
        for (let k = 0; k < n; k++) {
          const day = 1 + Math.floor(r() * 28);
          const account = desc === 'Feria libre' || desc === 'Minimarket El Barrio' ? 3 : 1;
          add(dayIn(mk, day), desc, -round(between(min, max), 100), cat, account);
        }
      }
    }
    // Hoy siempre hay un café, para que "cuánto puedo gastar hoy" muestre lo gastado.
    add(today, 'Cafetería La Esquina', -4200, 7);
    txs.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));

    const deadline = (months) => `${L.shiftMonthKey(curMonth, months)}-28`;
    return {
      version: 1,
      seededAt: today,
      categories: CATEGORIES.map((c) => ({ ...c })),
      accounts: ACCOUNTS.map((a) => ({ ...a })),
      commitments: COMMITMENTS.map((c) => ({ ...c })),
      rules: RULES.map((x) => ({ ...x })),
      goals: [
        { id: 1, name: 'Fondo de emergencia', target: 2000000, balance: 1240000, deadline: deadline(8), priority: 1, lastContribution: null, color: 'var(--green)' },
        { id: 2, name: 'Viaje a Japón', target: 3000000, balance: 650000, deadline: deadline(14), priority: 2, lastContribution: null, color: 'var(--terracotta)' },
        { id: 3, name: 'Notebook nuevo', target: 900000, balance: 720000, deadline: deadline(4), priority: 3, lastContribution: null, color: 'var(--amber)' },
      ],
      transactions: txs,
      plan: { incomeOverride: null, manual: {}, confirmed: null },
      nextId: id + 1000,
    };
  }

  /** Cartola de ejemplo para la importación: incluye un duplicado y una fila con error. */
  function sampleStatement(state, todayDate = new Date()) {
    const today = L.ymd(todayDate);
    const d = (offset) => {
      const x = new Date(todayDate);
      x.setDate(x.getDate() - offset);
      const s = L.ymd(x);
      const [y, m, dd] = s.split('-');
      return `${dd}/${m}/${y}`;
    };
    const dup = state.transactions.find((t) => t.amount < 0 && t.date < today && t.description === 'Supermercado Central');
    const lines = [
      'Fecha;Descripción;Cargo;Abono',
      `${d(1)};COMPRA SUPERMERCADO CENTRAL SUC 12;34.590;`,
      `${d(1)};TAXI APP VIAJE CENTRO;7.840;`,
      `${d(2)};FARMACIA VIDA LOCAL 4;12.990;`,
      `${d(2)};TRANSFERENCIA RECIBIDA REEMBOLSO;;25.000`,
      `${d(3)};CAFETERIA LA ESQUINA;4.500;`,
      `${d(3)};PANADERIA LA ESPIGA;3.200;`,
      `${d(4)};CINE ESTRELLA BOLETERIA;9.800;`,
      `${d(5)};PAGO TIENDA ONLINE;19.990;`,
      `${d(5)};COBRO SIN FECHA VALIDA;5.000;`.replace(d(5), '31/02/2026'),
    ];
    if (dup) {
      const [y, m, dd] = dup.date.split('-');
      lines.push(`${dd}/${m}/${y};${dup.description};${L.formatAmount(-dup.amount)};`);
    }
    return lines.join('\n');
  }

  global.LedgerData = { seed, sampleStatement };
})(window);
