Flybondi Baggage Scanner — Vanilla JS (sin npm)
==============================================

Estructura:
- index.html
- css/style.css
- js/config.js  -> Poné tu URL de Google Apps Script (WEBAPP_URL) si querés guardar en Sheets.
- js/app.js     -> Lógica completa.

Cambios pedidos:
- Pide **número de carro** al iniciar, y en **Siguiente carro** también.
- Oculta el campo de URL de WebApp (se configura en `js/config.js`).
- Selector de cámara (tras dar permisos).
- Autofocus asistido (continuous focus si el dispositivo lo soporta y tap-to-focus).
- Botón de **Linterna** (si el hardware lo permite).
- Duplicados con alerta + vibración.
- Resumen final por carro y total.
- Guardar en Google Sheet en **una fila**: día, vuelo, maletero, total, JSON de carros y lista de códigos.

Google Apps Script:
- Usá el `apps_script.gs` que te pasé antes (o te lo vuelvo a compartir) y poné su URL en `js/config.js`.
