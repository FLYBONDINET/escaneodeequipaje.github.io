// js/app.js (multi-vuelo, overlay verde y guardado por vuelo)
(function(){
  let reader;
  let streamTrack;
  let torchOn = false;
  let deviceId = null;

  // overlay scanner
  let overlay, octx, video, rafId = null, detector = null;

  // Modelo de datos
  // flights: [{id, number, dest, codes:Set, babies, totalFinal, closed, saved}]
  let flights = [];
  let currentFlightId = null;
  let lastFlightId = null;
  let closingFlight = null;
  let managerFlightId = null;

  // Códigos únicos globales (para evitar duplicados entre vuelos)
  let allCodesGlobal = new Set();

  // Modal código
  let confirming = false;

  // Sonidos
  const soundOk  = new Audio('sounds/beep_ok.wav');
  const soundErr = new Audio('sounds/beep_err.wav');

  const $ = sel => document.querySelector(sel);

  // ====== Helpers bloqueo global ======
  function setInputsDisabled(disabled){
    const elems = document.querySelectorAll('button, input, select, textarea');
    elems.forEach(el=>{
      if(disabled){
        el.dataset.prevDisabled = el.disabled ? '1' : '0';
        el.disabled = true;
      }else{
        if(el.dataset.prevDisabled === '0'){
          el.disabled = false;
        }
        delete el.dataset.prevDisabled;
      }
    });
  }

  function showSavingOverlay(){
    const ov = document.getElementById('savingOverlay');
    if(ov) ov.style.display = 'flex';
    setInputsDisabled(true);
  }

  function hideSavingOverlay(){
    const ov = document.getElementById('savingOverlay');
    if(ov) ov.style.display = 'none';
    setInputsDisabled(false);
  }

  // ====== Utilidad vuelos ======
  function getFlightById(id){
    return flights.find(f => f.id === id) || null;
  }

  function setCurrentFlight(id){
    const f = getFlightById(id);
    if(!f || f.closed) return;
    currentFlightId = id;
    lastFlightId = id;
    actualizarContador();
  }

  function updateFlightSelectInModal(){
    const sel = $("#codeFlightSelect");
    if(!sel) return;
    sel.innerHTML = "";
    flights.filter(f => !f.closed).forEach(f=>{
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.number + (f.dest ? ` (${f.dest})` : '');
      sel.appendChild(opt);
    });
    if(lastFlightId && getFlightById(lastFlightId) && !getFlightById(lastFlightId).closed){
      sel.value = lastFlightId;
    }else if(flights.filter(f=>!f.closed).length){
      sel.value = flights.filter(f=>!f.closed)[0].id;
    }
  }

  function renderFlightsPanel(){
    const panel = $("#flightsPanel");
    if(!panel) return;
    panel.innerHTML = "";

    const openFlights = flights.filter(f => !f.closed);
    if(openFlights.length === 0){
      const div = document.createElement('div');
      div.className = 'muted';
      div.textContent = '(No hay vuelos abiertos. Podés finalizar el escaneo.)';
      panel.appendChild(div);
      return;
    }

    openFlights.forEach(f=>{
      const pill = document.createElement('div');
      pill.className = 'flight-pill';
      pill.dataset.id = f.id;

      const head = document.createElement('div');
      head.className = 'flight-pill-header';
      const title = document.createElement('span');
      title.textContent = f.number;
      const dest = document.createElement('span');
      dest.className = 'flight-pill-dest';
      dest.textContent = f.dest || '';
      head.appendChild(title);
      head.appendChild(dest);

      const count = document.createElement('div');
      count.className = 'flight-pill-count';
      count.textContent = `Bolsas: ${f.codes.size}`;

      const actions = document.createElement('div');
      actions.className = 'flight-pill-actions';
      const btnView = document.createElement('button');
      btnView.className = 'flight-view-btn';
      btnView.textContent = 'Ver códigos';
      btnView.addEventListener('click', ()=>{
        managerFlightId = f.id;
        openCodesManagerForFlight(f.id);
      });

      const btnClose = document.createElement('button');
      btnClose.className = 'flight-close-btn';
      btnClose.textContent = '✔';
      btnClose.title = 'Cerrar vuelo';
      btnClose.addEventListener('click', ()=>{
        openCloseFlightModal(f.id);
      });

      actions.appendChild(btnView);
      actions.appendChild(btnClose);

      pill.appendChild(head);
      pill.appendChild(count);
      pill.appendChild(actions);

      pill.addEventListener('click', (ev)=>{
        // si clic en botones, no cambiar vuelo
        if(ev.target === btnView || ev.target === btnClose) return;
        setCurrentFlight(f.id);
      });

      panel.appendChild(pill);
    });
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

  // ====== Overlay scanner ======
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
      updateFlightSelectInModal();

      const isDup = allCodesGlobal.has(raw);
      $("#dupWarn").style.display = isDup ? 'block' : 'none';
      if(isDup){ try{ soundErr.currentTime = 0; soundErr.play(); }catch{} }

      $("#confirmModal").style.display = "flex";
      $("#codeEdit").focus();
      $("#codeEdit").select();
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
  function buildFlightsFromForm(){
    flights = [];
    allCodesGlobal = new Set();
    currentFlightId = null;
    lastFlightId = null;

    const rows = document.querySelectorAll('#flightRows .flight-row');
    let idx = 0;
    rows.forEach(row=>{
      const num = row.querySelector('.flight-num')?.value.trim() || "";
      const dest = row.querySelector('.flight-dest')?.value.trim() || "";
      if(!num) return;
      const id = `f${idx++}_${Date.now()}`;
      flights.push({
        id,
        number: num,
        dest,
        codes: new Set(),
        babies: 0,
        totalFinal: 0,
        closed: false,
        saved: false
      });
    });
  }

  async function iniciar(){
    const dia      = $("#dia").value.trim();
    const maletero = $("#maletero").value.trim();
    if(!dia || !maletero){
      alert("Completá día y maletero");
      return;
    }

    buildFlightsFromForm();
    if(flights.length === 0){
      alert("Agregá al menos un vuelo con número.");
      return;
    }

    // recordar maletero en localStorage
    try{ localStorage.setItem('scanner_porter', maletero); }catch(e){}

    currentFlightId = flights[0].id;
    lastFlightId = currentFlightId;

    $("#form").style.display    = "none";
    $("#scanner").style.display = "block";

    deviceId = $("#cameraSelect").value || deviceId || null;
    renderFlightsPanel();
    actualizarContador();
    await restartScan();
    await listarCamaras();
  }

  function actualizarContador(){
    const f = getFlightById(currentFlightId) || flights.find(fl=>!fl.closed) || null;
    if(!f){
      $("#badgeVuelo").textContent = "Sin vuelos activos";
      $("#badgeContador").textContent = "0 valijas";
      return;
    }
    $("#badgeVuelo").textContent = `Vuelo ${f.number}` + (f.dest ? ` (${f.dest})` : '');
    $("#badgeContador").textContent = `${f.codes.size} valijas`;
  }

  function renderResumen(){
    const dia      = $("#dia").value;
    const maletero = $("#maletero").value;

    const wrap = document.createElement('div');
    wrap.style.textAlign = 'left';

    const header = document.createElement('div');
    header.innerHTML = `<b>Día:</b> ${dia} &nbsp; | &nbsp; <b>Maletero:</b> ${maletero}`;
    header.style.marginBottom = '10px';
    wrap.appendChild(header);

    if(flights.length === 0){
      const p = document.createElement('div');
      p.textContent = 'No se registraron vuelos.';
      wrap.appendChild(p);
    }else{
      flights.forEach(f=>{
        const block = document.createElement('div');
        block.style.marginBottom = '12px';
        block.style.padding = '8px';
        block.style.borderRadius = '10px';
        block.style.background = '#fafafa';
        block.style.border = '1px solid #eee';

        const title = document.createElement('div');
        title.innerHTML = `<b>${f.number}</b>` + (f.dest ? ` (${f.dest})` : '');
        block.appendChild(title);

        const info = document.createElement('div');
        const bags = f.codes.size;
        const babies = f.babies || 0;
        const totalFinal = f.totalFinal || (bags + babies);
        info.innerHTML = `Bolsas: ${bags} &nbsp; | &nbsp; Babies: ${babies} &nbsp; | &nbsp; Total final: ${totalFinal}`;
        info.style.fontSize = '13px';
        info.style.marginBottom = '4px';
        block.appendChild(info);

        if(f.codes.size){
          const ul = document.createElement('ul');
          ul.style.margin = '0';
          ul.style.paddingLeft = '18px';
          Array.from(f.codes).forEach(code=>{
            const li = document.createElement('li');
            li.textContent = code;
            ul.appendChild(li);
          });
          block.appendChild(ul);
        }

        wrap.appendChild(block);
      });
    }

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
  }

  function cancelar(){
    if(reader){ try{ reader.reset(); }catch{} }
    if(rafId) cancelAnimationFrame(rafId);
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

  // ====== Modal código ======
  function hideConfirm(){
    $("#confirmModal").style.display = "none";
    confirming = false;
  }

  function acceptCode(){
    const edited = ($("#codeEdit").value || "").trim();
    const flightId = $("#codeFlightSelect").value;
    const flight = getFlightById(flightId);

    if(!edited){
      try{ soundErr.currentTime = 0; soundErr.play(); }catch{}
      alert("Código vacío.");
      return;
    }
    if(!flight){
      alert("Seleccioná un vuelo válido.");
      return;
    }
    if(allCodesGlobal.has(edited)){
      try{ soundErr.currentTime = 0; soundErr.play(); }catch{}
      alert("Código duplicado en la sesión: " + edited);
      if(navigator.vibrate) navigator.vibrate(200);
      return;
    }

    try{ soundOk.currentTime = 0; soundOk.play(); }catch{}
    allCodesGlobal.add(edited);
    flight.codes.add(edited);

    currentFlightId = flight.id;
    lastFlightId = flight.id;

    actualizarContador();
    renderFlightsPanel();
    hideConfirm();
  }

  function retryCode(){
    try{ soundErr.currentTime = 0; soundErr.play(); }catch{}
    hideConfirm();
  }

  // ====== Gestor de códigos por vuelo ======
function openCodesManagerForFlight(flightId){
  const flight = getFlightById(flightId);
  const cont = $("#codesList");
  const titleEl = $("#codesModalTitle");

  cont.innerHTML = "";
  if(!flight){
    titleEl.textContent = "Gestor de códigos";
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = '(vuelo no encontrado)';
    cont.appendChild(empty);
    $("#codesModal").style.display = 'flex';
    return;
  }

  titleEl.textContent = `Códigos vuelo ${flight.number}` + (flight.dest ? ` (${flight.dest})` : '');

  if(flight.codes.size === 0){
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = '(sin códigos)';
    cont.appendChild(empty);
  } else {
    Array.from(flight.codes).forEach((code, idx)=>{
      const row = document.createElement('div');
      row.className = 'code-item';

      const left = document.createElement('div');
      left.innerHTML = `<span>${code}</span> <small>#${idx+1}</small>`;

      // Botón EDITAR (lapiz)
      const edit = document.createElement('button');
      edit.className = 'code-edit';
      edit.textContent = '✏️';
      edit.title = 'Editar código';
      edit.addEventListener('click', ()=>{
        const nuevo = prompt("Editar código escaneado:", code);
        if(nuevo === null) return; // cancelado
        const newTrim = (nuevo || "").trim();
        if(!newTrim){
          alert("El código no puede quedar vacío.");
          return;
        }
        if(newTrim === code) return;

        if(allCodesGlobal.has(newTrim)){
          alert("Ya existe otro bag con ese código en esta sesión.");
          if(navigator.vibrate) navigator.vibrate(200);
          return;
        }

        // Actualizar sets
        flight.codes.delete(code);
        allCodesGlobal.delete(code);
        flight.codes.add(newTrim);
        allCodesGlobal.add(newTrim);

        try{ soundOk.currentTime = 0; soundOk.play(); }catch{}

        if(currentFlightId === flight.id){
          actualizarContador();
        }
        renderFlightsPanel();
        openCodesManagerForFlight(flight.id); // refrescar lista
      });

      // Botón ELIMINAR (tacho)
      const del = document.createElement('button');
      del.className = 'code-del';
      del.textContent = '🗑️';
      del.title = 'Eliminar código';
      del.addEventListener('click', ()=>{
        const c1 = confirm(`¿Eliminar el código ${code}?`);
        if(!c1) return;
        const c2 = confirm(`Confirmar eliminación definitiva de ${code}?`);
        if(!c2) return;

        flight.codes.delete(code);
        allCodesGlobal.delete(code);
        actualizarContador();
        renderFlightsPanel();
        openCodesManagerForFlight(flight.id); // refrescar lista
      });

      row.appendChild(left);
      row.appendChild(edit);
      row.appendChild(del);
      cont.appendChild(row);
    });
  }

  $("#codesModal").style.display = 'flex';
}

  function openCodesManager(){
    const base = currentFlightId || (flights.find(f=>!f.closed)?.id);
    if(!base){
      alert("No hay vuelos activos.");
      return;
    }
    managerFlightId = base;
    openCodesManagerForFlight(base);
  }

  function closeCodesManager(){ $("#codesModal").style.display = 'none'; }

  // ====== Cerrar vuelo (babies + guardado Sheets) ======
  function openCloseFlightModal(flightId){
    const flight = getFlightById(flightId);
    if(!flight){
      alert("Vuelo no encontrado.");
      return;
    }
    if(flight.codes.size === 0){
      const ok = confirm("Este vuelo no tiene códigos. ¿Cerrar igual?");
      if(!ok) return;
    }

    closingFlight = flight;

    $("#closeFlightTitle").textContent =
      `Cerrar vuelo ${flight.number}` + (flight.dest ? ` (${flight.dest})` : '');
    $("#closeFlightInfo").textContent =
      `El vuelo tiene ${flight.codes.size} valijas despachadas. Podés sumar babies si corresponde.`;

    $("#closeFlightBags").textContent = String(flight.codes.size);
    $("#closeFlightBaby").value = "0";
    $("#closeFlightTotalFinal").textContent = String(flight.codes.size);

    $("#closeFlightModal").style.display = 'flex';
  }

  function updateCloseFlightTotal(){
    if(!closingFlight) return;
    const bags = closingFlight.codes.size;
    const babies = parseInt($("#closeFlightBaby").value, 10) || 0;
    const total = bags + babies;
    $("#closeFlightTotalFinal").textContent = String(total);
  }

  async function guardarVueloEnSheet(flight, babies, totalFinal){
    if(!WEBAPP_URL){
      alert("No hay WebApp configurada (editá js/config.js)");
      return false;
    }
    const payload = {
      day: $("#dia").value.trim(),
      porter: $("#maletero").value.trim(),
      flight: flight.number,
      destination: flight.dest,
      totalBags: flight.codes.size,
      baby: babies,
      totalFinal: totalFinal,
      codes: Array.from(flight.codes)
    };

    showSavingOverlay();
    try{
      // Intento CORS
      let ok = false;
      try{
        const res = await fetch(WEBAPP_URL, {
          method: "POST",
          mode: "cors",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          cache: "no-store",
        });
        try{
          const data = await res.json();
          ok = !!(data && (data.ok || data.success));
        }catch(eJson){
          ok = false;
        }
      }catch(e){
        ok = false;
      }

      if(ok){
        alert(`Vuelo ${flight.number} guardado ✔️ (bags: ${flight.codes.size}, babies: ${babies}, total: ${totalFinal})`);
        return true;
      }

      // Fallback no-CORS
      try{
        await fetch(WEBAPP_URL, {
          method:"POST",
          mode:"no-cors",
          body: JSON.stringify(payload)
        });
        alert(`Vuelo ${flight.number} enviado ✔️\nVerificá la hoja para confirmar la fila.`);
        return true;
      }catch(e2){
        alert("No se pudo guardar en Sheet: " + e2.message);
        return false;
      }
    }finally{
      hideSavingOverlay();
    }
  }

  async function onCloseFlightSave(){
    if(!closingFlight){
      $("#closeFlightModal").style.display = 'none';
      return;
    }
    const bags = closingFlight.codes.size;
    const babies = parseInt($("#closeFlightBaby").value, 10) || 0;
    const totalFinal = bags + babies;

    const ok = await guardarVueloEnSheet(closingFlight, babies, totalFinal);
    if(ok){
      closingFlight.babies = babies;
      closingFlight.totalFinal = totalFinal;
      closingFlight.closed = true;
      closingFlight.saved = true;

      $("#closeFlightModal").style.display = 'none';
      closingFlight = null;

      renderFlightsPanel();

      const remaining = flights.filter(f=>!f.closed);
      if(remaining.length){
        setCurrentFlight(remaining[0].id);
      }else{
        currentFlightId = null;
        actualizarContador();
        alert("Todos los vuelos están cerrados. Podés finalizar el escaneo para ver el resumen.");
      }
    }
  }

  function onCloseFlightCancel(){
    $("#closeFlightModal").style.display = 'none';
    closingFlight = null;
  }

  // ====== Inicializar filas de vuelos en el form ======
  function addFlightRow(){
    const container = $("#flightRows");
    const count = container.querySelectorAll('.flight-row').length;
    if(count >= 20){
      alert("Máximo 20 vuelos.");
      return;
    }
    const row = document.createElement('div');
    row.className = 'flight-row';

    const inputNum = document.createElement('input');
    inputNum.className = 'flight-num';
    inputNum.placeholder = '5240';

    const inputDest = document.createElement('input');
    inputDest.className = 'flight-dest';
    inputDest.placeholder = 'BRC';

    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.textContent = '🗑️';
    btnDel.addEventListener('click', ()=>{
      row.remove();
    });

    row.appendChild(inputNum);
    row.appendChild(inputDest);
    row.appendChild(btnDel);
    container.appendChild(row);
  }

  function initDateAndPorter(){
    const diaInput = $("#dia");
    if(diaInput && !diaInput.value){
      const today = new Date().toISOString().slice(0,10);
      diaInput.value = today;
    }
    try{
      const storedPorter = localStorage.getItem('scanner_porter');
      if(storedPorter && $("#maletero")){
        $("#maletero").value = storedPorter;
      }
    }catch(e){}
  }

  // ====== Eventos ======
  document.addEventListener('DOMContentLoaded', async ()=>{
    initDateAndPorter();

    // al menos una fila de vuelo
    addFlightRow();

    $("#btnAddFlightRow").addEventListener('click', addFlightRow);
    $("#btnStart").addEventListener('click', iniciar);
    $("#btnFinish").addEventListener('click', finalizar);
    $("#btnCancel").addEventListener('click', cancelar);
    $("#btnTorch").addEventListener('click', toggleTorch);
    $("#btnNew").addEventListener('click', ()=>location.reload());

    $("#btnAccept").addEventListener('click', acceptCode);
    $("#btnRetry").addEventListener('click', retryCode);

    $("#btnManageCodes")?.addEventListener('click', openCodesManager);
    $("#btnCloseCodes")?.addEventListener('click', closeCodesManager);

    $("#cameraSelectLive").addEventListener('change', async (e)=>{
      deviceId = e.target.value || null;
      await restartScan();
    });

    $("#closeFlightBaby").addEventListener('input', updateCloseFlightTotal);
    $("#btnCloseFlightSave").addEventListener('click', onCloseFlightSave);
    $("#btnCloseFlightCancel").addEventListener('click', onCloseFlightCancel);

    // Botón "Guardar en Google Sheet" del resumen ahora solo informa
    $("#btnSave").addEventListener('click', ()=>{
      alert("El guardado se realiza cuando cerrás cada vuelo con el tilde verde. El resumen es solo informativo.");
    });

    try{ await navigator.mediaDevices.getUserMedia({ video: true }); }catch{}
    await listarCamaras();
  });
})();
