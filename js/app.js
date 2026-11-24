/* GeoCampo StenGEO — aplicação principal */
const App = (() => {
  const C = window.GEOCAMPO_CONFIG;
  let usuario = JSON.parse(localStorage.getItem('gc_usuario') || 'null');
  let projeto = null;            // projeto aberto
  let vista = 'projetos';
  let cache = { feicoes: [], caderneta: [], arquivos: [], fotos: [] };
  let form = null;               // registro em edição no modal
  let refFotos = null;           // { tipo, id, galeria } para onde vão as próximas fotos
  let filtroFeicoes = { tipo: '', cat: '', q: '' };
  let pastaArq = 'Todos';
  let promptInstalar = null;

  const PALETA = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe', '#008080', '#9a6324', '#800000', '#000075'];
  const ROTULO_TIPO = { Point: 'Ponto', LineString: 'Linha', Polygon: 'Polígono' };
  const PREFIXO = { Point: 'P', LineString: 'L', Polygon: 'A' };
  const PASTAS = [
    { id: 'Vetores', ic: '⬠', desc: 'SHP, KML, GeoJSON, GPX, CSV' },
    { id: 'Imagens e Raster', ic: '🛰', desc: 'GeoTIFF, ortofotos, imagens' },
    { id: 'Documentos', ic: '📄', desc: 'PDF, planilhas, textos' },
    { id: 'Fotos de campo', ic: '📷', desc: 'Fotos dos registros' },
    { id: 'Outros', ic: '📦', desc: 'Demais arquivos' }
  ];

  /* ======================= UTILIDADES ======================= */
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = p => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const hoje = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const agoraHora = () => new Date().toTimeString().slice(0, 5);
  const fmtData = iso => iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const fmtDia = d => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const fmtTam = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const urls = new Map();
  function urlBlob(id, blob) { if (urls.has(id)) return urls.get(id); const u = URL.createObjectURL(blob); urls.set(id, u); return u; }

  let tToast;
  function toast(msg, erro) {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (erro ? ' erro' : ''); t.hidden = false;
    clearTimeout(tToast); tToast = setTimeout(() => t.hidden = true, erro ? 5000 : 2600);
  }
  function modal(html) { $('#modal-caixa').innerHTML = html; $('#modal').hidden = false; $('#modal-caixa').scrollTop = 0; }
  function fecharModal() {
    $('#modal').hidden = true; $('#modal-caixa').innerHTML = '';
    if (form && form.novo && !form.salvo) { /* desenho descartado */ }
    form = null;
  }
  function corDe(f) {
    const cats = (projeto && projeto.categorias) || C.CATEGORIAS_PADRAO;
    const i = cats.indexOf(f.categoria);
    return PALETA[(i < 0 ? cats.length : i) % PALETA.length];
  }
  const projetoAtual = () => projeto;

  /* ======================= LOGIN ======================= */
  function iniciarLogin() {
    const f = $('#form-login');
    let modo = 'entrar';
    document.querySelectorAll('.aba').forEach(b => b.onclick = () => {
      modo = b.dataset.aba;
      document.querySelectorAll('.aba').forEach(x => x.classList.toggle('ativa', x === b));
      f.classList.toggle('modo-cadastro', modo === 'cadastrar');
      $('#btn-login').textContent = modo === 'cadastrar' ? 'Criar conta' : 'Entrar';
      f.nome.required = modo === 'cadastrar';
    });
    $('#cfg-url').value = localStorage.getItem('gc_api_url') || (API.configurado() ? API.url() : '');
    $('#btn-salvar-url').onclick = () => { localStorage.setItem('gc_api_url', $('#cfg-url').value.trim()); msg('Servidor salvo.', true); };
    const msg = (t, ok) => { const m = $('#login-msg'); m.textContent = t; m.className = 'msg ' + (ok ? 'ok' : 'erro'); };
    f.onsubmit = async e => {
      e.preventDefault();
      const btn = $('#btn-login'); btn.disabled = true;
      try {
        if (modo === 'cadastrar') {
          const r = await API.chamar('cadastrar', { nome: f.nome.value, funcao: f.funcao.value, email: f.email.value, senha: f.senha.value });
          msg(r.mensagem, true);
          if (r.status !== 'aprovado') return;
        }
        const r = await API.chamar('login', { email: f.email.value, senha: f.senha.value });
        const anterior = await DB.kv('usuarioId');
        if (anterior && anterior !== r.usuario.id) await DB.limparTudo();
        await DB.kv('usuarioId', r.usuario.id);
        localStorage.setItem('gc_token', r.token);
        localStorage.setItem('gc_usuario', JSON.stringify(r.usuario));
        usuario = r.usuario;
        f.senha.value = '';
        entrarNoApp();
        sincronizarTudo(false);
      } catch (err) { msg(err.message); } finally { btn.disabled = false; }
    };
  }

  function sair() {
    if (!confirm('Sair da conta neste aparelho? Os dados ainda não sincronizados continuarão guardados aqui.')) return;
    localStorage.removeItem('gc_token'); localStorage.removeItem('gc_usuario');
    location.reload();
  }

  /* ======================= NAVEGAÇÃO ======================= */
  async function entrarNoApp() {
    $('#tela-login').hidden = true; $('#app').hidden = false;
    document.querySelectorAll('#nav button').forEach(b => b.onclick = () => ir(b.dataset.v));
    const pid = localStorage.getItem('gc_projeto');
    if (pid) { const p = await DB.get('projetos', pid); if (p && !p.excluido) await abrirProjeto(pid, true); }
    ir(projeto ? (localStorage.getItem('gc_vista') || 'mapa') : 'projetos');
    atualizarBadge();
  }

  function ir(v) {
    if (!projeto && ['mapa', 'caderneta', 'feicoes', 'arquivos'].includes(v)) v = 'projetos';
    vista = v; localStorage.setItem('gc_vista', v);
    document.querySelectorAll('.view').forEach(s => s.classList.toggle('ativa', s.id === 'v-' + v));
    document.querySelectorAll('#nav button').forEach(b => { b.classList.toggle('ativo', b.dataset.v === v); if (b.classList.contains('req-proj')) b.disabled = !projeto; });
    if (v === 'mapa') { Mapa.iniciar(); Mapa.ajustar(); redesenharMapa(); }
    render();
  }

  function render() {
    $('#topo-projeto').textContent = projeto ? projeto.nome : 'Projetos';
    $('#topo-sub').textContent = projeto ? [projeto.cliente, projeto.municipio].filter(Boolean).join(' · ') || 'GeoCampo StenGEO' : (usuario ? usuario.nome : '');
    if (vista === 'projetos') renderProjetos();
    if (vista === 'caderneta') renderCaderneta();
    if (vista === 'feicoes') renderFeicoes();
    if (vista === 'arquivos') renderArquivos();
    if (vista === 'config') renderConfig();
  }

  async function recarregarCache() {
    if (!projeto) { cache = { feicoes: [], caderneta: [], arquivos: [], fotos: [] }; return; }
    for (const col of DB.COM_PROJETO) cache[col] = (await DB.doProjeto(col, projeto.id)).filter(x => !x.excluido);
  }

  function redesenharMapa() { if (projeto) Mapa.desenharFeicoes(cache.feicoes); }

  /* ======================= PROJETOS ======================= */
  async function renderProjetos() {
    const lista = (await DB.todos('projetos')).filter(p => !p.excluido).sort((a, b) => (b.atualizadoEm || 0) - (a.atualizadoEm || 0));
    const q = ($('#busca-proj') && $('#busca-proj').value || '').toLowerCase();
    const contagem = {};
    for (const f of await DB.todos('feicoes')) if (!f.excluido) contagem[f.projetoId] = (contagem[f.projetoId] || 0) + 1;
    const filtrados = lista.filter(p => !q || [p.nome, p.cliente, p.municipio].join(' ').toLowerCase().includes(q));
    $('#v-projetos').innerHTML = `<div class="conteudo">
      <div class="cab"><h2>Projetos</h2>
        <input class="busca" id="busca-proj" placeholder="Buscar projeto…" value="${esc(q)}" oninput="App.renderProjetos()">
        <button class="btn primario" onclick="App.editarProjeto()">+ Novo projeto</button></div>
      ${filtrados.length ? `<div class="cards">${filtrados.map(p => `
        <div class="card projeto clicavel ${projeto && projeto.id === p.id ? 'atual' : ''}" onclick="App.abrirProjeto('${p.id}')">
          <h4>${esc(p.nome)}</h4>
          <div class="meta">${esc([p.cliente, p.municipio].filter(Boolean).join(' · ') || '—')}</div>
          <div class="meta" style="margin-top:8px">${contagem[p.id] || 0} feições · ${(p.membros || []).length + 1} pessoa(s)
            ${p._sujo ? '<span class="tag pend">pendente</span>' : ''}</div>
          <div class="linha-btns" style="margin-top:10px">
            <button class="btn peq primario" onclick="event.stopPropagation();App.abrirProjeto('${p.id}')">Abrir</button>
            <button class="btn peq" onclick="event.stopPropagation();App.editarProjeto('${p.id}')">Editar</button>
          </div>
        </div>`).join('')}</div>`
        : `<div class="vazio">${lista.length ? 'Nenhum projeto encontrado.' : 'Nenhum projeto ainda.<br>Crie o primeiro projeto para começar a caderneta de campo.'}</div>`}
    </div>`;
    const b = $('#busca-proj'); if (q && b) { b.focus(); b.setSelectionRange(q.length, q.length); }
  }

  async function abrirProjeto(id, silencioso) {
    projeto = await DB.get('projetos', id);
    if (!projeto) return;
    localStorage.setItem('gc_projeto', id);
    await recarregarCache();
    if (Mapa.limparCamadas) { try { Mapa.limparCamadas(); } catch (e) {} }
    if (!silencioso) ir('mapa');
    Mapa.iniciar(); redesenharMapa();
    Mapa.restaurarCamadas(cache.arquivos);
    if (!silencioso) setTimeout(() => Mapa.enquadrarProjeto(), 300);
    if (navigator.onLine) sincronizarTudo(false);
  }

  async function editarProjeto(id) {
    const p = id ? await DB.get('projetos', id) : { categorias: C.CATEGORIAS_PADRAO.slice(), membros: [] };
    modal(`
      <div class="modal-cab"><h2>${id ? 'Editar projeto' : 'Novo projeto'}</h2><button class="fechar" onclick="App.fecharModal()">✕</button></div>
      <label>Nome do projeto *<input id="p-nome" value="${esc(p.nome || '')}" placeholder="Ex.: Laudo de contaminação – Terreno X"></label>
      <div class="grade2">
        <label>Cliente<input id="p-cliente" value="${esc(p.cliente || '')}"></label>
        <label>Município / UF<input id="p-mun" value="${esc(p.municipio || '')}" placeholder="Manaus-AM"></label>
      </div>
      <div class="grade2">
        <label>Nº da proposta / contrato<input id="p-contrato" value="${esc(p.contrato || '')}"></label>
        <label>Responsável técnico<input id="p-rt" value="${esc(p.responsavel || (usuario && usuario.nome) || '')}"></label>
      </div>
      <label>Descrição / objetivo<textarea id="p-desc" style="min-height:70px">${esc(p.descricao || '')}</textarea></label>
      <label>Equipe (e-mails cadastrados, separados por vírgula)<input id="p-membros" value="${esc((p.membros || []).join(', '))}" placeholder="fulano@stengeo.com, ciclano@gmail.com"></label>
      <label>Categorias de feições (uma por linha)<textarea id="p-cats" style="min-height:120px">${esc((p.categorias || []).join('\n'))}</textarea></label>
      <div class="linha-btns">
        ${id ? `<button class="btn perigo" onclick="App.excluirProjeto('${id}')">Excluir</button>` : ''}
        <span class="esp"></span>
        <button class="btn" onclick="App.fecharModal()">Cancelar</button>
        <button class="btn primario" onclick="App.salvarProjeto('${id || ''}')">Salvar</button>
      </div>`);
  }

  async function salvarProjeto(id) {
    const nome = $('#p-nome').value.trim();
    if (!nome) return toast('Informe o nome do projeto.', true);
    const p = id ? await DB.get('projetos', id) : { id: uid('prj'), criadoEm: new Date().toISOString(), criadoPor: usuario.email };
    Object.assign(p, {
      nome, cliente: $('#p-cliente').value.trim(), municipio: $('#p-mun').value.trim(), contrato: $('#p-contrato').value.trim(),
      responsavel: $('#p-rt').value.trim(), descricao: $('#p-desc').value.trim(),
      membros: $('#p-membros').value.split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(s => s.includes('@')),
      categorias: $('#p-cats').value.split('\n').map(s => s.trim()).filter(Boolean),
      atualizadoEm: Date.now(), _sujo: 1
    });
    await DB.put('projetos', p);
    fecharModal(); toast('Projeto salvo.');
    if (projeto && projeto.id === p.id) projeto = p;
    if (!id) await abrirProjeto(p.id); else render();
    agendarSync();
  }

  async function excluirProjeto(id) {
    if (!confirm('Excluir este projeto? Ele deixará de aparecer para toda a equipe.')) return;
    const p = await DB.get('projetos', id);
    p.excluido = true; p.atualizadoEm = Date.now(); p._sujo = 1;
    await DB.put('projetos', p);
    if (projeto && projeto.id === id) { projeto = null; localStorage.removeItem('gc_projeto'); }
    fecharModal(); ir('projetos'); agendarSync();
  }

  /* ======================= FEIÇÕES ======================= */
  function proximoCodigo(tipo) {
    const pre = PREFIXO[tipo] || 'F';
    const nums = cache.feicoes.filter(f => (f.codigo || '').startsWith(pre + '-')).map(f => parseInt(f.codigo.split('-')[1], 10) || 0);
    return pre + '-' + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0');
  }

  function novaFeicao(geom, extra) {
    if (!projeto) return;
    const f = Object.assign({
      id: uid('f'), projetoId: projeto.id, tipo: geom.type, geometria: geom, codigo: proximoCodigo(geom.type),
      categoria: '', titulo: '', descricao: '', tags: '', atributos: [], autor: usuario.email, autorNome: usuario.nome,
      criadoEm: new Date().toISOString(), atualizadoEm: Date.now()
    }, extra);
    abrirFeicao(null, f);
  }

  async function abrirFeicao(id, novo) {
    const f = novo || await DB.get('feicoes', id);
    if (!f) return;
    form = { tipo: 'feicao', rec: JSON.parse(JSON.stringify(f)), novo: !!novo, salvo: !novo };
    const m = Geo.medidas(f.geometria);
    const c = m.centro;
    const cats = projeto.categorias && projeto.categorias.length ? projeto.categorias : C.CATEGORIAS_PADRAO;
    modal(`
      <div class="modal-cab">
        <span class="simb" style="width:34px;height:34px;border-radius:9px;display:grid;place-items:center;color:#fff;font-weight:700;background:${corDe(f)}">${PREFIXO[f.tipo]}</span>
        <h2>${novo ? 'Nova feição' : esc(f.codigo)} <small class="mudo">· ${ROTULO_TIPO[f.tipo]}</small></h2>
        <button class="fechar" onclick="App.fecharModal()">✕</button></div>
      <div class="caixa-info">
        ${c ? Geo.fmtCoord(c[1], c[0]) : ''}
        ${f.precisao ? `<br>Precisão GPS: ±${f.precisao} m${f.altitude != null ? ' · Altitude: ' + Math.round(f.altitude) + ' m' : ''}` : ''}
        ${m.comprimento ? '<br>Comprimento: ' + Geo.fmtDist(m.comprimento) : ''}
        ${m.area ? '<br>Área: ' + Geo.fmtArea(m.area) + ' · Perímetro: ' + Geo.fmtDist(m.perimetro) : ''}
        ${f.origem ? '<br>Origem: ' + esc(f.origem) : ''}
        ${!novo ? `<br><small>Registrado por ${esc(f.autorNome || f.autor)} em ${fmtData(f.criadoEm)}</small>` : ''}
      </div>
      <div class="grade2">
        <label>Código<input id="f-codigo" value="${esc(f.codigo)}"></label>
        <label>Categoria<select id="f-categoria"><option value="">— selecione —</option>
          ${cats.map(k => `<option ${k === f.categoria ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></label>
      </div>
      <label>Título / identificação<input id="f-titulo" value="${esc(f.titulo)}" placeholder="Ex.: Afloramento de arenito na margem do igarapé"></label>
      <label>Descrição de campo<textarea id="f-desc" placeholder="Descreva o que foi observado…">${esc(f.descricao)}</textarea></label>
      ${painelIA('f-desc')}
      <h3>Atributos <small class="mudo">(organize as informações em campos)</small></h3>
      <div id="f-attrs">${(f.atributos || []).map(a => linhaAttr(a.k, a.v)).join('')}</div>
      <div class="linha-btns"><button class="btn peq" onclick="App.addAttr()">+ Atributo</button>
        ${sugestoesAttr(f).map(s => `<button class="btn peq" onclick="App.addAttr('${s}')">${s}</button>`).join('')}</div>
      <label style="margin-top:12px">Tags (separadas por vírgula)<input id="f-tags" value="${esc(f.tags || '')}" placeholder="ex.: amostra, prioridade"></label>
      <h3>Fotos</h3>
      <div class="galeria" id="galeria-form"></div>
      <div class="linha-btns secao" style="padding-top:12px">
        ${!novo ? `<button class="btn perigo" onclick="App.excluirFeicao('${f.id}')">Excluir</button>
          <button class="btn" onclick="App.editarGeom('${f.id}')">Editar geometria</button>
          <button class="btn" onclick="App.verNoMapa('${f.id}')">Ver no mapa</button>` : ''}
        <span class="esp"></span>
        <button class="btn" onclick="App.fecharModal()">Cancelar</button>
        <button class="btn primario" onclick="App.salvarFeicao()">Salvar</button>
      </div>`);
    renderGaleria('feicao', f.id, '#galeria-form');
  }

  function sugestoesAttr(f) {
    const cat = (f.categoria || '').toLowerCase();
    if (cat.includes('aflor')) return ['Litologia', 'Atitude', 'Estrutura', 'Alteração'];
    if (cat.includes('amostr')) return ['Nº amostra', 'Matriz', 'Profundidade (m)', 'Parâmetros'];
    if (cat.includes('sondag') || cat.includes('poço') || cat.includes('furo')) return ['Profundidade (m)', 'NA (m)', 'Diâmetro', 'Método'];
    if (cat.includes('erosão')) return ['Dimensões', 'Causa provável', 'Risco'];
    if (cat.includes('patolog')) return ['Elemento', 'Tipo de dano', 'Abertura (mm)', 'Gravidade'];
    return ['Profundidade (m)', 'Medida', 'Responsável'];
  }
  const linhaAttr = (k = '', v = '') => `<div class="attr"><input placeholder="Campo" value="${esc(k)}"><input placeholder="Valor" value="${esc(v)}"><button onclick="this.parentNode.remove()">✕</button></div>`;
  function addAttr(k) { $('#f-attrs').insertAdjacentHTML('beforeend', linhaAttr(k || '', '')); const ins = $('#f-attrs').lastElementChild.querySelectorAll('input'); (k ? ins[1] : ins[0]).focus(); }

  function lerFormFeicao() {
    const f = form.rec;
    f.codigo = $('#f-codigo').value.trim() || f.codigo;
    f.categoria = $('#f-categoria').value;
    f.titulo = $('#f-titulo').value.trim();
    f.descricao = $('#f-desc').value.trim();
    f.tags = $('#f-tags').value.trim();
    f.atributos = [...document.querySelectorAll('#f-attrs .attr')].map(d => { const i = d.querySelectorAll('input'); return { k: i[0].value.trim(), v: i[1].value.trim() }; }).filter(a => a.k || a.v);
    return f;
  }

  async function gravarFeicao(fechar) {
    const f = lerFormFeicao();
    f.atualizadoEm = Date.now(); f._sujo = 1;
    await DB.put('feicoes', f);
    form.salvo = true; form.novo = false;
    await recarregarCache(); redesenharMapa();
    if (fechar) { fecharModal(); toast(f.codigo + ' salvo.'); render(); }
    agendarSync();
    return f;
  }
  const salvarFeicao = () => gravarFeicao(true);

  async function excluirFeicao(id) {
    if (!confirm('Excluir esta feição e suas fotos?')) return;
    const f = await DB.get('feicoes', id);
    f.excluido = true; f.atualizadoEm = Date.now(); f._sujo = 1;
    await DB.put('feicoes', f);
    for (const ft of cache.fotos.filter(x => x.refId === id)) { ft.excluido = true; ft.atualizadoEm = Date.now(); ft._sujo = 1; await DB.put('fotos', ft); }
    fecharModal(); await recarregarCache(); redesenharMapa(); render(); agendarSync();
  }

  async function editarGeom(id) {
    const f = await DB.get('feicoes', id);
    fecharModal(); ir('mapa');
    setTimeout(async () => {
      const g = await Mapa.editarGeometria(f);
      if (g) { f.geometria = g; f.atualizadoEm = Date.now(); f._sujo = 1; await DB.put('feicoes', f); toast('Geometria atualizada.'); agendarSync(); }
      await recarregarCache(); redesenharMapa();
    }, 250);
  }

  async function verNoMapa(id) {
    const f = await DB.get('feicoes', id);
    fecharModal(); ir('mapa'); setTimeout(() => Mapa.focar(f), 200);
  }

  function renderFeicoes() {
    const cats = [...new Set(cache.feicoes.map(f => f.categoria).filter(Boolean))].sort();
    const q = filtroFeicoes.q.toLowerCase();
    const lista = cache.feicoes
      .filter(f => (!filtroFeicoes.tipo || f.tipo === filtroFeicoes.tipo) && (!filtroFeicoes.cat || f.categoria === filtroFeicoes.cat))
      .filter(f => !q || [f.codigo, f.titulo, f.descricao, f.categoria, f.tags, (f.atributos || []).map(a => a.k + ' ' + a.v).join(' ')].join(' ').toLowerCase().includes(q))
      .sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), 'pt', { numeric: true }));
    const nFotos = id => cache.fotos.filter(x => x.refId === id).length;
    $('#v-feicoes').innerHTML = `<div class="conteudo">
      <div class="cab"><h2>Feições (${lista.length})</h2>
        <input class="busca" placeholder="Buscar…" value="${esc(filtroFeicoes.q)}" oninput="App.filtrar('q',this.value)" id="busca-f">
        <button class="btn" onclick="App.exportar()">Exportar</button></div>
      <div class="chips">
        ${[['', 'Todas'], ['Point', 'Pontos'], ['LineString', 'Linhas'], ['Polygon', 'Polígonos']].map(([v, t]) => `<button class="chip ${filtroFeicoes.tipo === v ? 'ativo' : ''}" onclick="App.filtrar('tipo','${v}')">${t}</button>`).join('')}
        ${cats.length ? `<select style="width:auto;margin:0;padding:5px 10px;border-radius:20px" onchange="App.filtrar('cat',this.value)"><option value="">Todas as categorias</option>${cats.map(c => `<option ${c === filtroFeicoes.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>` : ''}
      </div>
      ${lista.length ? lista.map(f => `
        <div class="item" onclick="App.abrirFeicao('${f.id}')">
          <div class="simb" style="background:${corDe(f)}">${PREFIXO[f.tipo]}</div>
          <div class="corpo"><b>${esc(f.codigo)}</b> ${esc(f.titulo || '')} ${f._sujo ? '<span class="tag pend">pendente</span>' : ''}
            <div class="meta mudo" style="font-size:.78rem">${esc(f.categoria || 'Sem categoria')} · ${fmtData(f.criadoEm)} · ${nFotos(f.id)} foto(s) ${medidaCurta(f)}</div>
            ${f.descricao ? `<div class="resumo">${esc(f.descricao)}</div>` : ''}</div>
          <button class="btn peq" onclick="event.stopPropagation();App.verNoMapa('${f.id}')">⌖</button>
        </div>`).join('') : '<div class="vazio">Nenhuma feição. Use o mapa para inserir pontos, linhas e polígonos.</div>'}
    </div>`;
    if (filtroFeicoes.q) { const b = $('#busca-f'); b.focus(); b.setSelectionRange(b.value.length, b.value.length); }
  }
  function medidaCurta(f) { const m = Geo.medidas(f.geometria); return m.area ? '· ' + Geo.fmtArea(m.area) : m.comprimento ? '· ' + Geo.fmtDist(m.comprimento) : ''; }
  function filtrar(k, v) { filtroFeicoes[k] = v; renderFeicoes(); }

  /* ---------- exportação ---------- */
  function exportar() {
    modal(`<div class="modal-cab"><h2>Exportar feições</h2><button class="fechar" onclick="App.fecharModal()">✕</button></div>
      <p class="mudo">Arquivos para abrir no QGIS, Google Earth ou Excel.</p>
      <div class="linha-btns">
        <button class="btn primario" onclick="App.baixarExport('geojson')">GeoJSON (QGIS)</button>
        <button class="btn primario" onclick="App.baixarExport('kml')">KML (Google Earth)</button>
        <button class="btn primario" onclick="App.baixarExport('csv')">CSV (planilha)</button>
      </div>`);
  }
  function featureCollection() {
    return {
      type: 'FeatureCollection', features: cache.feicoes.map(f => {
        const m = Geo.medidas(f.geometria);
        const props = { codigo: f.codigo, categoria: f.categoria, titulo: f.titulo, descricao: f.descricao, tags: f.tags, autor: f.autorNome || f.autor, data: f.criadoEm, precisao_m: f.precisao || '', comprimento_m: m.comprimento ? +m.comprimento.toFixed(2) : '', area_m2: m.area ? +m.area.toFixed(2) : '' };
        (f.atributos || []).forEach(a => { if (a.k) props[a.k] = a.v; });
        return { type: 'Feature', properties: props, geometry: f.geometria };
      })
    };
  }
  function baixar(nome, conteudo, mime) {
    const b = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: mime });
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = nome; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function baixarExport(fmt) {
    const base = (projeto.nome || 'projeto').normalize('NFD').replace(/[^\w]+/g, '_');
    const fc = featureCollection();
    if (fmt === 'geojson') baixar(base + '_feicoes.geojson', JSON.stringify(fc, null, 1), 'application/geo+json');
    if (fmt === 'csv') {
      const cols = [...new Set(fc.features.flatMap(f => Object.keys(f.properties)))];
      const linhas = fc.features.map((f, i) => {
        const c = Geo.medidas(cache.feicoes[i].geometria).centro || [];
        const u = c.length ? Geo.paraUTM(c[1], c[0]) : {};
        return [...cols.map(k => f.properties[k] ?? ''), cache.feicoes[i].tipo, c[1] ?? '', c[0] ?? '', u.zona || '', u.e ? u.e.toFixed(2) : '', u.n ? u.n.toFixed(2) : ''];
      });
      const csv = [[...cols, 'geometria', 'lat', 'lon', 'utm_zona', 'utm_e', 'utm_n'], ...linhas].map(l => l.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';')).join('\r\n');
      baixar(base + '_feicoes.csv', '﻿' + csv, 'text/csv');
    }
    if (fmt === 'kml') {
      const xe = s => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
      const crd = cs => cs.map(p => p[0] + ',' + p[1]).join(' ');
      const geomKml = g => g.type === 'Point' ? `<Point><coordinates>${crd([g.coordinates])}</coordinates></Point>`
        : g.type === 'LineString' ? `<LineString><coordinates>${crd(g.coordinates)}</coordinates></LineString>`
        : `<Polygon>${g.coordinates.map((r, i) => `<${i ? 'innerBoundaryIs' : 'outerBoundaryIs'}><LinearRing><coordinates>${crd(r)}</coordinates></LinearRing></${i ? 'innerBoundaryIs' : 'outerBoundaryIs'}>`).join('')}</Polygon>`;
      const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xe(projeto.nome)}</name>
${fc.features.map(f => `<Placemark><name>${xe(f.properties.codigo)}</name><description>${xe([f.properties.categoria, f.properties.titulo, f.properties.descricao].filter(Boolean).join(' — '))}</description>
<ExtendedData>${Object.entries(f.properties).map(([k, v]) => `<Data name="${xe(k)}"><value>${xe(v)}</value></Data>`).join('')}</ExtendedData>${geomKml(f.geometry)}</Placemark>`).join('\n')}
</Document></kml>`;
      baixar(base + '_feicoes.kml', kml, 'application/vnd.google-earth.kml+xml');
    }
  }

  /* ======================= FOTOS ======================= */
  function adicionarFotos(tipo, origem) {
    if (!form) return;
    refFotos = { tipo, galeria: '#galeria-form' };
    $(origem === 'camera' ? '#in-foto-camera' : '#in-foto-galeria').click();
  }

  async function processarFotos(files) {
    if (!files.length || !form) return;
    // garante que o registro existe antes de vincular fotos
    if (!form.salvo) { if (form.tipo === 'feicao') await gravarFeicao(false); else await gravarCaderneta(false); }
    const rec = form.rec;
    let pos = Mapa.posicaoAtual();
    if (!pos || Date.now() - pos.t > 60000) { try { pos = await Mapa.obterPosicao(); } catch (e) { pos = null; } }
    for (const file of files) {
      try {
        toast('Processando foto…');
        const blob = await comprimirFoto(file, rec, pos);
        const ft = {
          id: uid('ft'), projetoId: projeto.id, refTipo: form.tipo, refId: rec.id, nome: `${rec.codigo || 'caderneta'}_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.jpg`,
          legenda: '', lat: pos ? pos.lat : null, lon: pos ? pos.lon : null, precisao: pos ? Math.round(pos.precisao) : null,
          dataHora: new Date().toISOString(), autor: usuario.email, autorNome: usuario.nome, tamanho: blob.size,
          criadoEm: new Date().toISOString(), atualizadoEm: Date.now(), _sujo: 1
        };
        await DB.put('blobs', { id: ft.id, blob });
        await DB.put('fotos', ft);
      } catch (e) { toast('Erro na foto: ' + e.message, true); }
    }
    await recarregarCache();
    renderGaleria(form.tipo, rec.id, '#galeria-form');
    toast(files.length + ' foto(s) adicionada(s).');
    agendarSync();
  }

  function comprimirFoto(file, rec, pos) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const max = parseInt(localStorage.getItem('gc_foto_max') || '1920', 10);
        let w = img.naturalWidth, h = img.naturalHeight;
        const k = Math.min(1, max / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k);
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0, w, h);
        if (localStorage.getItem('gc_carimbo') !== '0') {
          const fs = Math.max(14, Math.round(w / 55));
          const linhas = [
            `${C.EMPRESA} · ${projeto.nome}${rec.codigo ? ' · ' + rec.codigo : ''}`,
            `${new Date().toLocaleString('pt-BR')}${pos ? ' · ' + Geo.fmtCoordTxt(pos.lat, pos.lon) + ' · ±' + Math.round(pos.precisao) + ' m' : ''}`
          ];
          const hBar = fs * 1.35 * linhas.length + fs * 0.8;
          cx.fillStyle = 'rgba(8,58,115,.78)'; cx.fillRect(0, h - hBar, w, hBar);
          cx.fillStyle = '#fff'; cx.font = `600 ${fs}px system-ui, sans-serif`; cx.textBaseline = 'top';
          linhas.forEach((l, i) => cx.fillText(l, fs * 0.6, h - hBar + fs * 0.4 + i * fs * 1.35, w - fs * 1.2));
        }
        URL.revokeObjectURL(img.src);
        cv.toBlob(b => b ? res(b) : rej(new Error('falha ao gerar JPEG')), 'image/jpeg', 0.82);
      };
      img.onerror = () => rej(new Error('imagem inválida'));
      img.src = URL.createObjectURL(file);
    });
  }

  async function renderGaleria(tipo, refId, sel) {
    const el = $(sel); if (!el) return;
    const fotos = cache.fotos.filter(f => f.refId === refId);
    el.innerHTML = fotos.map(f => `<div class="ft" data-id="${f.id}" onclick="App.verFoto('${f.id}')"><img alt=""><span>${esc(f.legenda || fmtData(f.dataHora))}</span>
      <button class="x" onclick="event.stopPropagation();App.excluirFoto('${f.id}')">✕</button></div>`).join('') +
      `<div class="ft add" onclick="App.adicionarFotos('${tipo}','camera')">📷<br>Câmera</div>
       <div class="ft add" onclick="App.adicionarFotos('${tipo}','galeria')">🖼<br>Galeria</div>`;
    for (const f of fotos) carregarMini(el.querySelector(`[data-id="${f.id}"] img`), f);
  }

  async function carregarMini(img, f) {
    try { const b = await API.obterBlob(f); if (b && img) img.src = urlBlob(f.id, b); } catch (e) { if (img) img.alt = 'offline'; }
  }

  async function verFoto(id) {
    const f = await DB.get('fotos', id);
    try { const b = await API.obterBlob(f); if (!b) throw new Error('indisponível offline'); $('#visor-img').src = urlBlob(id, b); $('#visor').hidden = false; }
    catch (e) { toast('Foto não disponível: ' + e.message, true); }
  }

  async function excluirFoto(id) {
    if (!confirm('Excluir esta foto?')) return;
    const f = await DB.get('fotos', id);
    f.excluido = true; f.atualizadoEm = Date.now(); f._sujo = 1;
    await DB.put('fotos', f);
    await recarregarCache();
    if (form) renderGaleria(form.tipo, form.rec.id, '#galeria-form');
    if (vista === 'arquivos') renderArquivos();
    agendarSync();
  }

  /* ======================= IA ======================= */
  function painelIA(campo) {
    return `<div class="linha-btns" style="margin:-4px 0 6px">
      <button class="btn peq ia" onclick="App.ia('${campo}','melhorar')">✨ Melhorar texto</button>
      <button class="btn peq" onclick="App.ia('${campo}','tecnico')">Linguagem técnica</button>
      <button class="btn peq" onclick="App.ia('${campo}','topicos')">Organizar em tópicos</button>
      <button class="btn peq" onclick="App.ia('${campo}','resumir')">Resumir</button></div>
      <div id="ia-${campo}"></div>`;
  }

  async function ia(campo, modo) {
    const ta = $('#' + campo); const alvo = $('#ia-' + campo);
    const texto = ta.value.trim();
    if (!texto) return toast('Escreva a descrição primeiro.', true);
    const r = form && form.rec;
    const ctx = r ? [projeto.nome, r.categoria, r.codigo, r.atividade, r.titulo].filter(Boolean).join(' | ') : projeto.nome;
    alvo.innerHTML = '<div class="caixa-info">✨ A IA está revisando o texto…</div>';
    try {
      const novo = await API.ia(texto, modo, ctx);
      alvo.innerHTML = `<div class="ia-comp"><div class="bloco novo" id="ia-res-${campo}" contenteditable="true">${esc(novo)}</div>
        <div class="linha-btns fim"><small class="mudo esp">Revise antes de aplicar — você pode editar a sugestão acima.</small>
        <button class="btn peq" onclick="this.closest('.ia-comp').remove()">Descartar</button>
        <button class="btn peq primario" onclick="App.aplicarIA('${campo}')">Usar sugestão</button></div></div>`;
    } catch (e) { alvo.innerHTML = `<div class="caixa-info" style="color:var(--vermelho)">${esc(e.message)}</div>`; }
  }
  function aplicarIA(campo) {
    const ta = $('#' + campo);
    if (form) form.rec.textoOriginal = form.rec.textoOriginal || ta.value;
    ta.value = $('#ia-res-' + campo).innerText.trim();
    $('#ia-' + campo).innerHTML = '';
    toast('Texto atualizado. Lembre-se de salvar.');
  }

  /* ======================= CADERNETA ======================= */
  function renderCaderneta() {
    const q = ($('#busca-cad') && $('#busca-cad').value || '').toLowerCase();
    const eventos = [];
    cache.caderneta.forEach(c => eventos.push({ dia: c.data, hora: c.horaInicio || '', tipo: 'cad', rec: c, txt: [c.atividade, c.titulo, c.descricao, c.equipe].join(' ') }));
    cache.feicoes.forEach(f => {
      const d = new Date(f.criadoEm); const dia = new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      eventos.push({ dia, hora: d.toTimeString().slice(0, 5), tipo: 'f', rec: f, txt: [f.codigo, f.titulo, f.descricao, f.categoria].join(' ') });
    });
    const filtrados = eventos.filter(e => !q || e.txt.toLowerCase().includes(q)).sort((a, b) => (b.dia + b.hora).localeCompare(a.dia + a.hora));
    const dias = {};
    filtrados.forEach(e => (dias[e.dia] = dias[e.dia] || []).push(e));
    const fotoMini = id => { const f = cache.fotos.find(x => x.refId === id); return f ? `<img class="mini" data-foto="${f.id}" alt="">` : ''; };
    $('#v-caderneta').innerHTML = `<div class="conteudo">
      <div class="cab"><h2>Caderneta de campo</h2>
        <input class="busca" id="busca-cad" placeholder="Buscar…" value="${esc(q)}" oninput="App.renderCaderneta()">
        <button class="btn" onclick="App.relatorio()">Relatório / PDF</button>
        <button class="btn primario" onclick="App.abrirCaderneta()">+ Nova anotação</button></div>
      ${Object.keys(dias).length ? Object.entries(dias).map(([dia, evs]) => `
        <div class="dia"><div class="dia-cab">${fmtDia(dia)}</div>
        ${evs.map(e => e.tipo === 'cad' ? `
          <div class="item reg" onclick="App.abrirCaderneta('${e.rec.id}')">
            <div class="corpo"><span class="hora">${esc(e.rec.horaInicio || '')}${e.rec.horaFim ? '–' + esc(e.rec.horaFim) : ''}</span>
              <span class="tag">${esc(e.rec.atividade || 'Anotação')}</span> ${e.rec._sujo ? '<span class="tag pend">pendente</span>' : ''}
              <div><b>${esc(e.rec.titulo || '')}</b></div>
              <div class="resumo">${esc(e.rec.descricao || '')}</div>
              ${e.rec.equipe ? `<small class="mudo">Equipe: ${esc(e.rec.equipe)}</small>` : ''}</div>${fotoMini(e.rec.id)}
          </div>` : `
          <div class="item reg auto" onclick="App.abrirFeicao('${e.rec.id}')">
            <div class="corpo"><span class="hora">${esc(e.hora)}</span> <span class="tag local">registro no mapa</span>
              <div><b>${esc(e.rec.codigo)}</b> ${esc(e.rec.titulo || e.rec.categoria || ROTULO_TIPO[e.rec.tipo])}</div>
              ${e.rec.descricao ? `<div class="resumo">${esc(e.rec.descricao)}</div>` : ''}</div>${fotoMini(e.rec.id)}
          </div>`).join('')}</div>`).join('')
        : '<div class="vazio">Nenhuma anotação ainda. Registre as atividades do dia em "+ Nova anotação".<br>As feições criadas no mapa também aparecem aqui automaticamente.</div>'}
    </div>`;
    document.querySelectorAll('#v-caderneta img[data-foto]').forEach(img => { const f = cache.fotos.find(x => x.id === img.dataset.foto); if (f) carregarMini(img, f); });
    const b = $('#busca-cad'); if (q) { b.focus(); b.setSelectionRange(q.length, q.length); }
  }

  async function abrirCaderneta(id) {
    const c = id ? await DB.get('caderneta', id) : {
      id: uid('cd'), projetoId: projeto.id, data: hoje(), horaInicio: agoraHora(), horaFim: '', atividade: C.TIPOS_ATIVIDADE[0],
      titulo: '', descricao: '', equipe: usuario.nome, clima: '', feicoes: [], autor: usuario.email, autorNome: usuario.nome, criadoEm: new Date().toISOString()
    };
    form = { tipo: 'caderneta', rec: JSON.parse(JSON.stringify(c)), novo: !id, salvo: !!id };
    modal(`
      <div class="modal-cab"><h2>${id ? 'Anotação de campo' : 'Nova anotação'}</h2><button class="fechar" onclick="App.fecharModal()">✕</button></div>
      <div class="grade3">
        <label>Data<input type="date" id="c-data" value="${esc(c.data)}"></label>
        <label>Início<input type="time" id="c-ini" value="${esc(c.horaInicio)}"></label>
        <label>Fim<input type="time" id="c-fim" value="${esc(c.horaFim)}"></label>
      </div>
      <div class="grade2">
        <label>Atividade<select id="c-ativ">${C.TIPOS_ATIVIDADE.map(t => `<option ${t === c.atividade ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <label>Clima / condições<input id="c-clima" value="${esc(c.clima)}" placeholder="Ensolarado, chuva fraca…"></label>
      </div>
      <label>Título<input id="c-titulo" value="${esc(c.titulo)}" placeholder="Ex.: Coleta de amostras de solo – setor norte"></label>
      <label>Equipe<input id="c-equipe" value="${esc(c.equipe)}"></label>
      <label>Descrição das atividades<textarea id="c-desc" style="min-height:150px" placeholder="O que foi feito, observações, pendências…">${esc(c.descricao)}</textarea></label>
      ${painelIA('c-desc')}
      ${cache.feicoes.length ? `<h3>Feições relacionadas</h3><div class="chips" id="c-feicoes">
        ${cache.feicoes.map(f => `<label class="chip" style="margin:0"><input type="checkbox" value="${f.id}" ${(c.feicoes || []).includes(f.id) ? 'checked' : ''}>${esc(f.codigo)}</label>`).join('')}</div>` : ''}
      <h3>Fotos</h3><div class="galeria" id="galeria-form"></div>
      <div class="linha-btns secao" style="padding-top:12px">
        ${id ? `<button class="btn perigo" onclick="App.excluirCaderneta('${id}')">Excluir</button>` : ''}
        <span class="esp"></span>
        <button class="btn" onclick="App.fecharModal()">Cancelar</button>
        <button class="btn primario" onclick="App.salvarCaderneta()">Salvar</button>
      </div>`);
    renderGaleria('caderneta', c.id, '#galeria-form');
  }

  async function gravarCaderneta(fechar) {
    const c = form.rec;
    Object.assign(c, {
      data: $('#c-data').value || hoje(), horaInicio: $('#c-ini').value, horaFim: $('#c-fim').value, atividade: $('#c-ativ').value,
      clima: $('#c-clima').value.trim(), titulo: $('#c-titulo').value.trim(), equipe: $('#c-equipe').value.trim(), descricao: $('#c-desc').value.trim(),
      feicoes: [...document.querySelectorAll('#c-feicoes input:checked')].map(i => i.value), atualizadoEm: Date.now(), _sujo: 1
    });
    await DB.put('caderneta', c);
    form.salvo = true; form.novo = false;
    await recarregarCache();
    if (fechar) { fecharModal(); toast('Anotação salva.'); render(); }
    agendarSync();
  }
  const salvarCaderneta = () => gravarCaderneta(true);

  async function excluirCaderneta(id) {
    if (!confirm('Excluir esta anotação?')) return;
    const c = await DB.get('caderneta', id);
    c.excluido = true; c.atualizadoEm = Date.now(); c._sujo = 1;
    await DB.put('caderneta', c);
    fecharModal(); await recarregarCache(); render(); agendarSync();
  }

  /* ---------- relatório (impressão / PDF) ---------- */
  async function relatorio() {
    const w = window.open('', '_blank');
    if (!w) return toast('Permita pop-ups para gerar o relatório.', true);
    w.document.write('<p style="font-family:sans-serif">Gerando relatório…</p>');
    const fotoHtml = async refId => {
      const fs = cache.fotos.filter(f => f.refId === refId);
      const partes = [];
      for (const f of fs) {
        try { const b = await API.obterBlob(f); if (b) partes.push(`<figure><img src="${urlBlob(f.id, b)}"><figcaption>${esc(f.legenda || fmtData(f.dataHora))}</figcaption></figure>`); } catch (e) {}
      }
      return partes.length ? `<div class="fotos">${partes.join('')}</div>` : '';
    };
    const cad = [...cache.caderneta].sort((a, b) => (a.data + a.horaInicio).localeCompare(b.data + b.horaInicio));
    const feic = [...cache.feicoes].sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), 'pt', { numeric: true }));
    let corpo = '';
    for (const c of cad) corpo += `<div class="bloco"><h3>${new Date(c.data + 'T12:00').toLocaleDateString('pt-BR')} · ${esc(c.horaInicio)}${c.horaFim ? '–' + esc(c.horaFim) : ''} · ${esc(c.atividade)}</h3>
      ${c.titulo ? `<p><b>${esc(c.titulo)}</b></p>` : ''}<p>${esc(c.descricao).replace(/\n/g, '<br>')}</p>
      <p class="meta">${c.equipe ? 'Equipe: ' + esc(c.equipe) : ''}${c.clima ? ' · Clima: ' + esc(c.clima) : ''}</p>${await fotoHtml(c.id)}</div>`;
    let tab = '';
    for (const f of feic) {
      const m = Geo.medidas(f.geometria); const ct = m.centro; const u = ct ? Geo.paraUTM(ct[1], ct[0]) : null;
      tab += `<div class="bloco"><h3>${esc(f.codigo)} · ${esc(f.categoria || ROTULO_TIPO[f.tipo])}${f.titulo ? ' · ' + esc(f.titulo) : ''}</h3>
        <p class="meta">${u ? `UTM ${u.zona} (SIRGAS 2000) E ${u.e.toFixed(2)} N ${u.n.toFixed(2)} · ${ct[1].toFixed(6)}, ${ct[0].toFixed(6)}` : ''}
        ${m.comprimento ? ' · Comprimento ' + Geo.fmtDist(m.comprimento) : ''}${m.area ? ' · Área ' + Geo.fmtArea(m.area) : ''}${f.precisao ? ' · ±' + f.precisao + ' m' : ''}</p>
        <p>${esc(f.descricao).replace(/\n/g, '<br>')}</p>
        ${(f.atributos || []).length ? `<table>${f.atributos.map(a => `<tr><th>${esc(a.k)}</th><td>${esc(a.v)}</td></tr>`).join('')}</table>` : ''}
        ${await fotoHtml(f.id)}</div>`;
    }
    w.document.open();
    w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Caderneta de campo - ${esc(projeto.nome)}</title><style>
      body{font-family:Arial,Helvetica,sans-serif;color:#1b2735;margin:0;font-size:11pt}
      header{background:#0b4f9c;color:#fff;padding:18px 28px;display:flex;align-items:center;gap:18px}
      header img{height:70px;background:#fff;border-radius:6px;padding:4px 8px} header h1{margin:0;font-size:18pt} header p{margin:2px 0 0;color:#d6e4f7}
      main{padding:10px 28px} h2{color:#0b4f9c;border-bottom:3px solid #0b4f9c;padding-bottom:4px;margin-top:24px;font-size:14pt}
      h3{color:#083a73;font-size:11.5pt;margin:0 0 6px} .bloco{border-left:4px solid #0b4f9c;padding:6px 12px;margin:12px 0;page-break-inside:avoid}
      .meta{color:#5b6b7f;font-size:9.5pt} table{border-collapse:collapse;margin:6px 0;font-size:10pt} th{background:#e8f0fb;color:#083a73;text-align:left}
      th,td{border:1px solid #c9d6e8;padding:4px 8px} .fotos{display:grid;grid-template-columns:1fr 1fr;gap:8px} figure{margin:0}
      figure img{width:100%;max-height:300px;object-fit:cover;border:1px solid #c9d6e8} figcaption{font-size:8.5pt;color:#5b6b7f}
      .ficha td{border:0;padding:2px 12px 2px 0} @media print{.nao{display:none}}</style></head><body>
      <header><img src="${new URL('img/logo.png', location.href)}"><div><h1>Caderneta de Campo</h1><p>${esc(projeto.nome)}</p></div></header>
      <main><button class="nao" onclick="print()" style="margin:12px 0;padding:8px 16px;background:#0b4f9c;color:#fff;border:0;border-radius:6px">Imprimir / salvar em PDF</button>
      <table class="ficha"><tr><td><b>Cliente:</b> ${esc(projeto.cliente || '—')}</td><td><b>Município:</b> ${esc(projeto.municipio || '—')}</td></tr>
      <tr><td><b>Responsável técnico:</b> ${esc(projeto.responsavel || '—')}</td><td><b>Contrato:</b> ${esc(projeto.contrato || '—')}</td></tr>
      <tr><td colspan="2"><b>Emitido em:</b> ${new Date().toLocaleString('pt-BR')} por ${esc(usuario.nome)}</td></tr></table>
      ${projeto.descricao ? `<p>${esc(projeto.descricao)}</p>` : ''}
      <h2>1. Registro de atividades</h2>${corpo || '<p class="meta">Sem anotações.</p>'}
      <h2>2. Pontos, linhas e polígonos levantados</h2>${tab || '<p class="meta">Sem feições.</p>'}
      </main></body></html>`);
    w.document.close();
  }

  /* ======================= ARQUIVOS ======================= */
  const pastaPorExt = nome => {
    const e = Mapa.extensao(nome);
    if (['geojson', 'json', 'kml', 'kmz', 'gpx', 'zip', 'csv', 'shp', 'dxf'].includes(e)) return 'Vetores';
    if (['tif', 'tiff', 'jpg', 'jpeg', 'png', 'ecw', 'jp2'].includes(e)) return 'Imagens e Raster';
    if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'odt', 'ods', 'ppt', 'pptx'].includes(e)) return 'Documentos';
    return 'Outros';
  };

  function renderArquivos() {
    const arqs = cache.arquivos;
    const cont = id => id === 'Fotos de campo' ? cache.fotos.length : arqs.filter(a => a.pasta === id).length;
    const compart = localStorage.getItem('gc_compartilhar') !== '0';
    let conteudo;
    if (pastaArq === 'Fotos de campo') {
      const ref = f => { const r = cache.feicoes.find(x => x.id === f.refId) || cache.caderneta.find(x => x.id === f.refId); return r ? (r.codigo || r.titulo || r.atividade) : ''; };
      conteudo = cache.fotos.length ? `<div class="galeria">${cache.fotos.map(f => `<div class="ft" data-id="${f.id}" onclick="App.verFoto('${f.id}')"><img alt=""><span>${esc(ref(f))} · ${fmtData(f.dataHora)}</span></div>`).join('')}</div>
        <div class="linha-btns" style="margin-top:12px"><button class="btn" onclick="App.baixarFotos()">Baixar todas as fotos</button></div>`
        : '<div class="vazio">As fotos tiradas nos registros aparecem aqui.</div>';
    } else {
      const lista = arqs.filter(a => pastaArq === 'Todos' || a.pasta === pastaArq).sort((a, b) => (b.atualizadoEm || 0) - (a.atualizadoEm || 0));
      conteudo = `
        <div class="soltar" id="zona-soltar" onclick="App.escolherArquivos('${pastaArq}')">
          <b>Arraste arquivos aqui</b> ou toque para selecionar<br><small>Shapefile (.zip), KML/KMZ, GeoJSON, GPX, CSV, GeoTIFF, PDF, planilhas…</small></div>
        <label class="chk" style="margin-top:-6px"><input type="checkbox" id="arq-compart" ${compart ? 'checked' : ''} onchange="localStorage.setItem('gc_compartilhar',this.checked?'1':'0')"> Enviar para o servidor e compartilhar com a equipe do projeto</label>
        ${lista.length ? `<div style="overflow-x:auto"><table class="tabela"><thead><tr><th>Arquivo</th><th>Pasta</th><th>Tamanho</th><th>Enviado</th><th></th></tr></thead><tbody>
          ${lista.map(a => `<tr><td><b>${esc(a.nome)}</b><br>${a.local ? '<span class="tag local">só neste aparelho</span>' : a.driveId ? '<span class="tag ok">no servidor</span>' : '<span class="tag pend">aguardando envio</span>'}</td>
            <td><select style="margin:0;padding:4px" onchange="App.moverArquivo('${a.id}',this.value)">${PASTAS.filter(p => p.id !== 'Fotos de campo').map(p => `<option ${p.id === a.pasta ? 'selected' : ''}>${p.id}</option>`).join('')}</select></td>
            <td>${a.tamanho ? fmtTam(a.tamanho) : ''}</td><td><small>${esc(a.autorNome || a.autor || '')}<br>${fmtData(a.criadoEm)}</small></td>
            <td><div class="linha-btns">${Mapa.ehCamada(a.nome) ? `<button class="btn peq primario" onclick="App.arquivoNoMapa('${a.id}')">Mapa</button>` : ''}
              <button class="btn peq" onclick="App.baixarArquivo('${a.id}')">Baixar</button>
              <button class="btn peq perigo" onclick="App.excluirArquivo('${a.id}')">✕</button></div></td></tr>`).join('')}
          </tbody></table></div>` : '<div class="vazio">Nenhum arquivo nesta pasta.</div>'}`;
    }
    $('#v-arquivos').innerHTML = `<div class="conteudo">
      <div class="cab"><h2>Arquivos do projeto</h2><button class="btn primario" onclick="App.escolherArquivos('${pastaArq}')">+ Enviar arquivos</button></div>
      <div class="pastas">
        <div class="pasta ${pastaArq === 'Todos' ? 'ativa' : ''}" onclick="App.pasta('Todos')"><span class="ic">🗂</span><b>Todos</b><small>${arqs.length} arquivo(s)</small></div>
        ${PASTAS.map(p => `<div class="pasta ${pastaArq === p.id ? 'ativa' : ''}" onclick="App.pasta('${p.id}')"><span class="ic">${p.ic}</span><b>${p.id}</b><small>${cont(p.id)} · ${p.desc}</small></div>`).join('')}
      </div>${conteudo}</div>`;
    document.querySelectorAll('#v-arquivos .ft[data-id]').forEach(d => { const f = cache.fotos.find(x => x.id === d.dataset.id); carregarMini(d.querySelector('img'), f); });
    const z = $('#zona-soltar');
    if (z) {
      z.ondragover = e => { e.preventDefault(); z.classList.add('sobre'); };
      z.ondragleave = () => z.classList.remove('sobre');
      z.ondrop = e => { e.preventDefault(); z.classList.remove('sobre'); receberArquivos([...e.dataTransfer.files], pastaArq, false); };
    }
  }
  function pasta(p) { pastaArq = p; renderArquivos(); }

  let destinoArq = null;
  function escolherArquivos(pastaDestino, paraMapa) {
    destinoArq = { pasta: pastaDestino, paraMapa };
    const inp = $('#in-arquivo');
    inp.accept = paraMapa ? '.zip,.kml,.kmz,.geojson,.json,.gpx,.csv,.tif,.tiff' : '';
    inp.click();
  }

  async function receberArquivos(files, pastaDestino, paraMapa) {
    if (!files.length || !projeto) return;
    const compart = localStorage.getItem('gc_compartilhar') !== '0';
    const shpSolto = files.some(f => /\.shp$/i.test(f.name));
    if (shpSolto) toast('Para shapefile, compacte .shp, .shx, .dbf e .prj em um único .zip.', true);
    for (const file of files.filter(f => !/\.(shp|shx|dbf|prj|cpg)$/i.test(f.name))) {
      const grande = file.size > 35 * 1048576;
      const a = {
        id: uid('arq'), projetoId: projeto.id, nome: file.name, mime: file.type, tamanho: file.size,
        pasta: (!pastaDestino || pastaDestino === 'Todos' || pastaDestino === 'Fotos de campo' || (paraMapa && pastaDestino === 'Vetores')) ? pastaPorExt(file.name) : pastaDestino,
        local: !compart || grande, autor: usuario.email, autorNome: usuario.nome, criadoEm: new Date().toISOString(), atualizadoEm: Date.now(), _sujo: 1
      };
      if (grande && compart) toast(`${file.name} tem mais de 35 MB: ficará só neste aparelho. Para compartilhar, reduza o arquivo (ex.: GeoTIFF com compressão JPEG).`, true);
      if (Mapa.ehCamada(file.name)) {
        try {
          if (!/\.tiff?$/i.test(file.name)) await Mapa.lerVetor(file, file.name); // valida antes de guardar
        } catch (e) { toast(`${file.name}: ${e.message}`, true); continue; }
        a.visivel = !!paraMapa;
      }
      await DB.put('blobs', { id: a.id, blob: file });
      await DB.put('arquivos', a);
      if (paraMapa && Mapa.ehCamada(file.name)) {
        try { await Mapa.mostrarCamada(a); Mapa.zoomCamada(a.id); } catch (e) { toast(e.message, true); }
      }
    }
    await recarregarCache();
    toast(files.length + ' arquivo(s) adicionado(s).');
    if (vista === 'arquivos') renderArquivos();
    if (paraMapa && !$('#modal').hidden) Mapa.painelCamadas();
    agendarSync();
  }

  async function baixarArquivo(id) {
    const a = await DB.get('arquivos', id);
    try { toast('Preparando download…'); const b = await API.obterBlob(a); if (!b) throw new Error('arquivo indisponível offline'); baixar(a.nome, b); }
    catch (e) { toast(e.message, true); }
  }

  async function baixarFotos() {
    if (typeof JSZip === 'undefined') await new Promise((r, j) => { const s = document.createElement('script'); s.src = 'lib/jszip.min.js'; s.onload = r; s.onerror = j; document.head.appendChild(s); });
    const zip = new JSZip(); let n = 0;
    toast('Compactando fotos…');
    for (const f of cache.fotos) { try { const b = await API.obterBlob(f); if (b) { zip.file(f.nome || f.id + '.jpg', b); n++; } } catch (e) {} }
    baixar((projeto.nome || 'fotos').replace(/[^\w]+/g, '_') + '_fotos.zip', await zip.generateAsync({ type: 'blob' }));
    toast(n + ' foto(s) compactada(s).');
  }

  async function arquivoNoMapa(id) {
    const a = await DB.get('arquivos', id);
    a.visivel = true; await DB.put('arquivos', a);
    ir('mapa');
    try { toast('Carregando camada…'); await Mapa.mostrarCamada(a); Mapa.zoomCamada(id); toast('Camada carregada.'); } catch (e) { toast(e.message, true); }
  }

  async function moverArquivo(id, novaPasta) {
    const a = await DB.get('arquivos', id);
    a.pasta = novaPasta; a.atualizadoEm = Date.now(); a._sujo = a.local ? 0 : 1;
    await DB.put('arquivos', a); await recarregarCache(); renderArquivos(); agendarSync();
  }

  async function excluirArquivo(id) {
    if (!confirm('Excluir este arquivo do projeto?')) return;
    const a = await DB.get('arquivos', id);
    Mapa.ocultarCamada(id);
    a.excluido = true; a.atualizadoEm = Date.now(); a._sujo = a.local ? 0 : 1;
    await DB.put('arquivos', a); await DB.del('blobs', id);
    await recarregarCache(); renderArquivos(); agendarSync();
  }

  const arquivosDoProjeto = async () => projeto ? (await DB.doProjeto('arquivos', projeto.id)) : [];

  /* ======================= AJUSTES ======================= */
  async function renderConfig() {
    const ult = await DB.kv('ultimaSync');
    const pend = await API.pendencias();
    const ehAdmin = usuario && usuario.perfil === 'admin';
    $('#v-config').innerHTML = `<div class="conteudo">
      <h2>Ajustes</h2>
      <div class="cards">
        <div class="card"><h4>Minha conta</h4>
          <p style="margin:6px 0"><b>${esc(usuario.nome)}</b><br><small>${esc(usuario.email)}</small><br>
          <span class="tag">${usuario.perfil === 'admin' ? 'Administrador' : 'Usuário'}</span>${usuario.funcao ? '<span class="tag local">' + esc(usuario.funcao) + '</span>' : ''}</p>
          <details><summary class="mudo" style="cursor:pointer">Alterar senha</summary>
            <label>Senha atual<input type="password" id="s-atual"></label><label>Nova senha<input type="password" id="s-nova"></label>
            <button class="btn" onclick="App.alterarSenha()">Alterar</button></details>
          <div class="linha-btns" style="margin-top:12px"><button class="btn perigo" onclick="App.sair()">Sair</button></div></div>

        <div class="card"><h4>Sincronização</h4>
          <p class="meta">${navigator.onLine ? '🟢 Online' : '🔴 Offline — os dados ficam salvos no aparelho'}<br>
          Última sincronização: ${ult ? fmtData(ult) : 'nunca'}<br>Itens pendentes: <b>${pend}</b></p>
          <div class="linha-btns"><button class="btn primario" onclick="App.sincronizarTudo(true)">Sincronizar agora</button></div>
          <p class="meta" style="margin-top:10px">Servidor: <small>${esc(API.url()).slice(0, 60)}…</small></p></div>

        <div class="card"><h4>Fotos</h4>
          <label class="chk"><input type="checkbox" ${localStorage.getItem('gc_carimbo') !== '0' ? 'checked' : ''} onchange="localStorage.setItem('gc_carimbo',this.checked?'1':'0')"> Carimbar data, projeto e coordenadas</label>
          <label>Resolução máxima<select onchange="localStorage.setItem('gc_foto_max',this.value)">
            ${[1280, 1600, 1920, 2560, 3200].map(v => `<option value="${v}" ${String(v) === (localStorage.getItem('gc_foto_max') || '1920') ? 'selected' : ''}>${v} px${v === 1920 ? ' (padrão)' : ''}</option>`).join('')}</select></label></div>

        <div class="card"><h4>Inteligência artificial (Gemini)</h4>
          <p class="meta" id="ia-status">Verificando chave do servidor…</p>
          <details><summary class="mudo" style="cursor:pointer">Usar chave própria neste aparelho</summary>
            <label>Chave API Gemini<input type="password" id="ia-chave-local" value="${esc(localStorage.getItem('gc_gemini_key') || '')}" placeholder="AIza…"></label>
            <label>Modelo<input id="ia-modelo-local" value="${esc(localStorage.getItem('gc_gemini_modelo') || 'gemini-3.8-flash')}"></label>
            <button class="btn" onclick="App.salvarIALocal()">Salvar neste aparelho</button></details></div>

        ${promptInstalar ? `<div class="card"><h4>Instalar aplicativo</h4><p class="meta">Adicione o GeoCampo à tela inicial para usar como app.</p><button class="btn primario" onclick="App.instalar()">Instalar</button></div>` : ''}

        <div class="card"><h4>Dados do aparelho</h4>
          <p class="meta">Fotos, camadas e registros ficam guardados no aparelho para uso offline.</p>
          <div class="linha-btns"><button class="btn perigo" onclick="App.limparLocal()">Apagar dados locais</button></div></div>
      </div>
      ${ehAdmin ? `<h2 style="margin-top:26px">Administração</h2>
      <div class="cards">
        <div class="card"><h4>Chave da IA no servidor</h4><p class="meta">Usada por toda a equipe. A chave fica guardada no Apps Script e não aparece para os usuários.</p>
          <label>Chave API Gemini<input type="password" id="ia-chave-srv" placeholder="AIza… (deixe vazio para manter)"></label>
          <label>Modelo<input id="ia-modelo-srv" placeholder="gemini-3.8-flash"></label>
          <button class="btn primario" onclick="App.salvarIAServidor()">Salvar no servidor</button></div>
      </div>
      <h3>Usuários</h3><div id="lista-usuarios"><button class="btn" onclick="App.carregarUsuarios()">Carregar usuários</button></div>` : ''}
    </div>`;
    const st = $('#ia-status');
    if (localStorage.getItem('gc_gemini_key')) st.textContent = '✅ Usando chave própria deste aparelho.';
    else API.chamar('statusIA').then(r => st.textContent = r.configurada ? '✅ IA disponível (chave do servidor).' : '⚠️ Chave não configurada no servidor. Peça ao administrador ou use uma chave própria.')
      .catch(() => st.textContent = 'Sem conexão para verificar a IA.');
    if (ehAdmin && navigator.onLine) carregarUsuarios();
  }

  async function alterarSenha() {
    try { await API.chamar('alterarSenha', { senhaAtual: $('#s-atual').value, novaSenha: $('#s-nova').value }); toast('Senha alterada.'); renderConfig(); }
    catch (e) { toast(e.message, true); }
  }
  function salvarIALocal() {
    const k = $('#ia-chave-local').value.trim(), m = $('#ia-modelo-local').value.trim();
    if (k) localStorage.setItem('gc_gemini_key', k); else localStorage.removeItem('gc_gemini_key');
    if (m) localStorage.setItem('gc_gemini_modelo', m);
    toast('Configuração da IA salva neste aparelho.'); renderConfig();
  }
  async function salvarIAServidor() {
    const chave = $('#ia-chave-srv').value.trim(), modelo = $('#ia-modelo-srv').value.trim();
    try { const r = await API.chamar('salvarChaveIA', Object.assign({}, chave ? { chave } : {}, modelo ? { modelo } : {})); toast(r.configurada ? 'IA configurada no servidor (' + r.modelo + ').' : 'Chave removida.'); renderConfig(); }
    catch (e) { toast(e.message, true); }
  }

  async function carregarUsuarios() {
    const el = $('#lista-usuarios'); if (!el) return;
    el.innerHTML = '<p class="mudo">Carregando…</p>';
    try {
      const r = await API.chamar('listarUsuarios');
      const st = { aprovado: 'ok', pendente: 'pend', bloqueado: 'local' };
      el.innerHTML = `<div style="overflow-x:auto"><table class="tabela"><thead><tr><th>Nome</th><th>E-mail</th><th>Situação</th><th>Último acesso</th><th></th></tr></thead><tbody>
        ${r.usuarios.map(u => `<tr><td><b>${esc(u.nome)}</b><br><small>${esc(u.funcao || '')}</small></td><td>${esc(u.email)}</td>
          <td><span class="tag ${st[u.status] || ''}">${esc(u.status)}</span>${u.perfil === 'admin' ? '<span class="tag">admin</span>' : ''}</td>
          <td><small>${fmtData(u.ultimoAcesso)}</small></td>
          <td><div class="linha-btns">
            ${u.status !== 'aprovado' ? `<button class="btn peq primario" onclick="App.admUsuario('${u.id}',{status:'aprovado'})">Aprovar</button>` : ''}
            ${u.status === 'aprovado' && u.id !== usuario.id ? `<button class="btn peq" onclick="App.admUsuario('${u.id}',{status:'bloqueado'})">Bloquear</button>` : ''}
            ${u.id !== usuario.id ? `<button class="btn peq" onclick="App.admUsuario('${u.id}',{perfil:'${u.perfil === 'admin' ? 'usuario' : 'admin'}'})">${u.perfil === 'admin' ? 'Tirar admin' : 'Tornar admin'}</button>
            <button class="btn peq" onclick="App.admSenha('${u.id}')">Redefinir senha</button>
            <button class="btn peq perigo" onclick="App.admUsuario('${u.id}',{excluir:true})">Excluir</button>` : ''}
          </div></td></tr>`).join('')}</tbody></table></div>`;
    } catch (e) { el.innerHTML = `<p class="mudo">${esc(e.message)}</p>`; }
  }
  async function admUsuario(id, mud) {
    if (mud.excluir && !confirm('Excluir este usuário?')) return;
    try { await API.chamar('atualizarUsuario', Object.assign({ id }, mud)); toast('Usuário atualizado.'); carregarUsuarios(); } catch (e) { toast(e.message, true); }
  }
  function admSenha(id) { const s = prompt('Nova senha (mínimo 6 caracteres):'); if (s) admUsuario(id, { novaSenha: s }); }

  async function limparLocal() {
    const pend = await API.pendencias();
    if (!confirm((pend ? `ATENÇÃO: há ${pend} item(ns) ainda não sincronizado(s) que serão perdidos.\n` : '') + 'Apagar todos os dados locais deste aparelho?')) return;
    await DB.limparTudo(); localStorage.removeItem('gc_projeto'); location.reload();
  }
  async function instalar() { if (promptInstalar) { promptInstalar.prompt(); promptInstalar = null; renderConfig(); } }

  /* ======================= SINCRONIZAÇÃO ======================= */
  let tSync;
  function agendarSync() { atualizarBadge(); clearTimeout(tSync); tSync = setTimeout(() => sincronizarTudo(false), 4000); }

  async function sincronizarTudo(manual) {
    const btn = $('#btn-sync');
    if (!navigator.onLine) { if (manual) toast('Sem internet. Os dados estão salvos no aparelho e serão enviados depois.', true); return; }
    btn.classList.add('girando');
    try {
      const ok = await API.sincronizarTudo(projeto && projeto.id, t => manual && toast(t));
      if (ok) {
        if (projeto) { projeto = await DB.get('projetos', projeto.id); if (!projeto || projeto.excluido) { projeto = null; localStorage.removeItem('gc_projeto'); } }
        await recarregarCache();
        if (!form) { render(); if (vista === 'mapa') redesenharMapa(); }
        if (manual) toast('Sincronizado ✔');
      }
    } catch (e) { if (manual) toast('Sincronização: ' + e.message, true); console.warn(e); }
    finally { btn.classList.remove('girando'); atualizarBadge(); }
  }

  async function atualizarBadge() {
    const n = await API.pendencias();
    const b = $('#sync-badge'); b.hidden = !n; b.textContent = n;
    $('#btn-sync').style.opacity = navigator.onLine ? 1 : .6;
  }

  /* ======================= INICIALIZAÇÃO ======================= */
  function iniciar() {
    iniciarLogin();
    $('#in-foto-camera').onchange = e => { processarFotos([...e.target.files]); e.target.value = ''; };
    $('#in-foto-galeria').onchange = e => { processarFotos([...e.target.files]); e.target.value = ''; };
    $('#in-arquivo').onchange = e => { receberArquivos([...e.target.files], destinoArq && destinoArq.pasta, destinoArq && destinoArq.paraMapa); e.target.value = ''; };
    $('#modal').addEventListener('click', e => { if (e.target.id === 'modal' && !form) fecharModal(); });
    window.addEventListener('online', () => { atualizarBadge(); sincronizarTudo(false); });
    window.addEventListener('offline', atualizarBadge);
    window.addEventListener('gc-sessao-expirada', () => { toast('Sessão expirada. Entre novamente.', true); localStorage.removeItem('gc_token'); $('#app').hidden = true; $('#tela-login').hidden = false; });
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); promptInstalar = e; });
    setInterval(() => { if (!document.hidden && API.token()) sincronizarTudo(false); }, 120000);
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
    if (usuario && API.token()) entrarNoApp();
  }

  document.addEventListener('DOMContentLoaded', iniciar);

  return {
    esc, toast, modal, fecharModal, corDe, projetoAtual, ir, renderProjetos, abrirProjeto, editarProjeto, salvarProjeto, excluirProjeto,
    novaFeicao, abrirFeicao, salvarFeicao, excluirFeicao, editarGeom, verNoMapa, addAttr, filtrar, exportar, baixarExport,
    adicionarFotos, verFoto, excluirFoto, ia, aplicarIA, renderCaderneta, abrirCaderneta, salvarCaderneta, excluirCaderneta, relatorio,
    pasta, escolherArquivos, baixarArquivo, baixarFotos, arquivoNoMapa, moverArquivo, excluirArquivo, arquivosDoProjeto,
    alterarSenha, salvarIALocal, salvarIAServidor, carregarUsuarios, admUsuario, admSenha, limparLocal, instalar, sair,
    sincronizarTudo, redesenharMapa
  };
})();
