// js/app.js
(function(){
  let reader;
  let streamTrack;
  let torchOn = false;
  let currentCart = null;          // siempre se pide por prompt
  let carts = [];                  // [{id, bags:[] }]
  let allCodes = new Set();        // duplicados globales
  let deviceId = null;

  const $ = sel => document.querySelector(sel);

  // ====== helpers cámara ======
  async function getVideoInputsFallback(){
    if(navigator.mediaDevices?.enumerateDevices){
      const devs = await navigator.mediaDevices.enumerateDevices();
      return devs.filter(d => d.kind === 'videoinput').map(d => ({ deviceId: d.deviceId, label: d.label }));
    }
    return [];
  }

  async function listarCamaras() {
    try{
      let devs = [];
      if (ZXing.BrowserCodeReader?.listVideoInputDevices) {
        devs = await ZXing.BrowserCodeReader.listVideoInputDevices();
      } else {
        devs = await getVideoInputsFallback();
      }
      const sel = $("#cameraSelect");
      sel.innerHTML = "";
      devs.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || `Cam ${d.deviceId.substring(0,6)}...`;
        sel.appendChild(opt);
      });
      const env = devs.find(d => /back|rear|environment/i.test(d.label||''));
      sel.value = env?.deviceId || (devs[0] && devs[0].deviceId) || "";
    }catch(e){
      alert("No pude listar cámaras: " + e.message);
    }
  }

  // Reinicia el lector manteniendo la misma cámara (usado al cambiar de carro)
  async function restartScan(){
    if(reader){ try{ reader.reset(); }catch{} }
    reader = new ZXing.BrowserMultiFormatReader();
    const video = $("#preview");

    await reader.decodeFromVideoDevice(deviceId, video, (result)=>{
      if(!result) return;
      const code = String(result.text || "").trim();
      if(!code) return;

      if(allCodes.has(code)){
        alert("Código duplicado: " + code);
        if(navigator.vibrate) navigator.vibrate(200);
        return;
      }
      allCodes.add(code);
      const carro = carts.find(c=> String(c.id)===String(currentCart));
      if(carro){
        carro.bags.push(code);
        actualizarInfo();
      }
    });

    // capacidades (torch, focus, tap-to-focus)
    const stream = video.srcObject;
    const tracks = stream ? stream.getVideoTracks() : [];
    streamTrack = tracks[0];
    $("#btnTorch").disabled = true;
    if(streamTrack){
      const caps = streamTrack.getCapabilities ? streamTrack.getCapabilities() : {};
      if(caps.torch){ $("#btnTorch").disabled = false; }
      const cons = {};
      if(caps.focusMode && caps.focusMode.includes("continuous")){
        cons.advanced = [{ focusMode: "continuous" }];
      }
      if(Object.keys(cons).length){ try{ await streamTrack.applyConstraints(cons); }catch{} }
      video.addEventListener('click', async (ev)=>{
        const rect = video.getBoundingClientRect();
        const x = (ev.clientX - rect.left) / rect.width;
        const y = (ev.clientY - rect.top) / rect.height;
        if(streamTrack?.applyConstraints){
          try{ await streamTrack.applyConstraints({ advanced: [{ pointsOfInterest: [{x, y}] }] }); }catch{}
        }
      });
    }
  }

  // ====== flujo ======
  async function iniciar(){
    const vuelo = $("#vuelo").value.trim();
    const dia = $("#dia").value.trim();
    const maletero = $("#maletero").value.trim();
    if(!vuelo || !dia || !maletero){ alert("Completá vuelo, día y maletero"); return; }

    const first = prompt("Número de carro inicial:");
    if(!first){ alert("Debés ingresar un número de carro"); return; }
    currentCart = String(first).trim();

    carts = [{ id: currentCart, bags: [] }];
    allCodes = new Set();

    $("#badgeVuelo").textContent = "Vuelo " + vuelo;
    $("#badgeCarro").textContent = "Carro " + currentCart;
    $("#badgeContador").textContent = "0 valijas";

    $("#form").style.display = "none";
    $("#scanner").style.display = "block";

    deviceId = $("#cameraSelect").value || null;
    // Primera vez: iniciar y listar cámaras (para que aparezcan labels)
    await restartScan();
    await listarCamaras();
  }

  function actualizarInfo(){
    $("#badgeCarro").textContent = "Carro " + currentCart;
    $("#badgeContador").textContent = totalBags() + " valijas";

    let html = "";
    for(const c of carts){
      html += `<b>Carro ${c.id}</b>: ${c.bags.length} valijas<br>`;
    }
    $("#info").innerHTML = html;
  }

  function totalBags(){
    let t = 0; carts.forEach(c=> t+=c.bags.length); return t;
  }

  async function siguienteCarro(){
    const next = prompt("Número de siguiente carro:");
    if(!next) return;
    currentCart = String(next).trim();
    if(!carts.find(c=> String(c.id)===currentCart)){
      carts.push({ id: currentCart, bags: [] });
    }
    actualizarInfo();
    // **Clave:** reiniciar lector al cambiar de carro
    await restartScan();
  }

  function renderResumen(){
    const vuelo = $("#vuelo").value;
    const dia = $("#dia").value;
    const maletero = $("#maletero").value;

    // layout centrado
    const wrap = document.createElement('div');
    wrap.style.textAlign = 'center';

    const pDia = document.createElement('div');
    pDia.style.fontWeight = '700';
    pDia.style.fontSize = '18px';
    pDia.textContent = `Día: ${dia}`;
    wrap.appendChild(pDia);

    const pVuelo = document.createElement('div');
    pVuelo.textContent = `Vuelo: ${vuelo}`;
    wrap.appendChild(pVuelo);

    const pMal = document.createElement('div');
    pMal.textContent = `Maletero: ${maletero}`;
    wrap.appendChild(pMal);

    const pTot = document.createElement('div');
    pTot.style.margin = '8px 0';
    pTot.innerHTML = `<b>Total de bags:</b> ${totalBags()}`;
    wrap.appendChild(pTot);

    // Carros desplegables
    const list = document.createElement('div');
    list.style.textAlign = 'left';
    list.style.margin = '0 auto';
    list.style.maxWidth = '540px';

    carts.forEach(c=>{
      const item = document.createElement('div');
      item.style.border = '1px solid #eee';
      item.style.borderRadius = '8px';
      item.style.margin = '6px 0';
      item.style.padding = '8px';
      item.style.background = '#fffbe6';

      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.cursor = 'pointer';
      header.innerHTML = `<b>Carro ${c.id}</b> <span>${c.bags.length} bags ▾</span>`;
      item.appendChild(header);

      const detail = document.createElement('div');
      detail.style.display = 'none';
      detail.style.padding = '6px 0 0 0';
      detail.innerHTML = `<ul style="margin:0; padding-left:18px">${c.bags.map(b=>`<li>${b}</li>`).join('')}</ul>`;
      item.appendChild(detail);

      header.addEventListener('click', ()=>{
        detail.style.display = (detail.style.display==='none') ? 'block' : 'none';
      });

      list.appendChild(item);
    });

    wrap.appendChild(list);
    $("#res").innerHTML = '';
    $("#res").appendChild(wrap);
  }

  function finalizar(){
    $("#scanner").style.display = "none";
    $("#resumen").style.display = "block";
    renderResumen();
    if(reader){ try{ reader.reset(); }catch{} }
  }

  function cancelar(){
    if(reader){ try{ reader.reset(); }catch{} }
    location.reload();
  }

  async function toggleTorch(){
    if(!streamTrack) return;
    try{
      torchOn = !torchOn;
      await streamTrack.applyConstraints({ advanced: [{ torch: torchOn }] });
      $("#btnTorch").textContent = torchOn ? "Linterna (ON)" : "Linterna";
    }catch(e){
      alert("Tu dispositivo no permite controlar la linterna");
    }
  }

  // ====== Guardado en Google Sheets ======
  async function guardarEnSheet(){
    if(!WEBAPP_URL){ alert("No hay WebApp configurada (editá js/config.js)"); return; }

    const payload = {
      day: $("#dia").value.trim(),
      flight: $("#vuelo").value.trim(),
      porter: $("#maletero").value.trim(),
      total: totalBags(),
      carts: carts.map(c=> ({id: c.id, count: c.bags.length})),
      codes: Array.from(allCodes)
    };

    try{
      // Intento 1: CORS normal
      const res = await fetch(WEBAPP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        mode: "cors",
        cache: "no-store",
      });
      if(!res.ok) throw new Error("HTTP " + res.status);
      // Si tu WebApp devuelve JSON, esto funciona:
      await res.json().catch(()=>({}));
      alert("Guardado en Google Sheet ✔️");
    }catch(err){
      // Intento 2: no-cors (no podremos leer respuesta, pero envía)
      try{
        await fetch(WEBAPP_URL, {
          method: "POST",
          body: JSON.stringify(payload),
          mode: "no-cors"
        });
        alert("Enviado (modo no-cors). Verifica en tu Google Sheet.");
      }catch(e2){
        alert("No se pudo guardar en Sheet: " + e2.message);
      }
    }
  }

  // ====== eventos ======
  document.addEventListener('DOMContentLoaded', async ()=>{
    $("#btnStart").addEventListener('click', iniciar);
    $("#btnNextCart").addEventListener('click', ()=>{ siguienteCarro(); });
    $("#btnFinish").addEventListener('click', finalizar);
    $("#btnCancel").addEventListener('click', cancelar);
    $("#btnTorch").addEventListener('click', toggleTorch);
    $("#btnSave").addEventListener('click', guardarEnSheet);
    $("#btnNew").addEventListener('click', ()=>location.reload());

    try{ await navigator.mediaDevices.getUserMedia({ video: true }); }catch{}
    await listarCamaras();
  });
})();
