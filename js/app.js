// js/app.js (multi-vuelo + equipaje especial + autosave local + USB scanner)
// -------------------------------------------------------------------------
// Versión SIN cámara: usa lector de código de barras que actúa como teclado.
// -------------------------------------------------------------------------
(function(){
  // --- Estado / variables base ---
  let reader;        // legacy (no se usa en modo USB)
  let deviceId = null; // legacy, por si en el futuro volves a cámara

  // overlay scanner (legacy, no-op)
  let overlay, octx, video, rafId = null, detector = null;

  // Modelo de datos
  // flights: [{id, number, dest, codes:[{code,specialType}], babies, totalFinal, closed, saved}]
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

  const LOCAL_STATE_KEY = 'fb_scanner_state_v2';

  const $ = sel => document.querySelector(sel);

  // -----------------------------------------------------------------------
  // Helpers bloqueo global
  // -----------------------------------------------------------------------
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

  // -----------------------------------------------------------------------
  // Estado local (autosave)
  // -----------------------------------------------------------------------
  function rebuildAllCodesGlobal(){
    allCodesGlobal = new Set();
    flights.forEach(f=>{
      (f.codes || []).forEach(c=>{
        if(c && c.code != null){
          allCodesGlobal.add(String(c.code));
        }
      });
    });
  }

  function saveStateToLocal(){
    const state = {
      day: $("#dia")?.value || "",
      porter: $("#maletero")?.value || "",
      flights,
      currentFlightId,
      lastFlightId
    };
    try{
      localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(state));
    }catch(e){
      // modo incógnito, etc.
    }
  }

  function clearLocalState(){
    try{
      localStorage.removeItem(LOCAL_STATE_KEY);
    }catch(e){}
  }

  async function tryRestoreState(){
    let raw;
    try{
      raw = localStorage.getItem(LOCAL_STATE_KEY);
    }catch(e){
      return;
    }
    if(!raw) return;

    let state;
    try{
      state = JSON.parse(raw);
    }catch(e){
      return;
    }

    if(!state || !Array.isArray(state.flights) || !state.flights.length) return;

    const ok = confirm("Hay un escaneo anterior sin finalizar. ¿Querés recuperarlo?");
    if(!ok){
      clearLocalState();
      return;
    }

    // Restaurar campos básicos
    if($("#dia")) $("#dia").value = state.day || new Date().toISOString().slice(0,10);
    if($("#maletero")) $("#maletero").value = state.porter || "";

    // Restaurar vuelos
    flights = state.flights.map(f=>({
      id: f.id,
      number: f.number,
      dest: f.dest || "",
      codes: Array.isArray(f.codes)
        ? f.codes.map(c=>({ code: String(c.code), specialType: c.specialType || null }))
        : [],
      babies: f.babies || 0,
      totalFinal: f.totalFinal || 0,
      closed: !!f.closed,
      saved: !!f.saved
    }));

    currentFlightId = state.currentFlightId || (flights.find(fl=>!fl.closed)?.id || (flights[0] && flights[0].id));
    lastFlightId = state.lastFlightId || currentFlightId;

    rebuildAllCodesGlobal();

    // Mostrar directamente el scanner (UI)
    if($("#form")) $("#form").style.display = "none";
    if($("#scanner")) $("#scanner").style.display = "block";

    renderFlightsPanel();
    actualizarContador();

    // En modo USB: dejar el input listo SOLO porque ya estamos en scanner
    focusBarcodeInput();
  }

  // -----------------------------------------------------------------------
  // Utilidad vuelos
  // -----------------------------------------------------------------------
  function getFlightById(id){
    return flights.find(f => f.id === id) || null;
  }

  function setCurrentFlight(id){
    const f = getFlightById(id);
    if(!f || f.closed) return;
    currentFlightId = id;
    lastFlightId = id;
    actualizarContador();
    saveStateToLocal();
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
      count.textContent = `Bolsas: ${f.codes.length}`;

      const actions = document.createElement('div');
      actions.className = 'flight-pill-actions';
      const btnView = document.createElement('button');
      btnView.className = 'flight-view-btn';
      btnView.textContent = 'Ver códigos';
      btnView.addEventListener('click', (ev)=>{
        ev.stopPropagation();
        managerFlightId = f.id;
        openCodesManagerForFlight(f.id);
      });

      const btnClose = document.createElement('button');
      btnClose.className = 'flight-close-btn';
      btnClose.textContent = '✔';
      btnClose.title = 'Cerrar vuelo';
      btnClose.addEventListener('click', (ev)=>{
        ev.stopPropagation();
        openCloseFlightModal(f.id);
      });

      actions.appendChild(btnView);
      actions.appendChild(btnClose);

      pill.appendChild(head);
      pill.appendChild(count);
      pill.appendChild(actions);

      pill.addEventListener('click', (ev)=>{
        if(ev.target === btnView || ev.target === btnClose) return;
        setCurrentFlight(f.id);
      });

      panel.appendChild(pill);
    });
  }

  // -----------------------------------------------------------------------
  // Legacy cámara => ahora no-op para evitar errores si algo los llama
  // -----------------------------------------------------------------------
  async function getVideoInputsFallback(){ return []; }
  async function listarCamaras(){ /* no-op en modo USB */ }
  function sizeOverlayToVideo(){ /* no-op */ }
  function drawBoxes(){ /* no-op */ }
  async function loopDetector(){ /* no-op */ }
  async function restartScan(){ /* no-op */ }

  // -----------------------------------------------------------------------
  // Flujo UI: build flights desde el form
  // -----------------------------------------------------------------------
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
        codes: [],           // array de {code,specialType}
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

    try{ localStorage.setItem('scanner_porter', maletero); }catch(e){}

    currentFlightId = flights[0].id;
    lastFlightId = currentFlightId;

    $("#form").style.display    = "none";
    $("#scanner").style.display = "block";

    renderFlightsPanel();
    actualizarContador();

    // En modo USB: preparar input escondido (recién ahora)
    focusBarcodeInput();

    saveStateToLocal();
  }

  function actualizarContador(){
    const f = getFlightById(currentFlightId) || flights.find(fl=>!fl.closed) || null;
    if(!f){
      $("#badgeVuelo").textContent = "Sin vuelos activos";
      $("#badgeContador").textContent = "0 valijas";
      return;
    }
    $("#badgeVuelo").textContent = `Vuelo ${f.number}` + (f.dest ? ` (${f.dest})` : '');
    $("#badgeContador").textContent = `${f.codes.length} valijas`;
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

        const bags = f.codes.length;
        const babies = f.babies || 0;
        const totalFinal = f.totalFinal || (bags + babies);

        const info = document.createElement('div');
        info.innerHTML = `Bolsas: ${bags} &nbsp; | &nbsp; Babies: ${babies} &nbsp; | &nbsp; Total final: ${totalFinal}`;
        info.style.fontSize = '13px';
        info.style.marginBottom = '4px';
        block.appendChild(info);

        if(f.codes.length){
          const ul = document.createElement('ul');
          ul.style.margin = '0';
          ul.style.paddingLeft = '18px';
          f.codes.forEach(c=>{
            const label = c.specialType ? `${c.code} (${c.specialType})` : c.code;
            const li = document.createElement('li');
            li.textContent = label;
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
    clearLocalState();
    $("#scanner").style.display = "none";
    $("#resumen").style.display = "block";
    renderResumen();
    // limpieza legacy
    if(reader){ try{ if(reader.reset) reader.reset(); }catch{} }
    if(rafId) cancelAnimationFrame(rafId);
    if(octx && overlay) octx.clearRect(0,0,overlay.width,overlay.height);
    stopFocusingBarcodeInput();
  }

  function cancelar(){
    clearLocalState();
    if(reader){ try{ if(reader.reset) reader.reset(); }catch{} }
    if(rafId) cancelAnimationFrame(rafId);
    stopFocusingBarcodeInput();
    location.reload();
  }

  // ====== Modal código ======
  function hideConfirm(){
    $("#confirmModal").style.display = "none";
    confirming = false;
    // Cuando cierro el modal, recién ahí vuelvo al lector (si estoy en scanner)
    focusBarcodeInput();
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

    // Equipaje especial
    const chk = $("#specialCheck");
    const sel = $("#specialTypeSelect");
    let specialType = null;
    if(chk && chk.checked){
      specialType = sel?.value || "OTRO";
    }

    try{ soundOk.currentTime = 0; soundOk.play(); }catch{}
    allCodesGlobal.add(edited);
    flight.codes.push({ code: edited, specialType });

    currentFlightId = flight.id;
    lastFlightId = flight.id;

    actualizarContador();
    renderFlightsPanel();
    hideConfirm();
    saveStateToLocal();
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

    if(flight.codes.length === 0){
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = '(sin códigos)';
      cont.appendChild(empty);
    } else {
      flight.codes.forEach((item, idx)=>{
        const { code, specialType } = item;
        const label = specialType ? `${code} (${specialType})` : code;

        const row = document.createElement('div');
        row.className = 'code-item';

        const left = document.createElement('div');
        left.innerHTML = `<span>${label}</span> <small>#${idx+1}</small>`;

        // Editar código (manteniendo tipo especial)
        const edit = document.createElement('button');
        edit.className = 'code-edit';
        edit.textContent = '✏️';
        edit.title = 'Editar código';
        edit.addEventListener('click', ()=>{
          const nuevo = prompt("Editar código escaneado:", code);
          if(nuevo === null) return;
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

          allCodesGlobal.delete(code);
          allCodesGlobal.add(newTrim);
          item.code = newTrim;

          try{ soundOk.currentTime = 0; soundOk.play(); }catch{}

          if(currentFlightId === flight.id){
            actualizarContador();
          }
          renderFlightsPanel();
          openCodesManagerForFlight(flight.id);
          saveStateToLocal();
        });

        // Eliminar código
        const del = document.createElement('button');
        del.className = 'code-del';
        del.textContent = '🗑️';
        del.title = 'Eliminar código';
        del.addEventListener('click', ()=>{
          const c1 = confirm(`¿Eliminar el código ${label}?`);
          if(!c1) return;
          const c2 = confirm(`Confirmar eliminación definitiva de ${label}?`);
          if(!c2) return;

          const idxToRemove = flight.codes.indexOf(item);
          if(idxToRemove >= 0){
            flight.codes.splice(idxToRemove,1);
          }
          allCodesGlobal.delete(code);

          actualizarContador();
          renderFlightsPanel();
          openCodesManagerForFlight(flight.id);
          saveStateToLocal();
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
    if(flight.codes.length === 0){
      const ok = confirm("Este vuelo no tiene códigos. ¿Cerrar igual?");
      if(!ok) return;
    }

    closingFlight = flight;

    $("#closeFlightTitle").textContent =
      `Cerrar vuelo ${flight.number}` + (flight.dest ? ` (${flight.dest})` : '');
    $("#closeFlightInfo").textContent =
      `El vuelo tiene ${flight.codes.length} valijas despachadas. Podés sumar babies si corresponde.`;

    $("#closeFlightBags").textContent = String(flight.codes.length);
    $("#closeFlightBaby").value = "0";
    $("#closeFlightTotalFinal").textContent = String(flight.codes.length);

    $("#closeFlightModal").style.display = 'flex';
  }

  function updateCloseFlightTotal(){
    if(!closingFlight) return;
    const bags = closingFlight.codes.length;
    const babies = parseInt($("#closeFlightBaby").value, 10) || 0;
    const total = bags + babies;
    $("#closeFlightTotalFinal").textContent = String(total);
  }

  async function guardarVueloEnSheet(flight, babies, totalFinal){
    if(!WEBAPP_URL){
      alert("No hay WebApp configurada (editá js/config.js)");
      return false;
    }

    const codesDecorados = flight.codes.map(c =>
      c.specialType ? `${c.code} (${c.specialType})` : c.code
    );

    const payload = {
      day: $("#dia").value.trim(),
      porter: $("#maletero").value.trim(),
      flight: flight.number,
      destination: flight.dest,
      total: flight.codes.length,
      totalBags: flight.codes.length,
      baby: babies,
      totalFinal: totalFinal,
      codes: codesDecorados
    };

    showSavingOverlay();
    try{
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
        alert(`Vuelo ${flight.number} guardado ✔️ (bags: ${flight.codes.length}, babies: ${babies}, total: ${totalFinal})`);
        return true;
      }

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
    const bags = closingFlight.codes.length;
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
      saveStateToLocal();

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
    inputNum.placeholder = '5000';

    const inputDest = document.createElement('input');
    inputDest.className = 'flight-dest';
    inputDest.placeholder = 'COR';

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

  // -----------------------------------------------------------------------
  // Parte 3: Lector USB (input oculto), manejo de escaneos
  // -----------------------------------------------------------------------
  function handleScannedCode(raw){
    const code = String(raw || "").trim();
    if(!code) return;

    if(confirming) return; // si el modal ya está abierto, ignoramos

    $("#codeEdit").value = code;
    updateFlightSelectInModal();

    // reset equipaje especial UI
    const chk = $("#specialCheck");
    const wrap = $("#specialTypeWrap");
    const sel  = $("#specialTypeSelect");
    if(chk) chk.checked = false;
    if(wrap) wrap.style.display = 'none';
    if(sel) sel.value = "BABY";

    const isDup = allCodesGlobal.has(code);
    if($("#dupWarn")) $("#dupWarn").style.display = isDup ? 'block' : 'none';
    if(isDup){
      try{ soundErr.currentTime = 0; soundErr.play(); }catch{}
    }

    confirming = true;
    $("#confirmModal").style.display = "flex";
    $("#codeEdit").focus();
    $("#codeEdit").select();
  }

  function ensureBarcodeInputExists(){
    let el = document.getElementById('barcodeInput');
    if(el) return el;

    el = document.createElement('input');
    el.type = 'text';
    el.id = 'barcodeInput';
    el.autocomplete = 'off';
    // oculto pero focusable
    el.style.position = 'absolute';
    el.style.left = '-9999px';
    el.style.top = '0';
    el.style.width = '1px';
    el.style.height = '1px';
    el.style.opacity = '0';
    document.body.appendChild(el);
    return el;
  }

  let keepFocusInterval = null;
  function focusBarcodeInput(){
    const inp = ensureBarcodeInputExists();
    try{ inp.focus({ preventScroll: true }); }catch{ inp.focus(); }

    if(keepFocusInterval) clearInterval(keepFocusInterval);
    keepFocusInterval = setInterval(()=>{
      try{
        const scanner = document.getElementById('scanner');
        if(!scanner) return;

        const scannerVisible = scanner.style.display !== 'none';

        // Si NO estoy en la pantalla de escaneo o está abierto el modal, no toco el foco
        if(!scannerVisible || confirming) return;

        if(document.activeElement !== inp) inp.focus();
      }catch(e){}
    }, 300);
  }

  function stopFocusingBarcodeInput(){
    if(keepFocusInterval){
      clearInterval(keepFocusInterval);
      keepFocusInterval = null;
    }
  }

  function attachBarcodeListeners(){
    const inp = ensureBarcodeInputExists();

    // 1) Si el lector manda ENTER al final del código
    inp.addEventListener('keydown', (e)=>{
      if(e.key === 'Enter' || e.keyCode === 13){
        const val = (inp.value || "").trim();
        inp.value = "";
        if(val){
          handleScannedCode(val);
        }
        e.preventDefault();
      }
    });

    // 2) Si el lector no manda Enter pero “escribe” el código de golpe
    let scanTimer = null;
    inp.addEventListener('input', ()=>{
      if(scanTimer) clearTimeout(scanTimer);
      scanTimer = setTimeout(()=>{
        const val = (inp.value || "").trim();
        if(!val) return;

        const scanner = document.getElementById('scanner');
        const scannerVisible = scanner && scanner.style.display !== 'none';
        if(!scannerVisible || confirming) return;

        handleScannedCode(val);
        inp.value = "";
      }, 80); // pequeño delay para capturar toda la ráfaga
    });

    // 3) Click en pantalla de scanner → vuelve el foco al input oculto (si no hay modal)
    document.addEventListener('click', ()=>{
      try{
        const scanner = document.getElementById('scanner');
        if(!scanner) return;
        const scannerVisible = scanner.style.display !== 'none';

        if(!scannerVisible || confirming) return;

        if(document.activeElement !== inp){
          inp.focus();
        }
      }catch(e){}
    });
  }

  // -----------------------------------------------------------------------
  // Toaster simple (no imprescindible, pero está)
  // -----------------------------------------------------------------------
  let toastTimer = null;
  function showToast(msg, cls){
    const t = document.getElementById('toast');
    if(!t){
      const tt = document.createElement('div');
      tt.id = 'toast';
      tt.style.position = 'fixed';
      tt.style.right = '16px';
      tt.style.bottom = '16px';
      tt.style.padding = '8px 12px';
      tt.style.background = '#222';
      tt.style.color = '#fff';
      tt.style.borderRadius = '6px';
      tt.style.boxShadow = '0 6px 18px rgba(0,0,0,0.2)';
      tt.style.zIndex = 9999;
      tt.style.opacity = '0';
      document.body.appendChild(tt);
    }
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.style.opacity = '1';
    if(toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>{ el.style.opacity = '0'; }, 2000);
  }

  // -----------------------------------------------------------------------
  // Inicialización y eventos DOMContentLoaded
  // -----------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', async ()=>{
    initDateAndPorter();
    addFlightRow();

    // UI botones
    $("#btnAddFlightRow").addEventListener('click', addFlightRow);
    $("#btnStart").addEventListener('click', iniciar);
    $("#btnFinish").addEventListener('click', finalizar);
    $("#btnCancel").addEventListener('click', cancelar);
    $("#btnNew").addEventListener('click', ()=>{
      clearLocalState();
      location.reload();
    });

    $("#btnAccept").addEventListener('click', acceptCode);
    $("#btnRetry").addEventListener('click', retryCode);

    $("#btnManageCodes")?.addEventListener('click', openCodesManager);
    $("#btnCloseCodes")?.addEventListener('click', closeCodesManager);

    $("#closeFlightBaby").addEventListener('input', updateCloseFlightTotal);
    $("#btnCloseFlightSave").addEventListener('click', onCloseFlightSave);
    $("#btnCloseFlightCancel").addEventListener('click', onCloseFlightCancel);

    const specialCheck = $("#specialCheck");
    const specialWrap  = $("#specialTypeWrap");
    if(specialCheck && specialWrap){
      specialCheck.addEventListener('change', ()=>{
        specialWrap.style.display = specialCheck.checked ? 'block' : 'none';
      });
    }

    $("#btnSave").addEventListener('click', ()=>{
      alert("El guardado se realiza cuando cerrás cada vuelo con el tilde verde. El resumen es solo informativo.");
    });

    // Preparar lector USB (listeners)
    attachBarcodeListeners();

    // Restaurar sesión anterior si existe (si vuelve a scanner, ahí se llama a focusBarcodeInput)
    await tryRestoreState();
    // Si no había sesión previa, seguís en el form y el lector NO roba foco.
  });

  // -----------------------------------------------------------------------
  // Fin del closure
  // -----------------------------------------------------------------------
})();
