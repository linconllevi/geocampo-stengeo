/* Mapa (Leaflet): base Google Satélite, camadas vetoriais/raster, desenho, GPS, trilha, offline */
const Mapa = (() => {
  let map, baseAtual, grupoFeicoes, camadaGPS, circuloGPS, watchId = null, seguir = false;
  let ultimaPos = null, trilha = null, linhaTrilha = null, mostrarRotulos = true;
  const camadasFeicoes = new Map();   // id -> layer
  const camadasImportadas = new Map(); // arquivoId -> { layer, rec }
  const visTipos = { Point: true, LineString: true, Polygon: true };

  const BASES = {
    google_sat: { nome: 'Google Satélite', url: 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', sub: ['0', '1', '2', '3'], max: 20 },
    google_hib: { nome: 'Google Híbrido', url: 'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', sub: ['0', '1', '2', '3'], max: 20 },
    esri: { nome: 'Esri Imagem', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', sub: [], max: 19 },
    osm: { nome: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', sub: [], max: 19 }
  };

  function iniciar() {
    if (map) return;
    map = L.map('mapa', { zoomControl: true, maxZoom: 22, attributionControl: true }).setView([-3.1, -60.02], 12);
    map.attributionControl.setPrefix('');
    trocarBase(localStorage.getItem('gc_base') || 'google_sat');
    grupoFeicoes = L.featureGroup().addTo(map);
    map.pm.setLang('pt_br');
    map.pm.setGlobalOptions({ snappable: true, snapDistance: 15, templineStyle: { color: '#ffcc00' }, hintlineStyle: { color: '#ffcc00', dashArray: '5,5' } });
    map.on('pm:create', e => {
      const geom = e.layer.toGeoJSON().geometry;
      map.removeLayer(e.layer);
      App.novaFeicao(geom, {});
    });
    map.on('moveend', () => localStorage.setItem('gc_mapa_vista', JSON.stringify([map.getCenter().lat, map.getCenter().lng, map.getZoom()])));
    const v = JSON.parse(localStorage.getItem('gc_mapa_vista') || 'null');
    if (v) map.setView([v[0], v[1]], v[2]);
  }

  function trocarBase(chave) {
    const b = BASES[chave] || BASES.google_sat;
    if (baseAtual) map.removeLayer(baseAtual);
    baseAtual = null;
    if (chave !== 'nenhuma') {
      baseAtual = L.tileLayer(b.url, { subdomains: b.sub.length ? b.sub : 'abc', maxNativeZoom: b.max, maxZoom: 22, attribution: b.nome, crossOrigin: false }).addTo(map);
      baseAtual.bringToBack();
    }
    localStorage.setItem('gc_base', chave);
  }

  function ajustar() { if (map) setTimeout(() => map.invalidateSize(), 60); }

  /* ---------------- feições do projeto ---------------- */
  function estilo(f) {
    const cor = App.corDe(f);
    return { color: f.tipo === 'Polygon' ? cor : cor, weight: 3, fillColor: cor, fillOpacity: f.tipo === 'Polygon' ? 0.22 : 0.9 };
  }

  function desenharFeicoes(lista) {
    if (!map) return;
    grupoFeicoes.clearLayers(); camadasFeicoes.clear();
    lista.filter(f => !f.excluido && f.geometria).forEach(f => {
      if (!visTipos[f.geometria.type]) return;
      const lyr = L.geoJSON(f.geometria, {
        style: () => estilo(f),
        pointToLayer: (_, ll) => L.circleMarker(ll, { radius: 8, color: '#fff', weight: 2, fillColor: App.corDe(f), fillOpacity: 1 }),
        pmIgnore: false
      });
      lyr.bindPopup(() => `<div class="pop"><b>${esc(f.codigo)}</b> ${esc(f.titulo || '')}<br><small>${esc(f.categoria || '')}</small><br>
        ${f.descricao ? '<div style="margin:4px 0">' + esc(f.descricao).slice(0, 140) + (f.descricao.length > 140 ? '…' : '') + '</div>' : ''}
        <button class="btn peq primario" onclick="App.abrirFeicao('${f.id}')">Abrir</button></div>`);
      if (mostrarRotulos) lyr.bindTooltip(esc(f.codigo), { permanent: true, direction: 'right', offset: [8, 0], className: 'rotulo' });
      lyr.addTo(grupoFeicoes);
      camadasFeicoes.set(f.id, lyr);
    });
  }

  function focar(f) {
    if (!map || !f || !f.geometria) return;
    const lyr = camadasFeicoes.get(f.id) || L.geoJSON(f.geometria);
    const b = lyr.getBounds();
    if (f.geometria.type === 'Point') map.setView(b.getCenter(), Math.max(map.getZoom(), 18));
    else map.fitBounds(b, { padding: [40, 40], maxZoom: 19 });
    setTimeout(() => lyr.openPopup && lyr.openPopup(), 300);
  }

  function enquadrarProjeto() {
    if (!map) return;
    const grupo = L.featureGroup([...camadasFeicoes.values(), ...[...camadasImportadas.values()].filter(c => c.layer.getBounds).map(c => c.layer)]);
    try { const b = grupo.getBounds(); if (b.isValid()) map.fitBounds(b, { padding: [30, 30], maxZoom: 18 }); } catch (e) {}
  }

  /* ---------------- desenho / edição ---------------- */
  function desenhar(forma) {
    if (!App.projetoAtual()) return App.toast('Abra um projeto primeiro.', true);
    map.pm.disableDraw();
    map.pm.enableDraw(forma, forma === 'Marker' ? { markerStyle: { draggable: false } } : { finishOn: forma === 'Line' ? 'dblclick' : null });
    App.toast(forma === 'Marker' ? 'Toque no mapa para inserir o ponto' : 'Toque para inserir vértices; toque no último vértice (ou no primeiro, no polígono) para concluir');
  }

  function editarGeometria(f) {
    return new Promise(resolve => {
      const grupo = camadasFeicoes.get(f.id);
      if (!grupo) return resolve(null);
      const lyr = grupo.getLayers()[0];
      focar(f); map.closePopup();
      if (f.geometria.type === 'Point') lyr.pm.enableLayerDrag(); else lyr.pm.enable({ allowSelfIntersection: false });
      const barra = document.getElementById('barra-edicao');
      document.getElementById('barra-edicao-txt').textContent = f.geometria.type === 'Point' ? 'Arraste o ponto' : 'Arraste os vértices';
      barra.hidden = false;
      const fim = ok => {
        barra.hidden = true;
        const g = lyr.toGeoJSON().geometry;
        if (f.geometria.type === 'Point') lyr.pm.disableLayerDrag(); else lyr.pm.disable();
        resolve(ok ? g : null);
      };
      document.getElementById('barra-edicao-ok').onclick = () => fim(true);
      document.getElementById('barra-edicao-cancelar').onclick = () => fim(false);
    });
  }

  /* ---------------- GPS ---------------- */
  function alternarGPS(forcar) {
    const btn = document.getElementById('fab-gps');
    if (watchId !== null && !forcar) {
      if (!seguir) { seguir = true; btn.textContent = '◉'; if (ultimaPos) map.setView([ultimaPos.lat, ultimaPos.lon], Math.max(map.getZoom(), 17)); return; }
      navigator.geolocation.clearWatch(watchId); watchId = null; seguir = false;
      btn.classList.remove('ligado'); btn.textContent = '◎';
      if (camadaGPS) { map.removeLayer(camadaGPS); map.removeLayer(circuloGPS); camadaGPS = null; }
      document.getElementById('mapa-info').textContent = 'GPS desligado';
      return;
    }
    if (!navigator.geolocation) return App.toast('GPS não disponível neste aparelho.', true);
    if (watchId !== null) return;
    seguir = true; btn.classList.add('ligado'); btn.textContent = '◉';
    watchId = navigator.geolocation.watchPosition(posicao, e => App.toast('GPS: ' + e.message, true), { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
  }

  function posicao(p) {
    const c = p.coords;
    const primeira = !ultimaPos;
    ultimaPos = { lat: c.latitude, lon: c.longitude, precisao: c.accuracy, altitude: c.altitude, t: p.timestamp };
    const ll = [c.latitude, c.longitude];
    if (map) {
      if (!camadaGPS) {
        camadaGPS = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="gps-ponto"></div>', iconSize: [18, 18] }), interactive: false, pmIgnore: true }).addTo(map);
        circuloGPS = L.circle(ll, { radius: c.accuracy, color: '#2a8cff', weight: 1, fillOpacity: .1, interactive: false, pmIgnore: true }).addTo(map);
      } else { camadaGPS.setLatLng(ll); circuloGPS.setLatLng(ll).setRadius(c.accuracy); }
      if (seguir || primeira) map.setView(ll, primeira ? Math.max(map.getZoom(), 17) : map.getZoom(), { animate: true });
    }
    const u = Geo.paraUTM(c.latitude, c.longitude);
    document.getElementById('mapa-info').innerHTML =
      `GPS ±${Math.round(c.accuracy)} m${c.altitude != null ? ' · alt ' + Math.round(c.altitude) + ' m' : ''}<br>${c.latitude.toFixed(6)}, ${c.longitude.toFixed(6)} · UTM ${u.zona} ${u.e.toFixed(0)} E ${u.n.toFixed(0)} N`;
    if (trilha) {
      const ult = trilha[trilha.length - 1];
      if (!ult || Geo.dist(ult, [c.longitude, c.latitude]) > Math.max(3, c.accuracy / 2)) {
        trilha.push([c.longitude, c.latitude]);
        linhaTrilha.setLatLngs(trilha.map(x => [x[1], x[0]]));
      }
    }
  }

  function obterPosicao() {
    return new Promise((res, rej) => {
      if (ultimaPos && Date.now() - ultimaPos.t < 15000) return res(ultimaPos);
      if (!navigator.geolocation) return rej(new Error('GPS indisponível'));
      navigator.geolocation.getCurrentPosition(p => { posicao(p); res(ultimaPos); }, e => rej(e), { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 });
    });
  }

  async function pontoGPS() {
    if (!App.projetoAtual()) return App.toast('Abra um projeto primeiro.', true);
    App.toast('Obtendo posição do GPS…');
    try {
      const p = await obterPosicao();
      App.novaFeicao({ type: 'Point', coordinates: [p.lon, p.lat] }, { precisao: Math.round(p.precisao * 10) / 10, altitude: p.altitude, origem: 'GPS' });
    } catch (e) { App.toast('Não foi possível obter o GPS: ' + e.message, true); }
  }

  function alternarTrilha() {
    const btn = document.getElementById('fab-trilha');
    if (!trilha) {
      if (!App.projetoAtual()) return App.toast('Abra um projeto primeiro.', true);
      trilha = []; linhaTrilha = L.polyline([], { color: '#ff3b3b', weight: 4, dashArray: '6,6', pmIgnore: true }).addTo(map);
      if (watchId === null) alternarGPS();
      btn.classList.add('gravando');
      App.toast('Gravando trilha. Toque novamente para encerrar.');
    } else {
      btn.classList.remove('gravando');
      const pts = trilha; trilha = null; map.removeLayer(linhaTrilha);
      if (pts.length < 2) return App.toast('Trilha muito curta — nada salvo.', true);
      App.novaFeicao({ type: 'LineString', coordinates: pts }, { origem: 'Trilha GPS' });
    }
  }

  /* ---------------- camadas importadas ---------------- */
  const scripts = {};
  function carregarScript(src) {
    if (!scripts[src]) scripts[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Falha ao carregar ' + src)); document.head.appendChild(s); });
    return scripts[src];
  }

  function extensao(nome) { return (String(nome).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || ''; }
  const EXT_VETOR = ['geojson', 'json', 'kml', 'kmz', 'gpx', 'zip', 'csv'];
  const EXT_RASTER = ['tif', 'tiff'];
  const ehCamada = nome => EXT_VETOR.includes(extensao(nome)) || EXT_RASTER.includes(extensao(nome));

  async function lerVetor(blob, nome) {
    const ext = extensao(nome);
    if (ext === 'geojson' || ext === 'json') return JSON.parse(await blob.text());
    if (ext === 'kml' || ext === 'gpx') {
      await carregarScript('lib/togeojson.umd.js');
      const xml = new DOMParser().parseFromString(await blob.text(), 'text/xml');
      return ext === 'kml' ? toGeoJSON.kml(xml) : toGeoJSON.gpx(xml);
    }
    if (ext === 'kmz') {
      await carregarScript('lib/jszip.min.js'); await carregarScript('lib/togeojson.umd.js');
      const zip = await JSZip.loadAsync(await blob.arrayBuffer());
      const kml = Object.keys(zip.files).find(n => n.toLowerCase().endsWith('.kml'));
      if (!kml) throw new Error('KMZ sem arquivo KML.');
      return toGeoJSON.kml(new DOMParser().parseFromString(await zip.file(kml).async('text'), 'text/xml'));
    }
    if (ext === 'zip') {
      await carregarScript('lib/shp.min.js');
      let r = await shp(await blob.arrayBuffer());
      if (Array.isArray(r)) r = { type: 'FeatureCollection', features: r.flatMap(x => x.features) };
      return r;
    }
    if (ext === 'csv') {
      const linhas = (await blob.text()).split(/\r?\n/).filter(Boolean);
      const sep = linhas[0].includes(';') ? ';' : ',';
      const cab = linhas[0].split(sep).map(s => s.trim().toLowerCase());
      const iLat = cab.findIndex(c => /^(lat|latitude|y)$/.test(c)), iLon = cab.findIndex(c => /^(lon|lng|long|longitude|x)$/.test(c));
      if (iLat < 0 || iLon < 0) throw new Error('CSV precisa de colunas lat/lon (ou latitude/longitude).');
      return { type: 'FeatureCollection', features: linhas.slice(1).map(l => {
        const v = l.split(sep); const props = {}; cab.forEach((c, i) => props[c] = v[i]);
        return { type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [parseFloat(String(v[iLon]).replace(',', '.')), parseFloat(String(v[iLat]).replace(',', '.'))] } };
      }).filter(f => isFinite(f.geometry.coordinates[0]) && isFinite(f.geometry.coordinates[1])) };
    }
    throw new Error('Formato não suportado: .' + ext);
  }

  function popupProps(p) {
    const ks = Object.keys(p || {}).filter(k => p[k] !== null && p[k] !== '' && typeof p[k] !== 'object').slice(0, 15);
    return ks.length ? '<table>' + ks.map(k => `<tr><td><b>${esc(k)}</b></td><td>${esc(p[k])}</td></tr>`).join('') + '</table>' : 'Sem atributos';
  }

  async function mostrarCamada(rec) {
    iniciar();
    if (camadasImportadas.has(rec.id)) return camadasImportadas.get(rec.id).layer;
    const blob = await API.obterBlob(rec);
    if (!blob) throw new Error('Arquivo não disponível neste aparelho (sincronize com internet).');
    const ext = extensao(rec.nome);
    const est = rec.estilo || {};
    let layer;
    if (EXT_RASTER.includes(ext)) {
      await carregarScript('lib/georaster.browser.bundle.min.js');
      await carregarScript('lib/georaster-layer-for-leaflet.min.js');
      const gr = await parseGeoraster(await blob.arrayBuffer());
      const nb = gr.numberOfRasters, nd = gr.noDataValue;
      const mins = gr.mins || [], maxs = gr.maxs || [];
      const estica = (v, i) => { const mn = mins[i] ?? 0, mx = maxs[i] ?? 255; if (mx <= 255 && mn >= 0) return v; return Math.round(Math.max(0, Math.min(1, (v - mn) / ((mx - mn) || 1))) * 255); };
      layer = new GeoRasterLayer({
        georaster: gr, opacity: est.opacidade ?? 1, resolution: 256,
        pixelValuesToColorFn: vals => {
          if (vals.every(v => v === nd || v === null || Number.isNaN(v))) return null;
          if (nb >= 4 && vals[3] === 0) return null;
          if (nb >= 3) { const r = estica(vals[0], 0), g = estica(vals[1], 1), b = estica(vals[2], 2); if (r === 0 && g === 0 && b === 0 && nd == null) return null; return `rgb(${r},${g},${b})`; }
          const mn = mins[0] ?? 0, mx = maxs[0] ?? 255, t = Math.max(0, Math.min(1, (vals[0] - mn) / ((mx - mn) || 1)));
          const c = Math.round(t * 255); return `rgb(${c},${c},${c})`;
        }
      });
    } else {
      const gj = await lerVetor(blob, rec.nome);
      const e2 = estiloDe(rec);
      const opac = e2.opacidade ?? 1;
      layer = L.geoJSON(gj, {
        pmIgnore: true,
        style: () => ({ color: e2.cor, weight: e2.espessura ?? 2, opacity: opac, fillColor: e2.preenchimento || e2.cor, fillOpacity: (e2.opacidadePreenchimento ?? 0.1) * opac }),
        pointToLayer: (_, ll) => L.circleMarker(ll, { radius: e2.raio ?? 4, color: e2.cor === (e2.preenchimento || e2.cor) ? '#ffffff' : e2.cor, weight: 1, opacity: opac, fillColor: e2.preenchimento || e2.cor, fillOpacity: 0.95 * opac }),
        onEachFeature: (ft, l) => l.bindPopup(`<div class="pop"><b>${esc(nomeCam(rec))}</b><br><small>${esc(grupoDe(rec))}</small><br>${popupProps(ft.properties)}</div>`)
      });
    }
    layer.addTo(map);
    camadasImportadas.set(rec.id, { layer, rec, raster: EXT_RASTER.includes(ext) });
    reordenar();
    return layer;
  }

  function ocultarCamada(id) {
    const c = camadasImportadas.get(id);
    if (c) { map.removeLayer(c.layer); camadasImportadas.delete(id); }
  }

  function limparCamadas() { [...camadasImportadas.keys()].forEach(ocultarCamada); }

  async function restaurarCamadas(arquivos) {
    const lista = arquivos.filter(a => a.visivel && !a.excluido && !a.pacote && ehCamada(a.nome)).sort((a, b) => (b.ordem ?? 999) - (a.ordem ?? 999));
    for (const a of lista) { try { await mostrarCamada(a); } catch (e) { console.warn(e); } }
    reordenar();
  }

  function zoomCamada(id) {
    const c = camadasImportadas.get(id);
    if (!c) return;
    try { map.fitBounds(c.layer.getBounds(), { padding: [20, 20] }); } catch (e) {}
  }

  function estilizarCamada(id, est) {
    const c = camadasImportadas.get(id);
    if (!c) return;
    if (c.layer.setOpacity && est.opacidade !== undefined) c.layer.setOpacity(est.opacidade);
    if (c.layer.setStyle && est.cor) {
      c.layer.setStyle({ color: est.cor, fillColor: est.cor });
      c.layer.eachLayer && c.layer.eachLayer(l => l.setStyle && l instanceof L.CircleMarker && l.setStyle({ fillColor: est.cor }));
    }
  }

  function linhaCamada(a) {
    const e2 = estiloDe(a);
    return `<div class="camada-linha">
      <input type="checkbox" ${camadasImportadas.has(a.id) ? 'checked' : ''} onchange="Mapa.alternarCamada('${a.id}',this.checked)">
      <span class="amostra" style="${EXT_RASTER.includes(extensao(a.nome)) ? 'background:linear-gradient(135deg,#6b8e23,#c2b280)' : `border-color:${e2.cor};background:${e2.preenchimento || e2.cor}${e2.opacidadePreenchimento === 0 ? '00' : '55'}`}"></span>
      <span class="nome" title="${esc(a.nome)}">${esc(nomeCam(a))} ${a.local ? '<span class="tag local">local</span>' : ''}</span>
      ${EXT_RASTER.includes(extensao(a.nome))
        ? `<input type="range" min="0.1" max="1" step="0.1" value="${(a.estilo && a.estilo.opacidade) ?? 1}" onchange="Mapa.mudarEstilo('${a.id}',{opacidade:+this.value})" title="Opacidade">`
        : `<input type="color" value="${e2.cor}" onchange="Mapa.mudarEstilo('${a.id}',{cor:this.value})" title="Cor">`}
      <button class="btn peq" onclick="Mapa.zoomCamada('${a.id}')" title="Aproximar">⌖</button>
    </div>`;
  }

  // árvore na ordem do QGIS: camadas e grupos intercalados conforme aparecem
  function arvore(arqs) {
    const raiz = { nome: '', itens: [], filhos: new Map() };
    arqs.forEach(a => {
      let no = raiz;
      grupoDe(a).split(' / ').filter(Boolean).forEach(g => {
        if (!no.filhos.has(g)) { const n = { nome: g, itens: [], filhos: new Map() }; no.filhos.set(g, n); no.itens.push({ grupo: n }); }
        no = no.filhos.get(g);
      });
      no.itens.push({ camada: a });
    });
    return raiz;
  }
  const todasDe = n => n.itens.flatMap(i => i.camada ? [i.camada] : todasDe(i.grupo));
  function htmlArvore(no, caminho, nivel, linha = linhaCamada, comCheck = true) {
    return no.itens.map(it => {
      if (it.camada) return linha(it.camada);
      const f = it.grupo, cam = caminho ? caminho + ' / ' + f.nome : f.nome;
      const todas = todasDe(f), lig = todas.filter(a => camadasImportadas.has(a.id)).length;
      return `<details class="grupo-cam" ${nivel < 1 ? 'open' : ''}><summary>
        ${comCheck ? `<input type="checkbox" ${lig === todas.length ? 'checked' : ''} ${lig && lig < todas.length ? 'data-parcial="1"' : ''} onclick="event.stopPropagation()" onchange="Mapa.alternarGrupo(${esc(JSON.stringify(cam))},this.checked)">` : ''}
        <span class="pasta-ic">📁</span><b>${esc(f.nome)}</b> <small class="mudo">(${todas.length})</small></summary>
        <div class="grupo-corpo">${htmlArvore(f, cam, nivel + 1, linha, comCheck)}</div></details>`;
    }).join('');
  }
  const arvoreHtml = (arqs, linha, comCheck) => htmlArvore(arvore(arqs), '', 0, linha, comCheck);

  async function painelCamadas() {
    const arqs = (await App.arquivosDoProjeto()).filter(a => !a.excluido && !a.pacote && ehCamada(a.nome))
      .sort((a, b) => (a.ordem ?? 1e9) - (b.ordem ?? 1e9) || nomeCam(a).localeCompare(nomeCam(b)));
    const base = localStorage.getItem('gc_base') || 'google_sat';
    App.modal(`
      <div class="modal-cab"><h2>Camadas</h2><button class="fechar" onclick="App.fecharModal()">✕</button></div>
      <h3 style="margin-top:0">Mapa de fundo</h3>
      <div class="base-op">${Object.entries(BASES).map(([k, b]) => `<button class="${k === base ? 'ativo' : ''}" onclick="Mapa.trocarBase('${k}');Mapa.painelCamadas()">${b.nome}</button>`).join('')}</div>
      <h3>Registrado no app</h3>
      <div class="chips">
        <label class="chip"><input type="checkbox" ${visTipos.Point ? 'checked' : ''} onchange="Mapa.visTipo('Point',this.checked)"> Pontos</label>
        <label class="chip"><input type="checkbox" ${visTipos.LineString ? 'checked' : ''} onchange="Mapa.visTipo('LineString',this.checked)"> Linhas</label>
        <label class="chip"><input type="checkbox" ${visTipos.Polygon ? 'checked' : ''} onchange="Mapa.visTipo('Polygon',this.checked)"> Polígonos</label>
        <label class="chip"><input type="checkbox" ${mostrarRotulos ? 'checked' : ''} onchange="Mapa.rotulos(this.checked)"> Rótulos</label>
      </div>
      <h3>Camadas importadas <small class="mudo">(${arqs.length})</small></h3>
      ${arqs.length ? `<div class="linha-btns" style="margin-bottom:6px"><button class="btn peq" onclick="Mapa.alternarGrupo('',true)">Ligar todas</button><button class="btn peq" onclick="Mapa.alternarGrupo('',false)">Desligar todas</button></div>
        <div class="arvore">${htmlArvore(arvore(arqs), '', 0)}</div>`
        : '<p class="mudo">Nenhuma camada. Importe um projeto do QGIS compactado (.zip), GeoPackage, shapefile, KML/KMZ, GeoJSON, GPX, CSV ou GeoTIFF.</p>'}
      <div class="linha-btns" style="margin-top:14px">
        <button class="btn primario" onclick="App.escolherArquivos('Vetores', true)">+ Importar camada</button>
        <button class="btn" onclick="Mapa.enquadrarProjeto();App.fecharModal()">Enquadrar projeto</button>
      </div>`);
    document.querySelectorAll('.arvore input[data-parcial]').forEach(i => i.indeterminate = true);
  }

  async function alternarGrupo(caminho, ligar) {
    const arqs = (await App.arquivosDoProjeto()).filter(a => !a.excluido && !a.pacote && ehCamada(a.nome) && (!caminho || grupoDe(a) === caminho || grupoDe(a).startsWith(caminho + ' / ')))
      .sort((a, b) => (b.ordem ?? 999) - (a.ordem ?? 999));
    App.toast(ligar ? 'Carregando camadas…' : 'Desligando camadas…');
    for (const a of arqs) {
      try {
        if (ligar) await mostrarCamada(a); else ocultarCamada(a.id);
        a.visivel = !!ligar; await DB.put('arquivos', a);
      } catch (e) { App.toast(`${nomeCam(a)}: ${e.message}`, true); }
    }
    reordenar();
    if (!document.getElementById('modal').hidden) painelCamadas();
  }

  async function alternarCamada(id, ligar) {
    const rec = await DB.get('arquivos', id);
    if (!rec) return;
    try {
      if (ligar) { App.toast('Carregando camada…'); await mostrarCamada(rec); App.toast('Camada carregada.'); }
      else ocultarCamada(id);
      rec.visivel = !!ligar; await DB.put('arquivos', rec); // preferência local, não sincroniza
    } catch (e) { App.toast(e.message, true); }
  }

  async function mudarEstilo(id, est) {
    const rec = await DB.get('arquivos', id);
    if (est.cor) est.preenchimento = est.cor;
    rec.estilo = Object.assign({}, rec.estilo, est); rec.atualizadoEm = Date.now(); rec._sujo = rec.local ? 0 : 1;
    await DB.put('arquivos', rec);
    estilizarCamada(id, est);
  }

  function visTipo(t, v) { visTipos[t] = v; App.redesenharMapa(); }
  function rotulos(v) { mostrarRotulos = v; App.redesenharMapa(); }

  /* ---------------- mapa offline ---------------- */
  async function baixarOffline() {
    if (!navigator.onLine) return App.toast('Conecte-se à internet para baixar o mapa.', true);
    const chave = localStorage.getItem('gc_base') || 'google_sat';
    const b = BASES[chave]; if (!b) return;
    const z0 = map.getZoom(), bnds = map.getBounds();
    const zMax = Math.min(b.max, Math.max(z0 + 3, 18));
    const tiles = [];
    const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
    const lat2y = (lat, z) => Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z);
    for (let z = Math.max(z0 - 2, 3); z <= zMax; z++) {
      const x1 = lon2x(bnds.getWest(), z), x2 = lon2x(bnds.getEast(), z), y1 = lat2y(bnds.getNorth(), z), y2 = lat2y(bnds.getSouth(), z);
      for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) tiles.push({ x, y, z });
    }
    if (tiles.length > 6000) return App.toast(`Área grande demais (${tiles.length} blocos). Aproxime mais o mapa.`, true);
    if (!confirm(`Baixar ${tiles.length} blocos de "${b.nome}" (zoom até ${zMax}) para uso offline? (≈ ${Math.round(tiles.length * 0.02)} MB)`)) return;
    const cache = await caches.open('gc-tiles');
    let feitos = 0, erros = 0;
    const fila = tiles.slice();
    const trab = async () => {
      while (fila.length) {
        const t = fila.shift();
        const s = b.sub.length ? b.sub[(t.x + t.y) % b.sub.length] : 'a';
        const u = b.url.replace('{s}', s).replace('{x}', t.x).replace('{y}', t.y).replace('{z}', t.z);
        try { if (!(await cache.match(u))) { const r = await fetch(u, { mode: 'no-cors' }); await cache.put(u, r); } } catch (e) { erros++; }
        feitos++;
        if (feitos % 25 === 0 || feitos === tiles.length) App.toast(`Baixando mapa offline: ${feitos}/${tiles.length}`);
      }
    };
    await Promise.all(Array.from({ length: 6 }, trab));
    App.toast(`Mapa offline pronto (${feitos - erros} blocos${erros ? ', ' + erros + ' falhas' : ''}).`);
  }

  const PALETA_CAM = ['#ff7f0e', '#1f77b4', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#17becf', '#bcbd22', '#ffd92f', '#00e5ff', '#ff4081', '#7cb342', '#ab47bc', '#ffa726', '#26a69a'];
  function corPadrao(rec) { let h = 0; const t = rec.nome + (rec.grupo || ''); for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0; return PALETA_CAM[h % PALETA_CAM.length]; }
  const estiloDe = rec => Object.assign({ cor: corPadrao(rec) }, rec.estilo || {});
  const nomeCam = a => a.nomeCamada || a.nome.replace(/\.(zip|geojson|json|kml|kmz|gpx|csv|tiff?)$/i, '');
  const grupoDe = a => a.grupo || (a.pacoteNome ? a.pacoteNome.replace(/\.(zip|gpkg)$/i, '') : 'Outras camadas');

  function reordenar() {
    if (!map) return;
    const vis = [...camadasImportadas.values()].sort((a, b) => (b.rec.ordem ?? 999) - (a.rec.ordem ?? 999));
    let z = 1;
    vis.forEach(c => { if (c.layer.setZIndex && !c.layer.bringToFront) c.layer.setZIndex(z++); else if (c.layer.bringToFront) c.layer.bringToFront(); });
    vis.filter(c => c.raster).forEach((c, i) => c.layer.setZIndex && c.layer.setZIndex(10 + i));
    grupoFeicoes && grupoFeicoes.bringToFront();
  }

  function esc(s) { return App.esc(s); }

  return {
    iniciar, ajustar, trocarBase, desenharFeicoes, focar, enquadrarProjeto, desenhar, editarGeometria,
    alternarGPS, pontoGPS, alternarTrilha, obterPosicao, painelCamadas, alternarCamada, mudarEstilo, zoomCamada,
    visTipo, rotulos, baixarOffline, carregarScript, alternarGrupo, arvoreHtml, reordenar, nomeCam, grupoDe, estiloDe, mostrarCamada, ocultarCamada, limparCamadas, restaurarCamadas, ehCamada, lerVetor, extensao,
    posicaoAtual: () => ultimaPos
  };
})();
