(function(){
  let reader;
  let streamTrack;
  let torchOn = false;
  let currentCart = null; // siempre se pedirá por prompt
  let carts = [];                 // [{id, bags:[] }]
  let allCodes = new Set();       // para duplicados
  let deviceId = null;

  const $ = sel => document.querySelector(sel);

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

  async function iniciar(){
    const vuelo = $("#vuelo").value.trim();
    const dia = $("#dia").value.trim();
    const maletero = $("#maletero").value.trim();
    if(!vuelo || !dia || !maletero){ alert("Completá vuelo, día y maletero"); return; }

    // pedir número de carro inicial
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
    await escanear();
  }

  async function escanear(){
    if(reader){ try{ reader.reset(); }catch{} }
    reader = new ZXing.BrowserMultiFormatReader();
    const video = $("#preview");
    try{
      await reader.decodeFromVideoDevice(deviceId, video, (result)=>{
        if(result){
          const code = result.text.trim();
          if(allCodes.has(code)){
            alert("Código duplicado: " + code);
            if(navigator.vibrate) navigator.vibrate(200);
          }else{
            allCodes.add(code);
            const carro = carts.find(c=>String(c.id)===String(currentCart));
            carro.bags.push(code);
            actualizarInfo();
          }
        }
      });

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
      await listarCamaras(); // refresca labels tras permisos
    }catch(e){
      alert("Error de cámara: " + e.message);
    }
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

  function siguienteCarro(){
    const next = prompt("Número de siguiente carro:");
    if(!next) return;
    currentCart = String(next).trim();
    if(!carts.find(c=> String(c.id)===currentCart)){
      carts.push({ id: currentCart, bags: [] });
    }
    actualizarInfo();
  }

  function finalizar(){
    $("#scanner").style.display = "none";
    $("#resumen").style.display = "block";

    const vuelo = $("#vuelo").value;
    const dia = $("#dia").value;
    const maletero = $("#maletero").value;
    let html = `<p><b>Vuelo:</b> ${vuelo} — <b>Día:</b> ${dia} — <b>Maletero:</b> ${maletero}</p>`;
    html += `<p><b>Total valijas:</b> ${totalBags()}</p>`;
    for(const c of carts){
      html += `<div><b>Carro ${c.id}</b>: ${c.bags.length} valijas</div>`;
    }
    $("#res").innerHTML = html;
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
        body: JSON.stringify(payload)
      });
      if(!res.ok){
        await fetch(WEBAPP_URL, { method:"POST", mode:"no-cors", body: JSON.stringify(payload) });
        alert("Enviado (modo no-cors). Verifica en tu Google Sheet.");
        return;
      }
      await res.json().catch(()=>({}));
      alert("Guardado en Google Sheet ✔️");
    }catch(e){
      alert("No se pudo guardar en Sheet: " + e.message);
    }
  }

  // Wire events
  document.addEventListener('DOMContentLoaded', async ()=>{
    $("#btnStart").addEventListener('click', iniciar);
    $("#btnNextCart").addEventListener('click', siguienteCarro);
    $("#btnFinish").addEventListener('click', finalizar);
    $("#btnCancel").addEventListener('click', cancelar);
    $("#btnTorch").addEventListener('click', toggleTorch);
    $("#btnSave").addEventListener('click', guardarEnSheet);
    $("#btnNew").addEventListener('click', ()=>location.reload());

    try{ await navigator.mediaDevices.getUserMedia({ video: true }); }catch{}
    await listarCamaras();
  });
})(); 
