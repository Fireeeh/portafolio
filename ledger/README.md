# Ledger · Demo pública

Versión demostrativa de **Ledger**, la aplicación de finanzas personales
(Next.js 15 + Neon Postgres), preparada para un portafolio. Muestra la misma
interfaz y las mismas reglas de negocio, pero corre entera en el navegador con
datos ficticios. No tiene servidor, base de datos ni dependencias.

## Funcionalidades incluidas

| # | Funcionalidad | Qué se puede hacer | Por qué está |
|---|---|---|---|
| 1 | **Inicio: cuánto puedo gastar hoy** | Ver patrimonio, ingresos, gastos y saldo sin asignar; el monto disponible para hoy se recalcula con cada gasto; flujo de caja de 6 meses con tooltip; gasto por categoría con anillo interactivo y barras contra lo asignado. | Es la pantalla que resume el valor del producto en 5 segundos: una respuesta concreta ("hoy puedes gastar $ X") en vez de solo tablas. |
| 2 | **Registro de movimientos** | Crear, editar y borrar con "Deshacer"; atajos de gastos frecuentes (calculados del historial); la categoría se sugiere sola según las reglas; buscar y filtrar por tipo, categoría y mes. | Es el flujo de uso diario. Muestra validación de formularios, estados vacíos y retroalimentación inmediata. |
| 3 | **Plan mensual por prioridades (N1–N7)** | Simular el ingreso con un control deslizante o escenarios ("bajan los ingresos 30 %", "llega un bono"); editar lo que pide cada categoría; ver cómo el motor recorta por niveles y qué alertas genera; confirmar el plan para que Inicio use esos montos. | Es la pieza técnica más distintiva: un motor de reparto determinista con estrategias secuencial y proporcional. |
| 4 | **Metas de ahorro** | Ver progreso, faltante, aporte requerido y riesgo; simular el aporte mensual y ver la fecha estimada; aportar o liberar dinero; crear metas nuevas que entran solas al plan. | Muestra reglas de dominio reales: un aporte es reserva, no gasto, y lo reservado nunca supera el saldo de la cuenta. |
| 5 | **Importar cartola CSV** | Cargar la cartola de ejemplo o subir un CSV; vista previa con categoría sugerida por regla, detección de duplicados y filas con error; crear reglas nuevas y ver la vista previa actualizarse; importar con "Deshacer". | Resuelve un problema real (cargar movimientos del banco) y muestra el parser de formatos chilenos de fechas y montos. |

Además: tema claro y oscuro, diseño adaptable (barra lateral en escritorio y
barra inferior en móvil), navegación con teclado, foco visible, tabla
alternativa del gráfico para lectores de pantalla y respeto de
`prefers-reduced-motion`.

## Ejecutar y publicar

La demo vive dentro del portafolio, en la carpeta `ledger/`, y GitHub Pages la
publica junto con el resto del sitio en
<https://fireeeh.github.io/portafolio/ledger/>. No hay compilación: subir los
cambios a `main` basta.

En local, desde la raíz del portafolio:

```bash
python -m http.server 5500
```

y abrir <http://localhost:5500/ledger/>. También funciona abriendo
`ledger/index.html` con doble clic, porque los scripts son clásicos (no módulos).

Al cambiar CSS o JS, subir el número de `?v=` en `index.html` para que los
navegadores no usen la versión en caché.

Recorrido sugerido para mostrarla (2 minutos):

1. **Inicio:** tocar un atajo frecuente, guardar y ver cómo baja "Hoy puedes gastar".
2. **Plan:** pulsar "Bajan los ingresos 30 %" y ver los recortes por nivel y las alertas.
3. **Metas:** mover el simulador de aporte de "Viaje a Japón".
4. **Importar:** "Cargar cartola de ejemplo", crear la regla `panaderia` → Supermercado e importar.
5. Botón **Restablecer** de la banda superior para volver al estado inicial.

## Arquitectura

```
ledger-demo/
  index.html        Estructura (banda de demo, navegación, modal, avisos) y carga de scripts
  icon.svg          Ícono de Ledger
  css/styles.css    Tokens de color y tipografía de Ledger, componentes y responsive
  js/logic.js       Lógica pura: formato, reglas, motor del plan, metas, "hoy puedo gastar", lector CSV
  js/data.js        Generador de datos ficticios con semilla fija y cartola de ejemplo
  js/charts.js      Gráfico de área y anillo en SVG propio
  js/app.js         Estado, vistas por ruta (#/inicio, #/movimientos, #/plan, #/metas, #/importar) y eventos
```

- **Sin compilación ni dependencias.** HTML, CSS y JavaScript del navegador.
  Lo único externo son las fuentes de Google Fonts (Fraunces, Geist, Geist
  Mono); sin conexión se usan las fuentes del sistema.
- **Estado único.** `app.js` guarda un objeto de estado; cada vista se dibuja
  a partir de `derive()`, que calcula todo (saldos, plan, alertas, atajos) desde
  ese estado. Las partes que cambian al arrastrar un control (resultados del
  plan, simulador de metas, lista filtrada) se redibujan solas, sin perder el foco.
- **Lógica separada de la interfaz.** `logic.js` no toca el DOM: recibe datos y
  devuelve resultados, por eso se puede probar con Node.
- **Datos ficticios.** `data.js` genera seis meses de movimientos que terminan
  hoy con un generador pseudoaleatorio de semilla fija. Comercios, nombres y
  montos son inventados.

### Qué se reutilizó del sistema principal

Solo lo visual y el conocimiento del dominio, **copiado y reescrito**, nunca
importado:

- Paleta, tipografías y estilos de `ledger/app/globals.css`.
- Estructura de navegación de `AppShell`, diseño de KPIs, "cuánto puedo gastar
  hoy", lista de movimientos, gráficos `AreaChart` y `DonutChart` (portados de
  React a JavaScript).
- Versiones simplificadas de los módulos puros `lib/format.ts`,
  `lib/category-rules.ts`, `lib/planning/daily-allowance.ts`,
  `lib/planning/engine.ts`, `lib/goals/metrics.ts` y `lib/import/statement.ts`.

El motor del plan de la demo es una versión reducida: mantiene los siete
niveles y las estrategias secuencial y proporcional, pero no incluye política de
ingresos, arrastres entre meses, mínimos ni máximos por línea.

## Aislamiento respecto del sistema principal

| Riesgo | Cómo se evita |
|---|---|
| Acceso a la base de datos | No hay cliente de Postgres, cadena de conexión ni variables de entorno. |
| Llamadas a la API o a servicios | El código no usa `fetch`, `XMLHttpRequest` ni WebSocket. Se puede comprobar con `grep -rn "fetch\|XMLHttpRequest\|WebSocket" js/`. |
| Reutilizar lógica con acceso a datos | Nada se importa desde la app; los módulos copiados son puros. |
| Impacto en producción | Vive en el repositorio del portafolio, fuera del repositorio de la app, de su compilación, su CI y su despliegue en Render. No se modificó ningún archivo de la app. |
| Datos personales | Todos los datos se generan en el navegador. No se leyeron respaldos, el Excel ni la base. |
| Persistencia | Los cambios del visitante quedan solo en `localStorage` de su navegador, con claves propias (`ledger-demo-state-v1`, `ledger-demo-theme`) que no coinciden con las de la app real. "Restablecer" los borra. |

## Mantenimiento

- Agregar una funcionalidad: una función `viewX(d)` en `app.js`, su entrada en
  `ROUTES` y un enlace en `index.html`.
- Cambiar los datos: editar las listas de `data.js` (categorías, compromisos,
  gastos variables, metas). La semilla fija hace que todos los visitantes vean
  lo mismo.
- Cambiar el formato del estado guardado: subir `version` en `data.js` y
  `STORE_KEY` en `app.js` para que los visitantes anteriores reciban datos nuevos.
