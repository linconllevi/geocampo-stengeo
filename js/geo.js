/* Utilidades geográficas: UTM SIRGAS 2000, distâncias, áreas, formatos */
const Geo = (() => {
  const R = 6378137;
  const rad = d => d * Math.PI / 180;

  function zonaUTM(lon) { return Math.floor((lon + 180) / 6) + 1; }

  function paraUTM(lat, lon) {
    const z = zonaUTM(lon), sul = lat < 0;
    const def = `+proj=utm +zone=${z} ${sul ? '+south ' : ''}+ellps=GRS80 +towgs84=0,0,0 +units=m +no_defs`;
    const [e, n] = proj4('EPSG:4326', def, [lon, lat]);
    const epsg = sul ? 31960 + z : 31954 + z; // SIRGAS 2000 / UTM (ex.: 20S = 31980, 21S = 31981)
    return { e, n, zona: z + (sul ? 'S' : 'N'), epsg };
  }

  function dist(a, b) { // [lon,lat]
    const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function comprimento(coords) { let s = 0; for (let i = 1; i < coords.length; i++) s += dist(coords[i - 1], coords[i]); return s; }

  function areaAnel(c) {
    let a = 0;
    for (let i = 0; i < c.length - 1; i++) {
      const p1 = c[i], p2 = c[i + 1];
      a += rad(p2[0] - p1[0]) * (2 + Math.sin(rad(p1[1])) + Math.sin(rad(p2[1])));
    }
    return Math.abs(a * R * R / 2);
  }

  function medidas(geom) {
    if (!geom) return {};
    if (geom.type === 'Point') return { centro: geom.coordinates };
    if (geom.type === 'LineString') return { comprimento: comprimento(geom.coordinates), centro: geom.coordinates[Math.floor(geom.coordinates.length / 2)] };
    if (geom.type === 'Polygon') {
      const anel = geom.coordinates[0];
      let area = areaAnel(anel);
      for (let i = 1; i < geom.coordinates.length; i++) area -= areaAnel(geom.coordinates[i]);
      const cx = anel.reduce((s, p) => s + p[0], 0) / anel.length, cy = anel.reduce((s, p) => s + p[1], 0) / anel.length;
      return { area, perimetro: comprimento(anel), centro: [cx, cy] };
    }
    return {};
  }

  const n = (v, d = 2) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  function fmtDist(m) { return m >= 1000 ? n(m / 1000, 3) + ' km' : n(m, 1) + ' m'; }
  function fmtArea(m2) { return m2 >= 10000 ? n(m2 / 10000, 4) + ' ha (' + n(m2, 0) + ' m²)' : n(m2, 1) + ' m²'; }
  function fmtCoord(lat, lon) {
    const u = paraUTM(lat, lon);
    return `Lat ${lat.toFixed(6)}  Lon ${lon.toFixed(6)}<br>UTM ${u.zona} (SIRGAS 2000)  E ${n(u.e, 2)}  N ${n(u.n, 2)}`;
  }
  function fmtCoordTxt(lat, lon) {
    const u = paraUTM(lat, lon);
    return `${lat.toFixed(6)}, ${lon.toFixed(6)} | UTM ${u.zona} E ${u.e.toFixed(1)} N ${u.n.toFixed(1)}`;
  }

  return { paraUTM, medidas, fmtDist, fmtArea, fmtCoord, fmtCoordTxt, dist, n };
})();
