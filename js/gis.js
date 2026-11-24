/* Leitura e escrita de formatos GIS: pacotes ZIP do QGIS, GeoPackage, exportação para QGIS */
const GIS = (() => {
  let sqlP = null;
  const carregarSQL = async () => {
    if (!sqlP) sqlP = (async () => { await Mapa.carregarScript('lib/sql-wasm.js'); return initSqlJs({ locateFile: f => 'lib/' + f }); })();
    return sqlP;
  };
  const ext = n => Mapa.extensao(n);
  const base = n => String(n).split('/').pop().replace(/\.[^.]+$/, '');
  const VET = ['geojson', 'json', 'kml', 'kmz', 'gpx', 'csv'];
  const RAS = ['tif', 'tiff'];

  /* ---------------- projeções ---------------- */
  function defProj(srsId, org, orgId, wkt) {
    const id = Number(orgId || srsId);
    if (!id || [4326, 4674, 4618, 4989].includes(id)) return null; // geográficas ~WGS84
    if (id >= 31965 && id <= 31985) {
      const z = id >= 31978 ? id - 31960 : id - 31954; const sul = id >= 31977;
      return `+proj=utm +zone=${z} ${sul ? '+south ' : ''}+ellps=GRS80 +towgs84=0,0,0 +units=m +no_defs`;
    }
    if (id >= 32601 && id <= 32660) return `+proj=utm +zone=${id - 32600} +datum=WGS84 +units=m +no_defs`;
    if (id >= 32701 && id <= 32760) return `+proj=utm +zone=${id - 32700} +south +datum=WGS84 +units=m +no_defs`;
    if (id === 3857 || id === 900913) return 'EPSG:3857';
    if (id >= 29190 && id <= 29195) return `+proj=utm +zone=${id - 29170} +south +ellps=aust_SA +towgs84=-67.35,3.88,-38.22,0,0,0,0 +units=m +no_defs`; // SAD69
    return wkt && wkt !== 'undefined' ? wkt : null;
  }
  function projetor(def) {
    if (!def) return null;
    try { const p = proj4(def, 'EPSG:4326'); return c => p.forward([c[0], c[1]]); } catch (e) { console.warn('projeção não reconhecida', e); return null; }
  }
  function reprojetar(g, f) {
    if (!g || !f) return g;
    const rec = c => typeof c[0] === 'number' ? f(c) : c.map(rec);
    if (g.type === 'GeometryCollection') return { type: g.type, geometries: g.geometries.map(x => reprojetar(x, f)) };
    return { type: g.type, coordinates: rec(g.coordinates) };
  }

  /* ---------------- WKB ---------------- */
  function lerWKB(dv, o) {
    const le = dv.getUint8(o) === 1; o += 1;
    let t = dv.getUint32(o, le); o += 4;
    let z = false, m = false;
    if (t & 0x80000000) z = true; if (t & 0x40000000) m = true;
    if (t & 0x20000000) o += 4; // SRID (EWKB)
    t &= 0x0fffffff;
    if (t >= 3000) { z = m = true; t -= 3000; } else if (t >= 2000) { m = true; t -= 2000; } else if (t >= 1000) { z = true; t -= 1000; }
    const dim = 2 + (z ? 1 : 0) + (m ? 1 : 0);
    const pt = () => { const c = [dv.getFloat64(o, le), dv.getFloat64(o + 8, le)]; o += 8 * dim; return c; };
    const pts = () => { const n = dv.getUint32(o, le); o += 4; const a = []; for (let i = 0; i < n; i++) a.push(pt()); return a; };
    const aneis = () => { const n = dv.getUint32(o, le); o += 4; const a = []; for (let i = 0; i < n; i++) a.push(pts()); return a; };
    const multi = () => { const n = dv.getUint32(o, le); o += 4; const a = []; for (let i = 0; i < n; i++) { const r = lerWKB(dv, o); o = r.o; a.push(r.g); } return a; };
    let g;
    if (t === 1) { const c = pt(); g = isNaN(c[0]) ? null : { type: 'Point', coordinates: c }; }
    else if (t === 2) g = { type: 'LineString', coordinates: pts() };
    else if (t === 3) g = { type: 'Polygon', coordinates: aneis() };
    else if (t === 4) g = { type: 'MultiPoint', coordinates: multi().filter(Boolean).map(x => x.coordinates) };
    else if (t === 5) g = { type: 'MultiLineString', coordinates: multi().map(x => x.coordinates) };
    else if (t === 6) g = { type: 'MultiPolygon', coordinates: multi().map(x => x.coordinates) };
    else if (t === 7) g = { type: 'GeometryCollection', geometries: multi().filter(Boolean) };
    else throw new Error('Geometria WKB não suportada: ' + t);
    return { g, o };
  }
  function lerGeomGpkg(u8) {
    if (!u8 || u8.length < 8) return null;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (u8[0] !== 0x47 || u8[1] !== 0x50) return lerWKB(dv, 0).g; // WKB puro
    const flags = u8[3];
    if (flags & 0x10) return null; // vazia
    const env = [0, 32, 48, 48, 64][(flags >> 1) & 7] || 0;
    return lerWKB(dv, 8 + env).g;
  }

  function escreverWKB(g) {
    const partes = [];
    const u8 = v => partes.push(Uint8Array.of(v));
    const u32 = v => { const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, v, true); partes.push(new Uint8Array(b.buffer)); };
    const f64s = arr => { const b = new DataView(new ArrayBuffer(8 * arr.length)); arr.forEach((v, i) => b.setFloat64(i * 8, v, true)); partes.push(new Uint8Array(b.buffer)); };
    const pt = c => f64s([c[0], c[1]]);
    const linha = cs => { u32(cs.length); cs.forEach(pt); };
    const geo = g => {
      u8(1);
      if (g.type === 'Point') { u32(1); pt(g.coordinates); }
      else if (g.type === 'LineString') { u32(2); linha(g.coordinates); }
      else if (g.type === 'Polygon') { u32(3); u32(g.coordinates.length); g.coordinates.forEach(linha); }
      else if (g.type === 'MultiPoint') { u32(4); u32(g.coordinates.length); g.coordinates.forEach(c => geo({ type: 'Point', coordinates: c })); }
      else if (g.type === 'MultiLineString') { u32(5); u32(g.coordinates.length); g.coordinates.forEach(c => geo({ type: 'LineString', coordinates: c })); }
      else if (g.type === 'MultiPolygon') { u32(6); u32(g.coordinates.length); g.coordinates.forEach(c => geo({ type: 'Polygon', coordinates: c })); }
    };
    geo(g);
    const tot = partes.reduce((s, p) => s + p.length, 0), out = new Uint8Array(tot);
    let o = 0; partes.forEach(p => { out.set(p, o); o += p.length; });
    return out;
  }
  function geomGpkg(g, srs = 4326) {
    const wkb = escreverWKB(g), h = new Uint8Array(8 + wkb.length);
    h.set([0x47, 0x50, 0, 0x01]); new DataView(h.buffer).setInt32(4, srs, true); h.set(wkb, 8);
    return h;
  }

  /* ---------------- GeoPackage: leitura ---------------- */
  async function lerGpkg(buf, nomeArq) {
    const SQL = await carregarSQL();
    const db = new SQL.Database(new Uint8Array(buf));
    try {
      const r = db.exec(`SELECT g.table_name, g.column_name, g.srs_id, s.organization, s.organization_coordsys_id, s.definition
        FROM gpkg_geometry_columns g LEFT JOIN gpkg_spatial_ref_sys s ON s.srs_id = g.srs_id`);
      if (!r.length) return [];
      const camadas = [];
      for (const [tab, col, srs, org, orgId, wkt] of r[0].values) {
        const f = projetor(defProj(srs, org, orgId, wkt));
        const res = db.exec(`SELECT * FROM "${String(tab).replace(/"/g, '""')}"`);
        const feats = [];
        if (res.length) {
          const cols = res[0].columns, ig = cols.indexOf(col);
          for (const row of res[0].values) {
            let g = null; try { g = lerGeomGpkg(row[ig]); } catch (e) {}
            if (!g) continue;
            const props = {};
            cols.forEach((c, i) => { if (i !== ig && !(row[i] instanceof Uint8Array)) props[c] = row[i]; });
            feats.push({ type: 'Feature', properties: props, geometry: reprojetar(g, f) });
          }
        }
        camadas.push({ nome: `${base(nomeArq)} - ${tab}`, tabela: String(tab), geojson: { type: 'FeatureCollection', features: feats } });
      }
      return camadas;
    } finally { db.close(); }
  }

  /* ---------------- Projeto QGIS (.qgs/.qgz): grupos, ordem e estilos ---------------- */
  function corRGBA(v) {
    const n = String(v || '').split(',').slice(0, 4).map(Number);
    if (n.length < 3 || n.some(isNaN)) return null;
    const hex = '#' + n.slice(0, 3).map(x => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('');
    return { hex, a: n.length > 3 ? n[3] / 255 : 1 };
  }
  function propsSimbolo(el) {
    const p = {};
    el.querySelectorAll(':scope > prop').forEach(x => p[x.getAttribute('k')] = x.getAttribute('v'));
    const mapa = el.querySelector(':scope > Option[type="Map"]');
    if (mapa) mapa.querySelectorAll(':scope > Option').forEach(x => p[x.getAttribute('name')] = x.getAttribute('value'));
    return p;
  }
  function estiloQgis(ml) {
    const geom = (ml.getAttribute('geometry') || '').toLowerCase();
    const est = {};
    const op = ml.querySelector(':scope > layerOpacity'); if (op) est.opacidade = Number(op.textContent);
    const simb = ml.querySelector('renderer-v2 symbol');
    if (!simb) return est;
    const camada = simb.querySelector(':scope > layer');
    if (!camada) return est;
    const p = propsSimbolo(camada);
    const alpha = Number(simb.getAttribute('alpha') || 1);
    const mm = v => Math.max(1, Math.min(6, (Number(v) || 0.26) * 3.78));
    if (geom === 'line') {
      const c = corRGBA(p.line_color || p.color); if (c) est.cor = c.hex;
      est.espessura = mm(p.line_width);
    } else {
      const f = corRGBA(p.color), o = corRGBA(p.outline_color || p.line_color);
      if (geom === 'polygon') {
        if (o && p.outline_style !== 'no') est.cor = o.hex; else if (f) est.cor = f.hex;
        if (f && p.style !== 'no') { est.preenchimento = f.hex; est.opacidadePreenchimento = Math.min(0.6, f.a * alpha * 0.6); } else est.opacidadePreenchimento = 0;
        est.espessura = mm(p.outline_width);
      } else {
        if (f) est.preenchimento = f.hex; if (o) est.cor = o.hex; else if (f) est.cor = f.hex;
        est.raio = Math.max(3, Math.min(9, (Number(p.size) || 2) * 2));
        est.opacidadePreenchimento = 0.95;
      }
    }
    return est;
  }
  function chaveFonte(ds) {
    const ln = (String(ds).match(/layername=([^|&]+)/i) || [])[1];
    const caminho = String(ds).split('|')[0].replace(/^\/vsizip\//, '').replace(/\\/g, '/');
    const b = base(caminho).toLowerCase();
    return ln ? b + '|' + decodeURIComponent(ln).toLowerCase() : b;
  }
  function lerProjetoQgs(xml) {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const maplayers = {};
    doc.querySelectorAll('projectlayers > maplayer').forEach(ml => { const id = ml.querySelector(':scope > id'); if (id) maplayers[id.textContent] = ml; });
    const camadas = []; let ordem = 0;
    const percorrer = (no, grupos, ligado) => {
      [...no.children].forEach(el => {
        if (el.tagName === 'layer-tree-group') {
          percorrer(el, [...grupos, el.getAttribute('name')], ligado && el.getAttribute('checked') !== 'Qt::Unchecked');
        } else if (el.tagName === 'layer-tree-layer') {
          const ml = maplayers[el.getAttribute('id')];
          const ds = el.getAttribute('source') || (ml && ml.querySelector(':scope > datasource') ? ml.querySelector(':scope > datasource').textContent : '');
          if (!ds || /type=xyz|url=http|memory\?|^http/i.test(ds)) return;
          camadas.push({ nome: el.getAttribute('name'), grupo: grupos.join(' / '), ordem: ordem++, visivel: ligado && el.getAttribute('checked') !== 'Qt::Unchecked',
            chave: chaveFonte(ds), estilo: ml ? estiloQgis(ml) : {} });
        }
      });
    };
    const raiz = doc.querySelector('qgis > layer-tree-group');
    if (raiz) percorrer(raiz, [], true);
    return camadas;
  }

  /* ---------------- ZIP do QGIS ---------------- */
  async function analisarZip(file) {
    await Mapa.carregarScript('lib/jszip.min.js');
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const nomes = Object.keys(zip.files).filter(n => !zip.files[n].dir && !/(^|\/)(__MACOSX|\.)/.test(n));
    const shp = nomes.filter(n => ext(n) === 'shp');
    const outros = nomes.filter(n => ['gpkg', ...VET, ...RAS].includes(ext(n)));
    const qgis = nomes.filter(n => ['qgs', 'qgz'].includes(ext(n)));
    return { zip, nomes, shp, outros, qgis, pacote: !(shp.length === 1 && !outros.length && !qgis.length) };
  }

  /** Extrai cada conjunto de dados do ZIP. Retorna [{ nome, blob, pasta, camada, grupo, nomeCamada, ordem, estilo, visivel }] */
  async function importarPacote(info, avisar = () => {}) {
    const saida = [];
    const pastaDe = n => { const partes = n.split('/').slice(0, -1); if (partes.length && info.nomes.every(x => x.startsWith(partes[0] + '/'))) partes.shift(); return partes.join(' / '); };
    for (const s of info.shp) {
      const raiz = s.slice(0, -4);
      const z = new JSZip();
      for (const e of ['shp', 'shx', 'dbf', 'prj', 'cpg']) {
        const n = info.nomes.find(x => x.slice(0, -4).toLowerCase() === raiz.toLowerCase() && ext(x) === e);
        if (n) z.file(base(s) + '.' + e, await info.zip.file(n).async('uint8array'));
      }
      saida.push({ nome: base(s) + '.zip', nomeCamada: base(s), blob: await z.generateAsync({ type: 'blob' }), pasta: 'Vetores', camada: true, chave: base(s).toLowerCase(), grupo: pastaDe(s) });
    }
    for (const n of info.outros) {
      avisar('Lendo ' + base(n) + '…');
      const e = ext(n);
      const blob = await info.zip.file(n).async('blob');
      if (e === 'gpkg') {
        const cams = await lerGpkg(await blob.arrayBuffer(), n);
        for (const c of cams) {
          if (!c.geojson.features.length) continue;
          saida.push({ nome: c.nome + '.geojson', nomeCamada: c.tabela, blob: new Blob([JSON.stringify(c.geojson)], { type: 'application/geo+json' }), pasta: 'Vetores', camada: true,
            chave: base(n).toLowerCase() + '|' + c.tabela.toLowerCase(), chaveArq: base(n).toLowerCase(), grupo: pastaDe(n) });
        }
      } else saida.push({ nome: n.split('/').pop(), nomeCamada: base(n), blob, pasta: RAS.includes(e) ? 'Imagens e Raster' : 'Vetores', camada: true, chave: base(n).toLowerCase(), grupo: pastaDe(n) });
    }
    // aplica grupos, ordem, nomes e estilos do projeto QGIS, se houver
    let proj = [];
    for (const q of info.qgis) {
      try {
        let xml;
        if (ext(q) === 'qgz') {
          const z2 = await JSZip.loadAsync(await info.zip.file(q).async('arraybuffer'));
          const qn = Object.keys(z2.files).find(x => x.toLowerCase().endsWith('.qgs'));
          if (qn) xml = await z2.file(qn).async('text');
        } else xml = await info.zip.file(q).async('text');
        if (xml) proj = proj.concat(lerProjetoQgs(xml));
      } catch (err) { console.warn('Projeto QGIS não lido', err); }
    }
    if (proj.length) {
      avisar('Aplicando grupos e estilos do projeto QGIS…');
      const usados = new Set();
      for (const it of saida) {
        let c = proj.find(p => !usados.has(p) && p.chave === it.chave);
        if (!c && it.chaveArq) c = proj.find(p => !usados.has(p) && p.chave === it.chaveArq && saida.filter(x => x.chaveArq === it.chaveArq).length === 1);
        if (c) { usados.add(c); Object.assign(it, { nomeCamada: c.nome, grupo: c.grupo, ordem: c.ordem, estilo: c.estilo, visivel: c.visivel }); }
      }
      // camadas que não estão no projeto ficam por último
      let extra = proj.length;
      saida.filter(it => it.ordem === undefined).forEach(it => { it.ordem = extra++; it.grupo = it.grupo || 'Fora do projeto QGIS'; });
    } else saida.forEach((it, i) => it.ordem = i);
    saida.forEach(it => { if (it.visivel === undefined) it.visivel = true; });
    return { itens: saida, temProjeto: proj.length > 0 };
  }

  async function gpkgParaCamadas(file) {
    return (await lerGpkg(await file.arrayBuffer(), file.name)).filter(c => c.geojson.features.length)
      .map(c => ({ nome: c.nome + '.geojson', blob: new Blob([JSON.stringify(c.geojson)], { type: 'application/geo+json' }), pasta: 'Vetores', camada: true }));
  }

  /* ---------------- Exportação para QGIS ---------------- */
  const nomeSeguro = s => String(s || 'projeto').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'projeto';
  const colSegura = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'campo';
  const xe = s => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  async function criarGpkg(camadas) {
    const SQL = await carregarSQL();
    const db = new SQL.Database();
    db.run(`PRAGMA application_id = 1196444487; PRAGMA user_version = 10300;
      CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL, srs_id INTEGER PRIMARY KEY, organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL, description TEXT);
      CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL, identifier TEXT UNIQUE, description TEXT DEFAULT '', last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER, CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id));
      CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL, geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL, z TINYINT NOT NULL, m TINYINT NOT NULL, CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name));`);
    db.run(`INSERT INTO gpkg_spatial_ref_sys VALUES
      ('Undefined cartesian SRS', -1, 'NONE', -1, 'undefined', NULL),
      ('Undefined geographic SRS', 0, 'NONE', 0, 'undefined', NULL),
      ('WGS 84 geodetic', 4326, 'EPSG', 4326, 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AXIS["Latitude",NORTH],AXIS["Longitude",EAST],AUTHORITY["EPSG","4326"]]', 'longitude/latitude WGS 84')`);
    for (const c of camadas) {
      const cols = [...new Set(c.features.flatMap(f => Object.keys(f.properties)))];
      db.run(`CREATE TABLE "${c.tabela}" (fid INTEGER PRIMARY KEY AUTOINCREMENT, geom ${c.tipoGeom.toUpperCase()}${cols.map(k => `, "${k}" TEXT`).join('')})`);
      const st = db.prepare(`INSERT INTO "${c.tabela}" (geom${cols.map(k => `, "${k}"`).join('')}) VALUES (?${cols.map(() => ', ?').join('')})`);
      let bb = [Infinity, Infinity, -Infinity, -Infinity];
      for (const f of c.features) {
        const rec = cs => typeof cs[0] === 'number' ? (bb = [Math.min(bb[0], cs[0]), Math.min(bb[1], cs[1]), Math.max(bb[2], cs[0]), Math.max(bb[3], cs[1])]) : cs.forEach(rec);
        rec(f.geometry.coordinates);
        st.run([geomGpkg(f.geometry), ...cols.map(k => f.properties[k] == null ? null : String(f.properties[k]))]);
      }
      st.free();
      if (!isFinite(bb[0])) bb = [null, null, null, null];
      db.run('INSERT INTO gpkg_contents (table_name, data_type, identifier, description, min_x, min_y, max_x, max_y, srs_id) VALUES (?,?,?,?,?,?,?,?,4326)', [c.tabela, 'features', c.nome, c.nome, ...bb]);
      db.run("INSERT INTO gpkg_geometry_columns VALUES (?, 'geom', ?, 4326, 0, 0)", [c.tabela, c.tipoGeom.toUpperCase()]);
    }
    const out = db.export(); db.close();
    return out;
  }

  function merc(lon, lat) { const x = lon * 20037508.34 / 180; const y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180) * 20037508.34 / 180; return [x, y]; }

  function projetoQgs(nome, camadas, extensao) {
    const uid = () => 'l_' + Math.random().toString(36).slice(2, 10);
    const ls = camadas.map(c => Object.assign({ id: uid() }, c));
    const google = { id: uid(), nome: 'Google Satélite', tipo: 'raster', provider: 'wms', fonte: 'type=xyz&amp;url=https://mt1.google.com/vt/lyrs%3Ds%26x%3D%7Bx%7D%26y%3D%7By%7D%26z%3D%7Bz%7D&amp;zmax=20&amp;zmin=0', srs: 'EPSG:3857' };
    const todas = [...ls, google];
    const crs = a => `<spatialrefsys nativeFormat="Wkt"><authid>${a}</authid></spatialrefsys>`;
    const [x1, y1] = merc(extensao[0], extensao[1]), [x2, y2] = merc(extensao[2], extensao[3]);
    const pad = Math.max(x2 - x1, y2 - y1, 200) * 0.15;
    return `<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis projectname="${xe(nome)}" version="3.34.0-Prizren">
  <homePath path=""/>
  <title>${xe(nome)}</title>
  <projectCrs>${crs('EPSG:3857')}</projectCrs>
  <layer-tree-group>
    <customproperties/>
${todas.map(l => `    <layer-tree-layer id="${l.id}" name="${xe(l.nome)}" source="${l.tipo === 'raster' && l.provider === 'wms' ? l.fonte : xe(l.fonte)}" providerKey="${l.provider}" checked="Qt::Checked" expanded="0"><customproperties/></layer-tree-layer>`).join('\n')}
  </layer-tree-group>
  <mapcanvas name="theMapCanvas" annotationsVisible="1">
    <units>meters</units>
    <extent><xmin>${x1 - pad}</xmin><ymin>${y1 - pad}</ymin><xmax>${x2 + pad}</xmax><ymax>${y2 + pad}</ymax></extent>
    <rotation>0</rotation>
    <destinationsrs>${crs('EPSG:3857')}</destinationsrs>
  </mapcanvas>
  <projectlayers>
${todas.map(l => `    <maplayer type="${l.tipo}"${l.geom ? ` geometry="${l.geom}"` : ''}>
      <id>${l.id}</id>
      <datasource>${l.tipo === 'raster' && l.provider === 'wms' ? l.fonte : xe(l.fonte)}</datasource>
      <layername>${xe(l.nome)}</layername>
${l.srs === null ? '' : `      <srs>${crs(l.srs || 'EPSG:4326')}</srs>
`}      <provider encoding="UTF-8">${l.provider}</provider>
    </maplayer>`).join('\n')}
  </projectlayers>
  <layerorder>
${todas.map(l => `    <layer id="${l.id}"/>`).join('\n')}
  </layerorder>
  <properties>
    <Paths><Absolute type="bool">false</Absolute></Paths>
  </properties>
</qgis>`;
  }

  /** Monta o ZIP do projeto completo para abrir no QGIS */
  async function exportarProjeto({ projeto, feicoes, fotos, caderneta, arquivos, obterBlob, progresso = () => {} }) {
    await Mapa.carregarScript('lib/jszip.min.js');
    const zip = new JSZip();
    const nb = nomeSeguro(projeto.nome);
    const extras = [...new Set(feicoes.flatMap(f => (f.atributos || []).map(a => colSegura(a.k))))]
      .filter(k => !['codigo', 'categoria', 'titulo', 'descricao', 'tags', 'autor', 'data', 'fid', 'geom'].includes(k));
    const props = f => {
      const m = Geo.medidas(f.geometria);
      const p = { codigo: f.codigo, categoria: f.categoria, titulo: f.titulo, descricao: f.descricao, tags: f.tags, autor: f.autorNome || f.autor, data: f.criadoEm,
        precisao_m: f.precisao ?? '', comprimento_m: m.comprimento ? m.comprimento.toFixed(2) : '', area_m2: m.area ? m.area.toFixed(2) : '',
        fotos: fotos.filter(x => x.refId === f.id).map(x => 'fotos/' + x.nome).join('; ') };
      extras.forEach(k => p[k] = '');
      (f.atributos || []).forEach(a => { if (a.k) p[colSegura(a.k)] = a.v; });
      return p;
    };
    const grupo = (tipo, tabela, nome) => ({ tabela, nome, tipoGeom: tipo, features: feicoes.filter(f => f.geometria && f.geometria.type === tipo).map(f => ({ type: 'Feature', properties: props(f), geometry: f.geometria })) });
    const camadasGpkg = [grupo('Point', 'pontos', 'Pontos'), grupo('LineString', 'linhas', 'Linhas'), grupo('Polygon', 'poligonos', 'Polígonos')];
    // fotos
    progresso('Reunindo fotos…');
    const fotosGeo = [];
    for (const ft of fotos) {
      try {
        const b = await obterBlob(ft);
        if (b) zip.file('fotos/' + ft.nome, b);
        if (ft.lat != null) {
          const ref = feicoes.find(f => f.id === ft.refId) || caderneta.find(c => c.id === ft.refId);
          fotosGeo.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [ft.lon, ft.lat] }, properties: { arquivo: 'fotos/' + ft.nome, data: ft.dataHora, legenda: ft.legenda || '', registro: ref ? (ref.codigo || ref.titulo || ref.atividade) : '', autor: ft.autorNome || ft.autor } });
        }
      } catch (e) {}
    }
    camadasGpkg.push({ tabela: 'fotos', nome: 'Fotos de campo', tipoGeom: 'Point', features: fotosGeo });
    const usadas = camadasGpkg.filter(c => c.features.length);
    progresso('Gerando GeoPackage…');
    if (usadas.length) zip.file(nb + '.gpkg', await criarGpkg(usadas));
    // importados
    const camadasQgs = usadas.map(c => ({ nome: c.nome, tipo: 'vector', provider: 'ogr', geom: c.tipoGeom === 'Point' ? 'Point' : c.tipoGeom === 'LineString' ? 'Line' : 'Polygon', fonte: `./${nb}.gpkg|layername=${c.tabela}` }));
    for (const a of arquivos) {
      try {
        const b = await obterBlob(a); if (!b) continue;
        const caminho = 'importados/' + a.nome;
        zip.file(caminho, b);
        const e = ext(a.nome);
        if (RAS.includes(e)) camadasQgs.push({ nome: base(a.nome), tipo: 'raster', provider: 'gdal', fonte: './' + caminho, srs: null });
        else if (e === 'zip') camadasQgs.push({ nome: base(a.nome), tipo: 'vector', provider: 'ogr', fonte: '/vsizip/./' + caminho, srs: null });
        else if (VET.includes(e) && e !== 'csv') camadasQgs.push({ nome: base(a.nome), tipo: 'vector', provider: 'ogr', fonte: './' + caminho });
      } catch (e) {}
    }
    // caderneta
    const cab = ['data', 'inicio', 'fim', 'atividade', 'titulo', 'equipe', 'clima', 'descricao', 'autor'];
    const lin = [...caderneta].sort((a, b) => (a.data + a.horaInicio).localeCompare(b.data + b.horaInicio))
      .map(c => [c.data, c.horaInicio, c.horaFim, c.atividade, c.titulo, c.equipe, c.clima, c.descricao, c.autorNome || c.autor]);
    zip.file('caderneta.csv', '﻿' + [cab, ...lin].map(l => l.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(';')).join('\r\n'));
    // extensão
    let bb = [Infinity, Infinity, -Infinity, -Infinity];
    usadas.forEach(c => c.features.forEach(f => { const rec = cs => typeof cs[0] === 'number' ? (bb = [Math.min(bb[0], cs[0]), Math.min(bb[1], cs[1]), Math.max(bb[2], cs[0]), Math.max(bb[3], cs[1])]) : cs.forEach(rec); rec(f.geometry.coordinates); }));
    if (!isFinite(bb[0])) bb = [-60.1, -3.2, -59.9, -3.0];
    zip.file(nb + '.qgs', projetoQgs(projeto.nome, camadasQgs, bb));
    zip.file('LEIA-ME.txt', `Projeto: ${projeto.nome}\r\nExportado do GeoCampo em ${new Date().toLocaleString('pt-BR')}\r\n\r\n` +
      `1. Descompacte esta pasta.\r\n2. Abra o arquivo ${nb}.qgs no QGIS (Google Satélite já configurado).\r\n\r\n` +
      `${nb}.gpkg  -> camadas pontos, linhas, poligonos e fotos (WGS 84 / EPSG:4326)\r\nfotos/      -> fotos de campo (o campo "arquivo" da camada fotos aponta para elas)\r\nimportados/ -> arquivos importados no projeto\r\ncaderneta.csv -> anotações de campo\r\n`);
    progresso('Compactando…');
    return { nome: nb + '_QGIS.zip', blob: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }) };
  }

  return { analisarZip, importarPacote, lerProjetoQgs, gpkgParaCamadas, lerGpkg, criarGpkg, exportarProjeto, nomeSeguro };
})();
