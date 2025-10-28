// js/app.js (cámara + overlay + WebHID Honeywell 7580g + fallback teclado HID + sesión + gestor)
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

  // USB / WebHID
  let hidDevice = null;
  let usbBuffer = "";
  let usbTimer = null;

  // sesión local
  const SESSION_KEY = 'fbscan_session';
  const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

  // sonidos
  const soundOk  = new Audio('sounds/beep_ok.wav');
  const soundErr = new Audio('sounds/beep_err.wav');

  const $ = sel => document.querySelector(sel);

  // ====== Persistencia local ======
  function saveSession(stage){
    const payload = {
      ts: Date.now(),
      stage: stage || getCurrentStage(),
      day: $("#dia")?.value?.trim() || '',
      flight: $("#vuelo")?.value?.trim() || '',
      porter: $("#maletero")?.value?.trim() || '',
      codes: Array.from(allCodes)
    };
    try{ localStorage.setItem(SESSION_KEY, JSON.stringify(payload)); }catch{}
  }
  function clearSession(){ try{ localStorage.removeItem(SESSION_KEY); }catch{} }
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
    if(!(data.day && data.flight && data.porter)){ clearSession(); return false; }

    const ok = confirm(
      `Se encontró una sesión anterior de ${data.flight} (${data.day}).\n`+
      `Códigos guardados: ${data.codes?.length||0}.\n\n¿Continuar?`
    );
    if(!ok) return false;

    $("#dia").value = data.day;
    $("#vuelo").value = data.flight;
    $("#maletero").value = data.porter;
    allCodes = new Set(Array.isArray(data.codes)?data.codes:[]);

    // Volver directo al escaneo (o resumen si estaba ahí)
    if(data.stage === 'summary'){
      $("#form").style.display="none";
      $("#scanner").style.display="none";
      $("#resumen").style.display="block";
      renderResumen();
    }else{
      iniciar(true);
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

  // ====== ZXing ======
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
          formats: ['qr_code','pdf417','aztec','data_matrix','code_128','code_39','code_93','codabar','ean_13','ean_8','itf','upc_a','upc_e']
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
      openConfirm(raw);
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

  // ====== USB / WebHID Honeywell 7580g ======
  function focusUsb(){
    const inp = $("#usbInput");
    inp.value = "";
    inp.focus();
    setTimeout(()=> inp.focus(), 50);
  }

  // Fallback teclado HID (lectores que emulan teclado)
  function attachUsbKeyboardFallback(){
    const inp = $("#usbInput");
    const INTERVAL = 1500; // 1.5s sin teclas => fin de lectura
    inp.addEventListener('keydown', (ev)=>{
      if(ev.key === 'Enter'){
        ev.preventDefault();
        const code = usbBuffer.trim() || inp.value.trim();
        usbBuffer = ""; inp.value = "";
        if(code) openConfirm(code);
      }
    });
    inp.addEventListener('keyup', (ev)=>{
      if(ev.key.length === 1){ usbBuffer += ev.key; }
      clearTimeout(usbTimer);
      usbTimer = setTimeout(()=>{
        if(usbBuffer.trim()){
          const code = usbBuffer.trim();
          usbBuffer = ""; inp.value = "";
          openConfirm(code);
        }
      }, INTERVAL);
    });
  }

  // WebHID: conecta y escucha inputreport
  async function connectHoneywell(){
    if(!('hid' in navigator)){
      alert('WebHID no está disponible en este navegador. Se usará modo teclado HID.');
      $("#usbStatus").textContent = 'Modo teclado HID (fallback)';
      focusUsb();
      return;
    }
    try{
      // Intentamos filtrar por VendorID típico de Honeywell (0x0C2E) y por uso de "Bar Code Scanner" (0x8C)
      const filters = [
        { vendorId: 0x0C2E },          // Honeywell Imaging & Mobility (común)
        { usagePage: 0x8C },           // HID Usage Page: Bar Code Scanner
      ];
      const devices = await navigator.hid.requestDevice({ filters });
      if(!devices || devices.length === 0){ return; }

      // Elegimos el primero (si hay varios, podés elegir con un selector propio)
      hidDevice = devices[0];
      await hidDevice.open();

      $("#usbStatus").textContent = `Conectado: ${hidDevice.productName || 'Escáner'}`;
      focusUsb(); // dejamos foco en fallback por si el reporte no llega como esperamos

      hidDevice.addEventListener('inputreport', (event)=>{
        if(event.device !== hidDevice) return;
        const { data /* DataView */, reportId } = event;

        // Intento genérico: convertir bytes legibles a ASCII
        const bytes = new Uint8Array(data.buffer);
        let str = '';
        for (let i = 0; i < bytes.length; i++) {
          const b = bytes[i];
          // ASCII imprimible estándar
          if (b >= 32 && b <= 126) str += String.fromCharCode(b);
          // Carriage return / line feed => fin de lectura
          if (b === 10 || b === 13) {
            str = str.trim();
            if(str) openConfirm(str);
            str = '';
          }
        }
        // Si no vino CR/LF, pero hay texto, acumulamos con timeout
        if(str){
          usbBuffer += str;
          clearTimeout(usbTimer);
          usbTimer = setTimeout(()=>{
            const code = usbBuffer.trim();
            usbBuffer = '';
            if(code) openConfirm(code);
          }, 250); // corta ráfida por paquetes consecutivos
        }
      });

      // También escuchamos desconexión
      navigator.hid.addEventListener('disconnect', (e)=>{
        if(hidDevice && e.device === hidDevice){
          $("#usbStatus").textContent = 'Desconectado';
          hidDevice = null;
        }
      });

    }catch(err){
      console.error(err);
      alert('No se pudo conectar por WebHID. Usaré modo teclado HID.');
      $("#usbStatus").textContent = 'Modo teclado HID (fallback)';
      focusUsb();
    }
  }

  // ====== Flujo común ======
  function openConfirm(raw){
    if(confirming) return;
    confirming = true;
    $("#codeEdit").value = raw;
    const dup = allCodes.has(raw);
    $("#dupWarn").style.display = dup ? 'block' : 'none';
    if(dup){ try{ soundErr.currentTime = 0; soundErr.play(); }catch{} }
    $("#confirmModal").style.display = "flex";
    $("#codeEdit").focus();
    $("#codeEdit").select();
  }
  function hideConfirm(){
    $("#confirmModal").style.display = "none";
    confirming = false;
    // si estamos usando teclado HID, volvemos a enfocar
    if(!hidDevice) focusUsb();
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
      return;
    }
    try{ soundOk.currentTime = 0; soundOk.play(); }catch{}
    allCodes.add(edited);
    $("#badgeContador").textContent = `${allCodes.size} valijas`;
    saveSession('scan');
    hideConfirm();
  }
  function retryCode(){
    try{ soundErr.currentTime = 0; soundErr.play(); }catch{}
    hideConfirm();
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
        clearSession();
        return;
      }
    }catch{}
    try{
      await fetch(WEBAPP_URL, { method:"POST", mode:"no-cors", body: JSON.stringify(payload) });
      alert("Guardado enviado ✔️\nVerificá la hoja DATA para confirmar la fila.");
      clearSession();
    }catch(e2){
      alert("No se pudo guardar en Sheet: " + e2.message);
    }
  }

  // ====== Flujo principal ======
  async function iniciar(restore=false){
    const vuelo    = $("#vuelo").value.trim();
    const dia      = $("#dia").value.trim();
    const maletero = $("#maletero").value.trim();
    if(!vuelo || !dia || !maletero){
      alert("Completá vuelo, día y maletero");
      return;
    }
    if(!restore) allCodes = new Set();

    $("#badgeVuelo").textContent    = "Vuelo " + vuelo;
    $("#badgeContador").textContent = `${allCodes.size} valijas`;

    $("#form").style.display    = "none";
    $("#scanner").style.display = "block";

    deviceId = $("#cameraSelect").value || deviceId || null;
    await restartScan();
    await listarCamaras();

    // Si WebHID está disponible lo indicamos, si no mostramos fallback
    if('hid' in navigator){
      $("#usbStatus").textContent = 'WebHID disponible. Conectá el escáner o usá fallback teclado.';
    }else{
      $("#usbStatus").textContent = 'WebHID no disponible. Usando teclado HID (fallback).';
      focusUsb();
    }

    saveSession('scan');
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

    $("#btnManageCodes")?.addEventListener('click', ()=>{
      openCodesManager();
    });
    $("#btnCloseCodes")?.addEventListener('click', ()=> $("#codesModal").style.display='none');

    $("#cameraSelectLive").addEventListener('change', async (e)=>{
      deviceId = e.target.value || null;
      await restartScan();
    });

    // WebHID botón conectar
    $("#btnUsbConnect").addEventListener('click', connectHoneywell);

    // Fallback teclado HID: siempre lo dejamos listo
    attachUsbKeyboardFallback();

    // Pre-autorización de cámara para listar labels
    try{ await navigator.mediaDevices.getUserMedia({ video: true }); }catch{}
    await listarCamaras();

    // Restaurar sesión si existe
    tryRestoreSession();

    // Autosave básico en campos
    ["#vuelo","#dia","#maletero"].forEach(id=>{
      $(id).addEventListener('change', ()=> saveSession(getCurrentStage()));
      $(id).addEventListener('input',  ()=> saveSession(getCurrentStage()));
    });
  });

})();
