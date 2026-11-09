# ecoai pulse · Monitoreo de PM10 en Juan Mina (Barranquilla)

Prototipo web que muestra, en una sola vista, los **registros reales de PM10** de la estación **Juan Mina**
(SISAIRE-IDEAM), con un **pronóstico Random Forest** y la **detección de anomalías** positivas y negativas.
La página no usa datos simulados, telemetría ni otras estaciones.

## Contenido del paquete

| Archivo | Para qué sirve |
|---|---|
| `index.html`, `styles.css`, `app.js` | La aplicación (HTML, CSS y JavaScript, sin librerías). El Random Forest está programado desde cero en `app.js`. |
| `reporte_sisaire.csv` | Datos reales: 668 registros diarios de PM10, 1-mar-2022 a 31-may-2026 (reporte descargado de SISAIRE-IDEAM). Se carga solo al abrir la página. |
| `reporte_sisaire.js` | Copia del mismo CSV para que la página también funcione al abrirla con doble clic (`file://`), donde el navegador bloquea `fetch()`. Solo se usa si no se puede leer el CSV. |
| `evaluar_pm10.js` | Script de Node que reproduce las métricas del artículo y del informe (RF vs. persistencia, anomalías). |

## Cómo abrirla

1. **Doble clic en `index.html`**: funciona sin servidor (usa la copia integrada de los datos).
2. **Con servidor local**: `python -m http.server 8000` dentro de la carpeta y abrir <http://localhost:8000>. Lee `reporte_sisaire.csv` directamente.
3. **Enlace público reproducible**: subir la carpeta completa a un hosting estático (GitHub Pages, Netlify, Cloudflare Pages…).
   Deben subirse **todos** los archivos de esta carpeta. Si se actualiza `reporte_sisaire.csv`, regenerar también `reporte_sisaire.js`
   (es el mismo CSV dentro de una cadena: `window.SISAIRE_CSV = \`...\`;`).

La página también permite cargar otro CSV de SISAIRE con el botón **Cargar CSV** (columnas `Estacion`, `Fecha inicial`, `PM10`).

## Controles interactivos

- **Rango de la gráfica**: 30 d, 90 d, 1 año, Todo. Al pasar el cursor se ve la fecha, el valor, el pronóstico y las anomalías.
- **Panel «Explorar el modelo»** (abajo a la izquierda, se despliega con un clic):
  - *Ir al máximo* / *Ir al último*: salta a los episodios de PM10 más altos (marzo de 2022) o al final de la serie.
  - *Umbral de anomalía |z|*: cambia cuántas lecturas se marcan como anomalías (▲ positivas, ▼ negativas).
  - *Horizonte del pronóstico*: de 1 a 14 registros.
  - *Probar el pronóstico en el pasado*: elige una fecha del periodo de prueba y compara el pronóstico con lo que realmente ocurrió.
  - *Escenario hipotético*: ¿qué proyectaría el modelo si el PM10 fuera X? Se dibuja en morado y se rotula **«no son datos medidos»**; nunca se mezcla con la serie real.
- **Recargar datos**, **Cargar CSV** y **Descargar reporte** (serie, valor esperado, z, anomalías y pronóstico).

## Modelo y validación

- **Variable objetivo**: cambio de PM10 entre registros consecutivos (`y[t+1] − y[t]`).
- **Entradas (6)**: valor actual, rezagos de 1, 2 y 5 registros, promedio de 6 registros y tendencia `y[t] − y[t−3]`.
  No se usan hora del día ni variables meteorológicas (la serie es diaria y el archivo no las contiene).
  Los rezagos se cuentan en registros, no en días calendario (la serie tiene huecos).
- **Random Forest**: 40 árboles, profundidad máxima 7, mínimo 3 por hoja, 3 de 6 variables por división, bootstrap. Semilla 11.
- **Prueba piloto**: partición cronológica 80/20 sobre 661 ejemplos (528 de entrenamiento, 133 de prueba: 10-oct-2025 a 31-may-2026).
- **Línea base**: persistencia (repetir el último valor).
- **Anomalías**: residuo estandarizado `z = (observado − esperado) / σ` con σ = desviación estándar de los residuos de la prueba;
  anomalía si `|z| ≥ 2.5` (positiva: por encima de lo esperado; negativa: por debajo).
- **Referencias**: guía OMS 2021 (45 µg/m³, 24 h) y Resolución 2254 de 2017 (75 µg/m³, 24 h).

### Reproducir las métricas

```
node evaluar_pm10.js reporte_sisaire.csv
```

Resultado esperado (coincide con lo que muestra la página):

```
Persistencia: MAE 2.14  RMSE 2.75
Random Forest (semilla 11): MAE 2.10  RMSE 2.68
Random Forest (semillas 1-10): MAE 2.11 ± 0.03  RMSE 2.68 ± 0.04
Anomalías: 2025-11-16 (z −2.54), 2025-12-24 (z +3.29), 2025-12-25 (z −3.82)
```

## Limitaciones

- Una sola estación y un solo contaminante (PM10).
- La serie tiene un hueco sin registros entre el 31-may-2023 y el 1-mar-2025.
- El 20 % de prueba es un periodo de PM10 bajo (media 12.5 µg/m³) frente a la serie completa (33.4 µg/m³): no mide el desempeño en episodios altos.
- La mejora del Random Forest sobre la persistencia es pequeña y varía con la semilla.
- El umbral de anomalías se calibra con los mismos residuos que se evalúan (es descriptivo).
- Las alertas son apoyo a la interpretación; no reemplazan la evaluación regulatoria de la autoridad ambiental.

## Declaración de uso de inteligencia artificial

Se utilizó Claude (Anthropic), un modelo de lenguaje de inteligencia artificial generativa, en tres actividades:

1. **Software:** arquitectura de la aplicación (HTML, CSS y JavaScript) e implementación del Random Forest, de la línea base de persistencia, de la detección de anomalías y del script `evaluar_pm10.js`.
2. **Cálculos y verificación:** cálculo de las métricas, elaboración de las figuras y verificación de las cifras del artículo y del informe contra los datos y el código.
3. **Redacción:** apoyo en la redacción, la organización del texto y la corrección de estilo.

La obtención de los datos en SISAIRE-IDEAM, la selección de la estación y del contaminante, la revisión y prueba del software y la revisión de los resultados fueron realizadas por la autoría del trabajo, que se responsabiliza del contenido. Esta declaración coincide con la del artículo y la del informe.

## Datos

Fuente: SISAIRE-IDEAM, estación Juan Mina (SVCA de la EPA Barranquilla). Respetar las condiciones de acceso y atribución de la fuente.
