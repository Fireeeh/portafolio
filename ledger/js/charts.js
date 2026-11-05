/*
 * Gráficos en SVG propio, portados de ledger/app/components/AreaChart.tsx y
 * DonutChart.tsx a JavaScript sin React. Los colores salen de las variables
 * CSS del tema, así que cambian solos con claro/oscuro.
 */
(function (global) {
  'use strict';
  const L = global.LedgerLogic;

  function monotonePath(points) {
    if (points.length < 2) return '';
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const cx = (p0.x + p1.x) / 2;
      d += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
    }
    return d;
  }

  /** Ingresos y gastos por mes, con línea guía y tooltip al pasar el cursor. */
  function areaChart(el, data, height = 260) {
    const w = Math.max(280, el.clientWidth || 600);
    const pad = { top: 16, right: 10, bottom: 28, left: 54 };
    const innerW = w - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const maxV = Math.max(1, ...data.flatMap((d) => [d.income, d.expenses])) * 1.15;
    const xStep = data.length > 1 ? innerW / (data.length - 1) : 0;
    const xAt = (i) => pad.left + i * xStep;
    const yAt = (v) => pad.top + innerH - (v / maxV) * innerH;
    const inc = data.map((d, i) => ({ x: xAt(i), y: yAt(d.income) }));
    const exp = data.map((d, i) => ({ x: xAt(i), y: yAt(d.expenses) }));
    const base = pad.top + innerH;
    const area = (line) => `${line} L ${xAt(data.length - 1)} ${base} L ${xAt(0)} ${base} Z`;
    const incLine = monotonePath(inc);
    const expLine = monotonePath(exp);
    const ticks = [0, 1, 2, 3, 4].map((i) => (maxV * i) / 4);

    const rows = data.map((d) => `<tr><th scope="row">${d.label}</th><td>${L.formatMoney(d.income)}</td><td>${L.formatMoney(d.expenses)}</td></tr>`).join('');
    el.innerHTML = `
      <table class="sr-only"><caption>Ingresos y gastos por mes</caption>
        <thead><tr><th scope="col">Mes</th><th scope="col">Ingresos</th><th scope="col">Gastos</th></tr></thead>
        <tbody>${rows}</tbody></table>
      <svg aria-hidden="true" width="${w}" height="${height}" style="display:block;overflow:visible">
        <defs>
          <linearGradient id="gInc" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style="stop-color:var(--green);stop-opacity:.18"/><stop offset="100%" style="stop-color:var(--green);stop-opacity:0"/>
          </linearGradient>
          <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style="stop-color:var(--terracotta);stop-opacity:.16"/><stop offset="100%" style="stop-color:var(--terracotta);stop-opacity:0"/>
          </linearGradient>
        </defs>
        ${ticks.map((v) => `
          <line x1="${pad.left}" x2="${pad.left + innerW}" y1="${yAt(v)}" y2="${yAt(v)}" style="stroke:var(--hairline-soft)"/>
          <text x="${pad.left - 10}" y="${yAt(v)}" text-anchor="end" dominant-baseline="middle" font-size="11" style="fill:var(--muted);font-family:var(--font-mono)">$ ${Math.round(v / 1000)}k</text>`).join('')}
        <path d="${area(incLine)}" fill="url(#gInc)"/>
        <path d="${area(expLine)}" fill="url(#gExp)"/>
        <path d="${incLine}" fill="none" stroke-width="1.5" style="stroke:var(--green)"/>
        <path d="${expLine}" fill="none" stroke-width="1.5" style="stroke:var(--terracotta)"/>
        <line class="guide" x1="0" x2="0" y1="${pad.top}" y2="${base}" stroke-dasharray="3 3" style="stroke:var(--hairline);display:none"/>
        ${inc.map((p, i) => `<circle data-i="${i}" data-s="inc" cx="${p.x}" cy="${p.y}" r="3" stroke-width="1.5" style="stroke:var(--green);fill:var(--bg)"/>`).join('')}
        ${exp.map((p, i) => `<circle data-i="${i}" data-s="exp" cx="${p.x}" cy="${p.y}" r="3" stroke-width="1.5" style="stroke:var(--terracotta);fill:var(--bg)"/>`).join('')}
        ${data.map((d, i) => `<text class="xl" data-i="${i}" x="${xAt(i)}" y="${base + 18}" text-anchor="middle" font-size="11" style="fill:var(--muted)">${d.label}</text>`).join('')}
        <rect x="${pad.left}" y="0" width="${innerW}" height="${height}" fill="transparent" class="hit"/>
      </svg>
      <div class="chart-tip" style="display:none"></div>`;

    const svg = el.querySelector('svg');
    const tip = el.querySelector('.chart-tip');
    const guide = el.querySelector('.guide');
    const show = (i) => {
      el.querySelectorAll('circle').forEach((c) => {
        const on = Number(c.dataset.i) === i;
        const color = c.dataset.s === 'inc' ? 'var(--green)' : 'var(--terracotta)';
        c.setAttribute('r', on ? 5 : 3);
        c.style.fill = on ? color : 'var(--bg)';
      });
      el.querySelectorAll('.xl').forEach((t) => { t.style.fill = Number(t.dataset.i) === i ? 'var(--ink)' : 'var(--muted)'; });
      if (i === null) { guide.style.display = 'none'; tip.style.display = 'none'; return; }
      guide.setAttribute('x1', xAt(i)); guide.setAttribute('x2', xAt(i)); guide.style.display = '';
      const d = data[i];
      tip.innerHTML = `<div class="eyebrow" style="font-size:10px">${d.full}</div>
        <div class="row"><i style="background:var(--green)"></i><span>Ingresos</span><span class="num">${L.formatMoney(d.income)}</span></div>
        <div class="row"><i style="background:var(--terracotta)"></i><span>Gastos</span><span class="num">${L.formatMoney(d.expenses)}</span></div>
        <div class="row"><i></i><span>Neto</span><span class="num ${d.income - d.expenses < 0 ? 'danger' : ''}">${L.formatMoney(d.income - d.expenses, { signed: true })}</span></div>`;
      tip.style.left = `${Math.min(Math.max(xAt(i) - 85, 0), w - 180)}px`;
      tip.style.display = '';
    };
    svg.addEventListener('mousemove', (e) => {
      const rect = svg.getBoundingClientRect();
      const x = e.clientX - rect.left - pad.left;
      show(Math.max(0, Math.min(data.length - 1, Math.round(x / (xStep || 1)))));
    });
    svg.addEventListener('mouseleave', () => show(null));
  }

  /** Anillo por categoría; onHover(i) resalta la leyenda. */
  function donutSvg(slices, hovered, size = 200, inner = 62, outer = 92) {
    const total = slices.reduce((s, d) => s + d.value, 0) || 1;
    const c = size / 2;
    const gap = slices.length > 1 ? 0.012 : 0;
    let acc = 0;
    const paths = slices.map((d, i) => {
      if (d.value <= 0) return '';
      let sa = (acc / total) * 2 * Math.PI - Math.PI / 2 + gap;
      acc += d.value;
      let ea = (acc / total) * 2 * Math.PI - Math.PI / 2 - gap;
      if (ea - sa >= 2 * Math.PI - 0.001) ea = sa + 2 * Math.PI - 0.001;
      const large = ea - sa > Math.PI ? 1 : 0;
      const p = (r, a) => `${c + r * Math.cos(a)} ${c + r * Math.sin(a)}`;
      const path = `M ${p(outer, sa)} A ${outer} ${outer} 0 ${large} 1 ${p(outer, ea)} L ${p(inner, ea)} A ${inner} ${inner} 0 ${large} 0 ${p(inner, sa)} Z`;
      const op = hovered === null || hovered === i ? 1 : 0.28;
      return `<path data-slice="${i}" d="${path}" style="fill:${d.color};opacity:${op};transition:opacity .2s;cursor:pointer"/>`;
    });
    return `<svg viewBox="0 0 ${size} ${size}" style="width:100%;height:100%" aria-hidden="true">${paths.join('')}</svg>`;
  }

  global.LedgerCharts = { areaChart, donutSvg };
})(window);
