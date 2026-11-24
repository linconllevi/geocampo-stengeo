/* Comunicação com o servidor (Apps Script), sincronização e IA */
const API = (() => {
  const C = window.GEOCAMPO_CONFIG;
  const valida = u => /^https:\/\/script\.google(usercontent)?\.com\/.+\/exec$/.test(String(u || '').trim());
  const url = () => valida(C.API_URL) ? C.API_URL : (localStorage.getItem('gc_api_url') || '').trim();
  const configurado = () => valida(url());
  const token = () => localStorage.getItem('gc_token');

  async function chamar(acao, dados = {}) {
    if (!configurado()) throw new Error('Servidor não configurado. Informe a URL do Apps Script em "Servidor".');
    if (!navigator.onLine) throw new Error('Sem conexão com a internet.');
    const corpo = JSON.stringify(Object.assign({ acao, token: token() }, dados));
    let r;
    try {
      r = await fetch(url(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: corpo, redirect: 'follow' });
    } catch (e) { throw new Error('Falha de conexão com o servidor.'); }
    const j = await r.json().catch(() => ({ ok: false, erro: 'Resposta inválida do servidor (verifique a implantação do Apps Script).' }));
    if (!j.ok) {
      if (String(j.erro || '').startsWith('SESSAO')) window.dispatchEvent(new CustomEvent('gc-sessao-expirada'));
      throw new Error(String(j.erro || 'Erro no servidor').replace(/^SESSAO:\s*/, ''));
    }
    return j;
  }

  const blobParaBase64 = b => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1]);
    fr.onerror = rej;
    fr.readAsDataURL(b);
  });
  function base64ParaBlob(b64, mime) {
    const bin = atob(b64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type: mime || 'application/octet-stream' });
  }

  /* ---------- Blob local (foto/arquivo) com download sob demanda ---------- */
  async function obterBlob(rec) {
    const local = await DB.get('blobs', rec.id);
    if (local) return local.blob;
    if (!rec.driveId) return null;
    const r = await chamar('baixarArquivo', { projetoId: rec.projetoId, driveId: rec.driveId });
    const blob = base64ParaBlob(r.base64, r.mime);
    await DB.put('blobs', { id: rec.id, blob });
    return blob;
  }

  /* ---------- Sincronização de um projeto ---------- */
  let sincronizando = false;
  async function sincronizarProjeto(pid, progresso = () => {}) {
    const proj = await DB.get('projetos', pid);
    if (!proj) return;
    if (proj._sujo) {
      const r = await chamar('salvarProjeto', { projeto: limpar(proj) });
      await DB.put('projetos', Object.assign({}, r.projeto, { _sujo: 0, _sync: proj._sync }));
    }
    // 1. envia binários pendentes (fotos e arquivos compartilhados)
    for (const col of ['fotos', 'arquivos']) {
      const pend = (await DB.doProjeto(col, pid)).filter(x => !x.driveId && !x.local && !x.excluido);
      for (let i = 0; i < pend.length; i++) {
        const rec = pend[i];
        const b = await DB.get('blobs', rec.id);
        if (!b) continue;
        progresso(`Enviando ${col === 'fotos' ? 'foto' : 'arquivo'} ${i + 1}/${pend.length}…`);
        const r = await chamar('enviarArquivo', {
          projetoId: pid, pasta: col === 'fotos' ? 'Fotos de campo' : (rec.pasta || 'Arquivos'),
          nome: rec.nome || (rec.id + '.jpg'), mime: b.blob.type, base64: await blobParaBase64(b.blob)
        });
        rec.driveId = r.driveId; rec.url = r.url; rec.atualizadoEm = Date.now(); rec._sujo = 1;
        await DB.put(col, rec);
      }
    }
    // 2. envia registros alterados e recebe novidades
    progresso('Sincronizando registros…');
    const envios = {}, enviados = {};
    for (const col of DB.COM_PROJETO) {
      const sujos = (await DB.doProjeto(col, pid)).filter(x => x._sujo && !x.local);
      envios[col] = sujos.map(limpar);
      enviados[col] = new Map(sujos.map(x => [x.id, x.atualizadoEm]));
    }
    const desde = (await DB.kv('sync_' + pid)) || 0;
    const r = await chamar('sincronizar', { projetoId: pid, desde, envios });
    for (const col of DB.COM_PROJETO) {
      const atualizar = [];
      for (const [id, ts] of enviados[col]) {
        const loc = await DB.get(col, id);
        if (loc && loc.atualizadoEm === ts) { loc._sujo = 0; atualizar.push(loc); }
      }
      for (const rem of (r.mudancas[col] || [])) {
        const loc = await DB.get(col, rem.id);
        if (!loc || (!loc._sujo && rem.atualizadoEm >= (loc.atualizadoEm || 0))) atualizar.push(Object.assign({}, rem, { _sujo: 0 }));
      }
      await DB.putVarios(col, atualizar);
    }
    await DB.kv('sync_' + pid, r.servidorEm);
    const p2 = await DB.get('projetos', pid);
    if (p2) { p2._sync = Date.now(); await DB.put('projetos', p2); }
    return r;
  }

  function limpar(o) { const c = Object.assign({}, o); delete c._sujo; delete c._sync; return c; }

  async function sincronizarTudo(pidAtual, progresso) {
    if (sincronizando || !navigator.onLine || !configurado() || !token()) return false;
    sincronizando = true;
    try {
      // projetos novos/alterados primeiro
      for (const p of (await DB.todos('projetos')).filter(p => p._sujo)) {
        const r = await chamar('salvarProjeto', { projeto: limpar(p) });
        await DB.put('projetos', Object.assign({}, r.projeto, { _sujo: 0, _sync: p._sync }));
      }
      const lista = await chamar('listarProjetos');
      for (const rp of lista.projetos) {
        const loc = await DB.get('projetos', rp.id);
        if (!loc || (!loc._sujo && rp.atualizadoEm >= (loc.atualizadoEm || 0))) await DB.put('projetos', Object.assign({}, rp, { _sujo: 0, _sync: loc && loc._sync }));
      }
      // sincroniza o projeto aberto + qualquer projeto com pendências
      const alvos = new Set(pidAtual ? [pidAtual] : []);
      for (const col of DB.COM_PROJETO) (await DB.todos(col)).filter(x => x._sujo && !x.local).forEach(x => alvos.add(x.projetoId));
      for (const pid of alvos) await sincronizarProjeto(pid, progresso);
      await DB.kv('ultimaSync', Date.now());
      return true;
    } finally { sincronizando = false; }
  }

  async function pendencias() {
    let n = (await DB.todos('projetos')).filter(p => p._sujo).length;
    for (const col of DB.COM_PROJETO) n += (await DB.todos(col)).filter(x => (x._sujo || (!x.driveId && (col === 'fotos' || col === 'arquivos') && !x.excluido)) && !x.local).length;
    return n;
  }

  /* ---------- IA (Gemini) ---------- */
  const SISTEMA = `Você é um assistente técnico de uma empresa de geologia e engenharia (StenGEO) e revisa anotações de caderneta de campo escritas no celular.
Regras:
- Escreva em português do Brasil, em linguagem técnica, clara e objetiva, com afirmações diretas.
- Corrija ortografia, gramática, pontuação e abreviações informais.
- NÃO invente dados, medidas, nomes, litologias ou conclusões que não estejam no texto original. Preserve todos os números, unidades, coordenadas, atitudes estruturais (ex.: N30E/45SE) e códigos.
- Use a terminologia técnica correta de geologia, geotecnia, meio ambiente e topografia quando o texto indicar o assunto.
- Responda SOMENTE com o texto final, sem comentários, sem títulos extras e sem markdown.`;

  const MODOS = {
    melhorar: 'Reescreva o texto abaixo melhorando a redação técnica, mantendo o mesmo conteúdo e aproximadamente o mesmo tamanho.',
    tecnico: 'Reescreva o texto abaixo como uma descrição técnica formal de relatório, organizada em parágrafos.',
    topicos: 'Organize o texto abaixo em tópicos curtos (use "- " no início de cada linha), agrupando por assunto (ex.: localização, descrição, observações, recomendações) somente quando houver informação para isso.',
    resumir: 'Resuma o texto abaixo em até 3 frases objetivas.'
  };

  async function ia(texto, modo = 'melhorar', contexto = '') {
    const prompt = `${MODOS[modo] || MODOS.melhorar}\n${contexto ? 'Contexto do registro: ' + contexto + '\n' : ''}\nTexto original:\n"""${texto}"""`;
    const chaveLocal = localStorage.getItem('gc_gemini_key');
    if (chaveLocal) {
      const modelo = localStorage.getItem('gc_gemini_modelo') || 'gemini-3.8-flash';
      if (!navigator.onLine) throw new Error('A IA precisa de internet.');
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chaveLocal },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: SISTEMA }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }] })
      });
      const j = await r.json();
      if (!r.ok) throw new Error('IA: ' + ((j.error && j.error.message) || r.status));
      return ((j.candidates?.[0]?.content?.parts) || []).map(p => p.text || '').join('').trim();
    }
    const r = await chamar('ia', { sistema: SISTEMA, texto: prompt });
    return r.texto;
  }

  return { chamar, configurado, url, token, obterBlob, sincronizarTudo, sincronizarProjeto, pendencias, ia, blobParaBase64, base64ParaBlob };
})();
