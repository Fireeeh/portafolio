// Año footer
document.getElementById('year').textContent = new Date().getFullYear();

// Contador de visitas global con CountAPI
(function initVisitorCounter(){
  const countEl = document.getElementById('visitorCount');
  if(!countEl) return;
  
  // Namespace único para tu portafolio (puedes cambiarlo)
  const NAMESPACE = 'mackarena-portfolio';
  const KEY = 'visits';
  const API_URL = `https://api.countapi.xyz/hit/${NAMESPACE}/${KEY}`;
  
  // Estado de carga
  countEl.textContent = '👁 ...';
  countEl.style.opacity = '0.5';
  
  // Llamada a la API
  fetch(API_URL)
    .then(response => response.json())
    .then(data => {
      const count = data.value;
      countEl.textContent = `👁 ${count.toLocaleString('es-ES')} ${count === 1 ? 'visita' : 'visitas'}`;
      countEl.style.opacity = '';
    })
    .catch(error => {
      // Fallback a localStorage si falla la API
      console.warn('CountAPI no disponible, usando contador local:', error);
      const STORAGE_KEY = 'portfolioVisitCount';
      let count = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
      count++;
      localStorage.setItem(STORAGE_KEY, count.toString());
      countEl.textContent = `👁 ${count.toLocaleString('es-ES')} (local)`;
      countEl.style.opacity = '';
    });
})();

// Tema Oscuro <-> Crema
const html = document.documentElement;
const themeBtn = document.getElementById('themeBtn');

function setTheme(next){
  html.setAttribute('data-theme', next);
  themeBtn.textContent = next === 'dark' ? 'Tema: Oscuro' : 'Tema: Crema';
  themeBtn.setAttribute('aria-label', next === 'dark' ? 'Cambiar a tema crema' : 'Cambiar a tema oscuro');
}

setTheme(html.getAttribute('data-theme') || 'dark');

themeBtn.addEventListener('click', () => {
  const current = html.getAttribute('data-theme');
  setTheme(current === 'dark' ? 'cream' : 'dark');
});

// Reveal
const revealEls = document.querySelectorAll('.reveal');
const io = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if(e.isIntersecting){
      e.target.classList.add('is-visible');
      io.unobserve(e.target);
    }
  });
}, { threshold: 0.12 });

revealEls.forEach(el => io.observe(el));

// =========================
// Sakura petals (fondo)
// viento ALEATORIO activado por scroll
// =========================
(function sakuraInit(){
  const layer = document.querySelector('.sakura');
  if(!layer) return;

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(prefersReduced) return;

  const MAX = 26;
  const SPAWN_EVERY_MS = 650;

  function rand(min, max){ return Math.random() * (max - min) + min; }

  // viento actual y objetivo
  let wind = 0;
  let targetWind = 0;

  // intensidad base del viento
  let windEnergy = 0;

  let lastScrollY = window.scrollY;

  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    const dy = y - lastScrollY;

    // usamos solo la magnitud del scroll
    const strength = Math.min(Math.abs(dy) * 0.9, 60);

    // activamos energía de viento
    windEnergy += strength;

    lastScrollY = y;
  }, { passive:true });

  function createPetal(){
    const p = document.createElement('span');
    p.className = 'petal';

    const startX = rand(0, 100);
    const size = rand(14, 22);
    const duration = rand(18, 30);       // más lento
    const drift = rand(-55, 55);
    const delay = rand(-25, 0);

    p.style.left = `${startX}vw`;
    p.style.width = `${size}px`;
    p.style.height = `${size * 0.78}px`;
    p.style.opacity = rand(0.18, 0.34).toFixed(2);

    p.style.setProperty('--drift', `${drift}px`);
    p.style.setProperty('--r0', `${rand(0,360)}deg`);
    p.style.setProperty('--r1', `${rand(420,980)}deg`);
    p.style.setProperty('--windX', '0px');

    p.style.animation = `
      fall ${duration}s linear ${delay}s infinite,
      drift ${rand(4.5, 7.5)}s ease-in-out ${rand(0, 2)}s infinite
    `;

    layer.appendChild(p);

    setTimeout(() => {
      if(p.parentNode === layer) layer.removeChild(p);
    }, (duration + 10) * 1000);
  }

  for(let i = 0; i < MAX; i++) createPetal();

  setInterval(() => {
    if(layer.querySelectorAll('.petal').length < MAX){
      createPetal();
    }
  }, SPAWN_EVERY_MS);

  // LOOP PRINCIPAL
  function tick(){
    /* 1️⃣ Convertimos energía en ráfagas aleatorias */
    if(windEnergy > 1){
      const dir = Math.random() < 0.5 ? -1 : 1;
      targetWind += dir * windEnergy * rand(0.15, 0.35);
      windEnergy *= 0.6; // se disipa
    }

    /* 2️⃣ Limitamos viento */
    targetWind = Math.max(-80, Math.min(80, targetWind));

    /* 3️⃣ Suavizado */
    wind += (targetWind - wind) * 0.08;
    targetWind *= 0.9;

    /* 4️⃣ Aplicamos a pétalos */
    const petals = layer.querySelectorAll('.petal');
    petals.forEach((p, i) => {
      const factor = 0.55 + (i % 7) * 0.08;
      const localWind = wind * factor;
      p.style.setProperty('--windX', `${localWind.toFixed(2)}px`);
    });

    requestAnimationFrame(tick);
  }

  tick();
})();

