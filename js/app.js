// js/app.js (sin carros + overlay verde + sesión local con recuperación + editar código)
(function(){
  let reader;
  let streamTrack;
  let torchOn = false;
  let deviceId = null;

  // overlay
  let overlay, octx, video, rafId = null, detector = null;

  // estado
  let allCodes = new Set();
  let confirming = false;

  // sesión local (persistencia)
  const SESSION_KEY = 'fbscan_session';
  const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h (podés cambiarlo)

  // sonidos
  const soundOk  = new Audio('sounds/beep_ok.wav');
  const soundErr = new Audio('sounds/beep_err.wav');

  const $ = sel => document.querySelector(sel);

  // ====== Persistencia local ======
  function saveSession(stage){
    const payload = {
      ts: Date.now(),
      stage: stage || getCurrentStage(), // 'scan' | 'summary' | 'form'
      day: $("#dia")?.value?.trim() || '',
      flight: $("#vuelo")?.value?.trim() || '',
      porter: $("#maletero")?.value?.trim() || '',
      codes: Array.from(allCodes)
    };
    try{ localStorage.setItem(SESSION_KEY, JSON.stringify(payload)); }catch{}
  }
  function clearSession(){
    try{ localStorage.removeItem(SESSION_KEY); }catch{}
  }
  function getCurrentStage(){
    if($("#scanner").style.display !== 'none') return 'scan';
    if($("#resumen").style.display !== 'none') return 'summary';
    return 'form';
  }
  function tryRestoreSession(){
    let data = null;
    try{ data = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }catch{}
    if(!data) return false;
    if(Date.now() - (data.ts||0) > SESSION_TTL_MS){ clearSession(); return false; }

    const hasBasics = !!(data.day && data.flight && data.porter);
    if(!hasBasics){ clearSession(); return false; }

    const want = confirm(
      `Se encontró una sesión anterior de ${data.flight} (${data.day}).\n`+
      `Códigos guardados: ${Array.isArray(data.codes)?data.codes.length:0}.\n\n`+
      `¿Querés continuar donde estabas?`
    );
    if(!want) return false;

    // Restaurar campos y códigos
    $("#dia").value = data.day;
    $("#vuelo").value = data.flight;
    $("#maletero").value = data.porter;
    allCodes = new Set(Array.isArray(data.codes) ? data.codes : []);

    if(data.stage === 'summary'){
      // Restaurar a Resumen
      $("#form").style.display = "none";
      $("#scanner").style.display = "none";
      $("#resumen").style.display = "block";
      renderResumen();
    } else {
      // Restaurar a Escaneo
      iniciar(true); // restore=true
    }
    return true;
  }

  // ====== Cámara ======
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

      // selector inicial
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

      // selector en vivo
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

  // ====== Overlay ======
  function sizeOverlayToVideo(){
    if(!overlay || !video) return;
    const rect = video.getBoundingClientRect();
    overlay.width  = rect.width  * devicePixelRatio;
    overlay.height = rect.height * devicePixelRatio;
    overlay.style.width  = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    octx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    octx.clearRect(0,0,overlay.width,overlay.height);
  }

  function drawBoxes(detections){
    octx.clearRect(0,0,overlay.width,overlay.height);
    if(!detections || detections.length === 0) return;
    octx.lineWidth = 6;
    octx.strokeStyle = '#00c853';
    octx.shadowBlur = 12;
    octx.shadowColor = '#00c853';
    detections.forEach(d=>{
      const r = d.boundingBox;
      octx.beginPath();
      octx.rect(r.x, r.y, r.width, r.height);
      octx.stroke();
    });
    octx.shadowBlur = 0;
  }

  async function loopDetector(){
    cancelAnimationFrame(rafId);
    if(!detector || !video) return;
    const tick = async () => {
      try{
        const dets = await detector.detect(video);
        drawBoxes(dets);
      }catch{
        octx && octx.clearRect(0,0,overlay.width,overlay.height);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  // ====== ZXing + arranque de decodificación ======
  async function restartScan(){
    if(reader){ try{ reader.reset(); }catch{} }
    reader = new ZXing.BrowserMultiFormatReader();
    video = $("#preview");
    overlay = $("#overlay");
    octx = overlay.getContext('2d');

    sizeOverlayToVideo();
    new ResizeObserver(sizeOverlayToVideo).observe(video);

    if ('BarcodeDetector' in window) {
      try{
        detector = new BarcodeDetector({
          formats: [
            'qr_code','pdf417','aztec','data_matrix',
            'code_128','code_39','code_93','codabar',
            'ean_13','ean_8','itf','upc_a','upc_e'
          ]
        });
        loopDetector();
      }catch{ detector = null; }
    } else {
      detector = null;
      octx.clearRect(0,0,overlay.width,overlay.height);
    }

    await reader.decodeFromVideoDevice(deviceId, video, (result)=>{
      if(!result || confirming) return;
      const raw = String(result.text || "").trim();
      if(!raw) return;

      if(!detector){
        $("#preview").classList.add('video-glow');
        setTimeout(()=> $("#preview").classList.remove('video-glow'), 250);
      }

      confirming = true;
      $("#codeEdit").value = raw;

      const isDup = allCodes.has(raw);
      $("#dupWarn").style.display = isDup ? 'block' : 'none';
      if(isDup){ try{ soundErr.currentTime = 0; soundErr.play(); }catch{} }

      $("#confirmModal").style.display = "flex";
      $("#codeEdit").focus();
      $("#codeEdit").select();
    });

    // Torch / autofocus / tap-to-focus
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

  // ====== Flujo ======
  async function iniciar(restore=false){
    const vuelo    = $("#vuelo").value.trim();
    const dia      = $("#dia").value.trim();
    const maletero = $("#maletero").value.trim();
    if(!vuelo || !dia || !maletero){
      alert("Completá vuelo, día y maletero");
      return;
    }

    if(!restore){ allCodes = new Set(); } // si es restore, ya viene cargado
    $("#badgeVuelo").textContent    = "Vuelo " + vuelo;
    $("#badgeContador").textContent = `${allCodes.size} valijas`;

    $("#form").style.display    = "none";
    $("#scanner").style.display = "block";

    deviceId = $("#cameraSelect").value || deviceId || null;
    await restartScan();
    await listarCamaras();

    saveSession('scan');
  }

  function actualizarContador(){
    $("#badgeContador").textContent = `${allCodes.size} valijas`;
    saveSession('scan');
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
    if(rafId) cancelAnimationFrame(rafId);
    octx && octx.clearRect(0,0,overlay.width,overlay.height);
    saveSession('summary');
  }

  function cancelar(){
    if(reader){ try{ reader.reset(); }catch{} }
    if(rafId) cancelAnimationFrame(rafId);
    clearSession();
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

  // ====== Modal (alta de código desde lectura) ======
  function hideConfirm(){
    $("#confirmModal").style.display = "none";
    confirming = false;
  }

  function acceptCode(){
    const edited = ($("#codeEdit").value || "").trim();
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
    }
    try{ soundOk.currentTime = 0; soundOk.play(); }catch{}
    allCodes.add(edited);
    actualizarContador();
    hideConfirm();
  }

  function retryCode(){
    try{ soundErr.currentTime = 0; soundErr.play(); }catch{}
    hideConfirm();
  }

  // ====== Gestor de códigos (editar + eliminar) ======
  function openCodesManager(){
    const cont = $("#codesList");
    cont.innerHTML = "";

    if(allCodes.size === 0){
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = '(sin códigos)';
      cont.appendChild(empty);
    } else {
      Array.from(allCodes).forEach((code, idx)=>{
        const row = document.createElement('div');
        row.className = 'code-item';

        const left = document.createElement('div');
        left.innerHTML = `<span>${code}</span> <small>#${idx+1}</small>`;

        // Botones: editar y eliminar
        const actions = document.createElement('div');

        const editBtn = document.createElement('button');
        editBtn.className = 'code-del'; // reuso estilo (rojo) o podés crear uno amarillo
        editBtn.style.background = '#f39c12';
        editBtn.textContent = '✏️';
        editBtn.title = 'Editar código';
        editBtn.addEventListener('click', ()=>{
          const nuevo = prompt('Modificar código:', code);
          if(nuevo === null) return; // cancelado
          const newCode = String(nuevo).trim();
          if(!newCode){
            try{ soundErr.currentTime = 0; soundErr.play(); }catch{}
            alert('Código vacío');
            return;
          }
          if(newCode !== code && allCodes.has(newCode)){
            try{ soundErr.currentTime = 0; soundErr.play(); }catch{}
            alert('Ese código ya existe');
            return;
          }
          allCodes.delete(code);
          allCodes.add(newCode);
          try{ soundOk.currentTime = 0; soundOk.play(); }catch{}
          actualizarContador();
          openCodesManager(); // refrescar
        });

        const delBtn = document.createElement('button');
        delBtn.className = 'code-del';
        delBtn.textContent = '🗑️';
        delBtn.title = 'Eliminar código';
        delBtn.addEventListener('click', ()=>{
          const c1 = confirm(`¿Eliminar el código ${code}?`);
          if(!c1) return;
          const c2 = confirm(`Confirmar eliminación definitiva de ${code}?`);
          if(!c2) return;

          allCodes.delete(code);
          actualizarContador();
          openCodesManager(); // refrescar
        });

        actions.appendChild(editBtn);
        actions.appendChild(delBtn);

        row.appendChild(left);
        row.appendChild(actions);
        cont.appendChild(row);
      });
    }

    $("#codesModal").style.display = 'flex';
  }
  function closeCodesManager(){ $("#codesModal").style.display = 'none'; }

  // ====== Guardar en Sheets ======
  async function guardarEnSheet(){
    if(!WEBAPP_URL){ alert("No hay WebApp configurada (editá js/config.js)"); return; }
    const payload = {
      day: $("#dia").value.trim(),
      flight: $("#vuelo").value.trim(),
      porter: $("#maletero").value.trim(),
      total: allCodes.size,
      codes: Array.from(allCodes)
    };

    // Intento con CORS
    try{
      const res = await fetch(WEBAPP_URL, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      let ok = false;
      try { ok = !!(await res.json())?.ok; } catch {}
      if (ok) {
        alert("Guardado en Google Sheet ✔️");
        clearSession(); // ya guardado: limpiamos sesión
        return;
      }
    }catch{}

    // Fallback no-CORS
    try{
      await fetch(WEBAPP_URL, { method:"POST", mode:"no-cors", body: JSON.stringify(payload) });
      alert("Guardado enviado ✔️\nVerificá la hoja DATA para confirmar la fila.");
      clearSession(); // asumimos guardado exitoso
    }catch(e2){
      alert("No se pudo guardar en Sheet: " + e2.message);
    }
  }

  // ====== Eventos ======
  document.addEventListener('DOMContentLoaded', async ()=>{
    $("#btnStart").addEventListener('click', ()=>iniciar(false));
    $("#btnFinish").addEventListener('click', finalizar);
    $("#btnCancel").addEventListener('click', cancelar);
    $("#btnTorch").addEventListener('click', toggleTorch);
    $("#btnSave").addEventListener('click', guardarEnSheet);
    $("#btnNew").addEventListener('click', ()=>{ clearSession(); location.reload(); });

    $("#btnAccept").addEventListener('click', acceptCode);
    $("#btnRetry").addEventListener('click', retryCode);

    $("#btnManageCodes")?.addEventListener('click', openCodesManager);
    $("#btnCloseCodes")?.addEventListener('click', closeCodesManager);

    $("#cameraSelectLive").addEventListener('change', async (e)=>{
      deviceId = e.target.value || null;
      await restartScan();
    });

    // Pre-autorización de cámara para listar labels
    try{ await navigator.mediaDevices.getUserMedia({ video: true }); }catch{}
    await listarCamaras();

    // Intentar restaurar sesión
    tryRestoreSession();

    // Autosave básico cuando cambian campos
    ["#vuelo","#dia","#maletero"].forEach(id=>{
      $(id).addEventListener('change', ()=> saveSession(getCurrentStage()));
      $(id).addEventListener('input',  ()=> saveSession(getCurrentStage()));
    });
  });
})();
