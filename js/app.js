// js/app.js (sin carros)
(function(){
  let reader;
  let streamTrack;
  let torchOn = false;
<<<<<<< HEAD
  let deviceId = null;

  // Códigos únicos (evita duplicados)
  let allCodes = new Set();

  // Confirmación / edición
  let confirming = false;

  // Sonidos
  const soundOk  = new Audio('sounds/beep_ok.wav');
=======
  let currentCart = null;
  let carts = [];                  // [{id, bags:[] }]
  let allCodes = new Set();        // duplicados globales
  let deviceId = null;

  // confirmación / edición
  let confirming = false;
  let pendingCode = null;

  // sonidos
  const soundOk = new Audio('sounds/beep_ok.wav');
>>>>>>> d10e0654fbe42515902202b576a40836b109c5a3
  const soundErr = new Audio('sounds/beep_err.wav');

  const $ = sel => document.querySelector(sel);

<<<<<<< HEAD
  // ====== Cámara ======
=======
  // ====== cámara ======
>>>>>>> d10e0654fbe42515902202b576a40836b109c5a3
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
<<<<<<< HEAD

      // selector inicial
=======
      // select inicial
>>>>>>> d10e0654fbe42515902202b576a40836b109c5a3
      const selInit = $("#cameraSelect");
      if (selInit) {
        selInit.innerHTML = "";
        devs.forEach(d => {
          const opt = document.createElement('option');
          opt.value = d.deviceId;
          opt.textContent = d.label || `Cam ${d.deviceId.substring(0,6)}...`;
          selInit.appendChild(opt);
        });
        const env = devs.find(d => /back|rear|environment/i.test(d.label||''));
        selInit.value = env?.deviceId || (devs[0]?.deviceId || "");
      }
<<<<<<< HEAD

      // selector en vivo
=======
      // select en vivo
>>>>>>> d10e0654fbe42515902202b576a40836b109c5a3
      const selLive = $("#cameraSelectLive");
      if (selLive) {
        selLive.innerHTML = "";
        devs.forEach(d => {
          const opt = document.createElement('option');
          opt.value = d.deviceId;
          opt.textContent = d.label || `Cam ${d.deviceId.substring(0,6)}...`;
          selLive.appendChild(opt);
        });
        selLive.value = deviceId || (devs.find(d => /back|rear|environment/i.test(d.label||''))?.deviceId) || (devs[0]?.deviceId || "");
      }
    }catch(e){
      alert("No pude listar cámaras: " + e.message);
    }
  }

  async function restartScan(){
    if(reader){ try{ reader.reset(); }catch{} }
    reader = new ZXing.BrowserMultiFormatReader();
    const video = $("#preview");

    await reader.decodeFromVideoDevice(deviceId, video, (result)=>{
      if(!result || confirming) return;
<<<<<<< HEAD
      const raw = String(result.text || "").trim();
      if(!raw) return;

      // abrir modal con input editable
      confirming = true;
      $("#codeEdit").value = raw;

      // duplicado?
      const isDup = allCodes.has(raw);
=======
      const code = String(result.text || "").trim();
      if(!code) return;
      // abrir modal con el código, editable
      pendingCode = code;
      confirming = true;
      $("#codeEdit").value = code;
      const isDup = allCodes.has(code);
>>>>>>> d10e0654fbe42515902202b576a40836b109c5a3
      $("#dupWarn").style.display = isDup ? 'block' : 'none';
      if(isDup){ try{ soundErr.currentTime = 0; soundErr.play(); }catch{} }

      $("#confirmModal").style.display = "flex";
      $("#codeEdit").focus();
      $("#codeEdit").select();
    });

<<<<<<< HEAD
    // Torch / autofocus / tap-to-focus
=======
    // capacidades (torch/focus)
>>>>>>> d10e0654fbe42515902202b576a40836b109c5a3
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
      if(Object.keys(cons).length){
        try{ await streamTrack.applyConstraints(cons); }catch{}
      }

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

<<<<<<< HEAD
  // ====== Flujo ======
=======
  // ====== flujo ======
>>>>>>> d10e0654fbe42515902202b576a40836b109c5a3
  async function iniciar(){
    const vuelo    = $("#vuelo").value.trim();
    const dia      = $("#dia").value.trim();
    const maletero = $("#maletero").value.trim();
    if(!vuelo || !dia || !maletero){
      alert("Completá vuelo, día y maletero");
      return;
    }

    allCodes = new Set();
    $("#badgeVuelo").textContent    = "Vuelo " + vuelo;
    $("#badgeContador").textContent = "0 valijas";

    $("#form").style.display    = "none";
    $("#scanner").style.display = "block";

    deviceId = $("#cameraSelect").value || deviceId || null;
    await restartScan();
    await listarCamaras();
  }

  function actualizarContador(){
    $("#badgeContador").textContent = `${allCodes.size} valijas`;
  }

  function renderResumen(){
    const vuelo    = $("#vuelo").value;
    const dia      = $("#dia").value;
    const maletero = $("#maletero").value;

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
    pTot.innerHTML = `<b>Total de bags:</b> ${allCodes.size}`;
    wrap.appendChild(pTot);

    const list = document.createElement('div');
    list.style.textAlign = 'left';
    list.style.margin = '0 auto';
    list.style.maxWidth = '540px';

    const ul = document.createElement('ul');
    ul.style.margin = '0';
    ul.style.paddingLeft = '18px';
    Array.from(allCodes).forEach(code=>{
      const li = document.createElement('li');
      li.textContent = code;
      ul.appendChild(li);
    });
    list.appendChild(ul);

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

<<<<<<< HEAD
  // ====== Confirmación / edición ======
=======
  // ====== confirmación / edición ======
>>>>>>> d10e0654fbe42515902202b576a40836b109c5a3
  function hideConfirm(){
    $("#confirmModal").style.display = "none";
    confirming = false;
  }

  function acceptCode(){
    const edited = ($("#codeEdit").value || "").trim();
<<<<<<< HEAD
    if(!edited){
      try{ soundErr.currentTime = 0; soundErr.play(); }catch{}
      alert("Código vacío.");
      return;
    }
    if(allCodes.has(edited)){
      try{ soundErr.currentTime = 0; soundErr.play(); }catch{}
      alert("Código duplicado: " + edited);
      if(navigator.vibrate) navigator.vibrate(200);
      return; // mantener modal para corregir
=======
    if(!edited){ try{ soundErr.currentTime = 0; soundErr.play(); }catch{}; alert("Código vacío."); return; }

    // si el editado es duplicado global
    if(allCodes.has(edited)){
      try{ soundErr.currentTime = 0; soundErr.play(); }catch{}
      alert("Código duplicado: " + edited);
      if(navigator.vibrate) navigator.vibrate(200);
      return; // mantener modal abierto para que lo corrija
>>>>>>> d10e0654fbe42515902202b576a40836b109c5a3
    }

    try{ soundOk.currentTime = 0; soundOk.play(); }catch{}
    allCodes.add(edited);
<<<<<<< HEAD
    actualizarContador();
=======
    const carro = carts.find(c=> String(c.id)===String(currentCart));
    if(carro){
      carro.bags.push(edited);
      actualizarInfo();
    }
>>>>>>> d10e0654fbe42515902202b576a40836b109c5a3
    hideConfirm();
  }

  function retryCode(){
    try{ soundErr.currentTime = 0; soundErr.play(); }catch{}
    hideConfirm();
  }

<<<<<<< HEAD
  // ====== Gestor de códigos (eliminar con doble confirmación) ======
=======
  // ====== gestor de códigos ======
>>>>>>> d10e0654fbe42515902202b576a40836b109c5a3
  function openCodesManager(){
    const cont = $("#codesList");
    cont.innerHTML = "";

<<<<<<< HEAD
    if(allCodes.size === 0){
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = '(sin códigos)';
      cont.appendChild(empty);
    } else {
      Array.from(allCodes).forEach((code, idx)=>{
=======
    // Listar por carro
    carts.forEach(c=>{
      const title = document.createElement('div');
      title.className = 'code-cart';
      title.textContent = `Carro ${c.id}`;
      cont.appendChild(title);

      if(!c.bags.length){
        const empty = document.createElement('div');
        empty.className = 'muted';
        empty.textContent = '(sin códigos)';
        cont.appendChild(empty);
        return;
      }

      c.bags.forEach((code, idx)=>{
>>>>>>> d10e0654fbe42515902202b576a40836b109c5a3
        const row = document.createElement('div');
        row.className = 'code-item';

        const left = document.createElement('div');
        left.innerHTML = `<span>${code}</span> <small>#${idx+1}</small>`;

        const del = document.createElement('button');
        del.className = 'code-del';
        del.textContent = '🗑️';
        del.addEventListener('click', ()=>{
<<<<<<< HEAD
=======
          // doble confirmación
>>>>>>> d10e0654fbe42515902202b576a40836b109c5a3
          const c1 = confirm(`¿Eliminar el código ${code}?`);
          if(!c1) return;
          const c2 = confirm(`Confirmar eliminación definitiva de ${code}?`);
          if(!c2) return;

<<<<<<< HEAD
          allCodes.delete(code);
          actualizarContador();
          openCodesManager(); // refrescar lista
=======
          // quitar de carro y del set global
          const pos = c.bags.indexOf(code);
          if(pos >= 0){
            c.bags.splice(pos, 1);
          }
          // si ese código ya no está en ningún carro, lo sacamos del set global
          const stillExists = carts.some(cc => cc.bags.includes(code));
          if(!stillExists){
            allCodes.delete(code);
          }

          // refrescar UI
          actualizarInfo();
          openCodesManager(); // recargar listado
>>>>>>> d10e0654fbe42515902202b576a40836b109c5a3
        });

        row.appendChild(left);
        row.appendChild(del);
        cont.appendChild(row);
      });
<<<<<<< HEAD
    }

    $("#codesModal").style.display = 'flex';
  }
  function closeCodesManager(){ $("#codesModal").style.display = 'none'; }

  // ====== Guardar en Sheets (sin carros) ======
=======
    });

    $("#codesModal").style.display = 'flex';
  }

  function closeCodesManager(){
    $("#codesModal").style.display = 'none';
  }

  // ====== guardar en Sheets ======
>>>>>>> d10e0654fbe42515902202b576a40836b109c5a3
  async function guardarEnSheet(){
    if(!WEBAPP_URL){ alert("No hay WebApp configurada (editá js/config.js)"); return; }
    const payload = {
      day: $("#dia").value.trim(),
      flight: $("#vuelo").value.trim(),
      porter: $("#maletero").value.trim(),
      total: allCodes.size,
      codes: Array.from(allCodes)
    };

    // Intento con CORS (si GAS lo permite)
    try{
      const res = await fetch(WEBAPP_URL, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
<<<<<<< HEAD
      let ok = false;
      try { ok = !!(await res.json())?.ok; } catch {}
      if (ok) { alert("Guardado en Google Sheet ✔️"); return; }
    }catch{}

    // Fallback sin lectura (no-CORS)
    try{
      await fetch(WEBAPP_URL, { method:"POST", mode:"no-cors", body: JSON.stringify(payload) });
      alert("Guardado enviado ✔️\nVerificá la hoja DATA para confirmar la fila.");
    }catch(e2){
      alert("No se pudo guardar en Sheet: " + e2.message);
    }
  }

  // ====== Eventos ======
=======
      if(!res.ok) throw new Error("HTTP " + res.status);
      await res.json().catch(()=>({}));
      alert("Guardado en Google Sheet ✔️");
    }catch(err){
      try{
        await fetch(WEBAPP_URL, { method: "POST", body: JSON.stringify(payload), mode: "no-cors" });
        alert("Guardado en Google Sheet ✔️ ");
      }catch(e2){
        alert("No se pudo guardar en Sheet: " + e2.message);
      }
    }
  }

  // ====== eventos ======
>>>>>>> d10e0654fbe42515902202b576a40836b109c5a3
  document.addEventListener('DOMContentLoaded', async ()=>{
    $("#btnStart").addEventListener('click', iniciar);
    $("#btnFinish").addEventListener('click', finalizar);
    $("#btnCancel").addEventListener('click', cancelar);
    $("#btnTorch").addEventListener('click', toggleTorch);
    $("#btnSave").addEventListener('click', guardarEnSheet);
    $("#btnNew").addEventListener('click', ()=>location.reload());

    $("#btnAccept").addEventListener('click', acceptCode);
    $("#btnRetry").addEventListener('click', retryCode);

<<<<<<< HEAD
    $("#btnManageCodes")?.addEventListener('click', openCodesManager);
    $("#btnCloseCodes")?.addEventListener('click', closeCodesManager);
=======
    $("#btnManageCodes").addEventListener('click', openCodesManager);
    $("#btnCloseCodes").addEventListener('click', closeCodesManager);
>>>>>>> d10e0654fbe42515902202b576a40836b109c5a3

    $("#cameraSelectLive").addEventListener('change', async (e)=>{
      deviceId = e.target.value || null;
      await restartScan();
    });

    try{ await navigator.mediaDevices.getUserMedia({ video: true }); }catch{}
    await listarCamaras();
  });
})();
