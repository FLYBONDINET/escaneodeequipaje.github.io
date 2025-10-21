// js/app.js
(function(){
  let reader;
  let streamTrack;
  let torchOn = false;
  let currentCart = null;
  let carts = [];                  // [{id, bags:[] }]
  let allCodes = new Set();        // duplicados globales
  let deviceId = null;

  // confirmación / edición
  let confirming = false;
  let pendingCode = null;

  // sonidos
  const soundOk = new Audio('sounds/beep_ok.wav');
  const soundErr = new Audio('sounds/beep_err.wav');

  const $ = sel => document.querySelector(sel);

  // ====== cámara ======
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
      // select inicial
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
        selInit.value = env?.deviceId || (devs[0] && devs[0].deviceId) || "";
      }
      // select en vivo
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
      const code = String(result.text || "").trim();
      if(!code) return;
      // abrir modal con el código, editable
      pendingCode = code;
      confirming = true;
      $("#codeEdit").value = code;
      const isDup = allCodes.has(code);
      $("#dupWarn").style.display = isDup ? 'block' : 'none';
      if(isDup){ try{ soundErr.currentTime = 0; soundErr.play(); }catch{} }
      $("#confirmModal").style.display = "flex";
      $("#codeEdit").focus();
      $("#codeEdit").select();
    });

    // capacidades (torch/focus)
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

    deviceId = $("#cameraSelect").value || deviceId || null;
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
    await restartScan();
  }

  function renderResumen(){
    const vuelo = $("#vuelo").value;
    const dia = $("#dia").value;
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
    pTot.innerHTML = `<b>Total de bags:</b> ${totalBags()}`;
    wrap.appendChild(pTot);

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

  // ====== confirmación / edición ======
  function hideConfirm(){
    $("#confirmModal").style.display = "none";
    confirming = false;
    pendingCode = null;
  }

  function acceptCode(){
    const edited = ($("#codeEdit").value || "").trim();
    if(!edited){ try{ soundErr.currentTime = 0; soundErr.play(); }catch{}; alert("Código vacío."); return; }

    // si el editado es duplicado global
    if(allCodes.has(edited)){
      try{ soundErr.currentTime = 0; soundErr.play(); }catch{}
      alert("Código duplicado: " + edited);
      if(navigator.vibrate) navigator.vibrate(200);
      return; // mantener modal abierto para que lo corrija
    }

    try{ soundOk.currentTime = 0; soundOk.play(); }catch{}
    allCodes.add(edited);
    const carro = carts.find(c=> String(c.id)===String(currentCart));
    if(carro){
      carro.bags.push(edited);
      actualizarInfo();
    }
    hideConfirm();
  }

  function retryCode(){
    try{ soundErr.currentTime = 0; soundErr.play(); }catch{}
    hideConfirm();
  }

  // ====== gestor de códigos ======
  function openCodesManager(){
    const cont = $("#codesList");
    cont.innerHTML = "";

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
        const row = document.createElement('div');
        row.className = 'code-item';

        const left = document.createElement('div');
        left.innerHTML = `<span>${code}</span> <small>#${idx+1}</small>`;

        const del = document.createElement('button');
        del.className = 'code-del';
        del.textContent = '🗑️';
        del.addEventListener('click', ()=>{
          // doble confirmación
          const c1 = confirm(`¿Eliminar el código ${code}?`);
          if(!c1) return;
          const c2 = confirm(`Confirmar eliminación definitiva de ${code}?`);
          if(!c2) return;

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
        });

        row.appendChild(left);
        row.appendChild(del);
        cont.appendChild(row);
      });
    });

    $("#codesModal").style.display = 'flex';
  }

  function closeCodesManager(){
    $("#codesModal").style.display = 'none';
  }

  // ====== guardar en Sheets ======
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
      const res = await fetch(WEBAPP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        mode: "cors",
        cache: "no-store",
      });
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
  document.addEventListener('DOMContentLoaded', async ()=>{
    $("#btnStart").addEventListener('click', iniciar);
    $("#btnNextCart").addEventListener('click', ()=>{ siguienteCarro(); });
    $("#btnFinish").addEventListener('click', finalizar);
    $("#btnCancel").addEventListener('click', cancelar);
    $("#btnTorch").addEventListener('click', toggleTorch);
    $("#btnSave").addEventListener('click', guardarEnSheet);
    $("#btnNew").addEventListener('click', ()=>location.reload());

    $("#btnAccept").addEventListener('click', acceptCode);
    $("#btnRetry").addEventListener('click', retryCode);

    $("#btnManageCodes").addEventListener('click', openCodesManager);
    $("#btnCloseCodes").addEventListener('click', closeCodesManager);

    $("#cameraSelectLive").addEventListener('change', async (e)=>{
      deviceId = e.target.value || null;
      await restartScan();
    });

    try{ await navigator.mediaDevices.getUserMedia({ video: true }); }catch{}
    await listarCamaras();
  });
})();
