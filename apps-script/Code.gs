/**
 * GeoCampo StenGEO — Backend (Google Apps Script)
 * ------------------------------------------------------------
 * Planilha  : guarda usuários, projetos, feições, caderneta, arquivos e fotos
 * Drive     : pasta "GeoCampo StenGEO" com uma subpasta por projeto
 * IA        : proxy para a API Gemini (chave guardada nas Propriedades do Script)
 *
 * IMPLANTAÇÃO (resumo — ver README.md):
 *  1. Crie uma Planilha Google na conta StenGEO > Extensões > Apps Script.
 *  2. Cole este arquivo em Code.gs e salve.
 *  3. Execute a função "configurarInicial" uma vez (autorize as permissões).
 *  4. Em "Configurações do projeto > Propriedades do script" ajuste:
 *       ADMIN_EMAIL     = seu e-mail (vira administrador ao se cadastrar)
 *       GEMINI_API_KEY  = sua chave do Google AI Studio (opcional, para IA)
 *       GEMINI_MODEL    = gemini-3.8-flash (opcional)
 *  5. Implantar > Nova implantação > App da Web
 *       Executar como: Eu  |  Quem pode acessar: Qualquer pessoa
 *  6. Copie a URL /exec e coloque em config.js do app.
 */

var VERSAO = '1.2.0';
var PASTA_RAIZ_NOME = 'GeoCampo StenGEO';
var TOKEN_DIAS = 30;

var COLECOES = {
  feicoes:   { aba: 'Feicoes',   cols: ['id', 'projetoId', 'tipo', 'codigo', 'categoria', 'titulo', 'autor', 'criadoEm', 'atualizadoEm', 'excluido', 'sincronizadoEm', 'dados'] },
  caderneta: { aba: 'Caderneta', cols: ['id', 'projetoId', 'data', 'atividade', 'autor', 'criadoEm', 'atualizadoEm', 'excluido', 'sincronizadoEm', 'dados'] },
  arquivos:  { aba: 'Arquivos',  cols: ['id', 'projetoId', 'nome', 'pasta', 'driveId', 'autor', 'criadoEm', 'atualizadoEm', 'excluido', 'sincronizadoEm', 'dados'] },
  fotos:     { aba: 'Fotos',     cols: ['id', 'projetoId', 'refTipo', 'refId', 'driveId', 'autor', 'criadoEm', 'atualizadoEm', 'excluido', 'sincronizadoEm', 'dados'] }
};
var ABA_USUARIOS = { aba: 'Usuarios', cols: ['id', 'nome', 'email', 'funcao', 'perfil', 'status', 'salt', 'hash', 'criadoEm', 'ultimoAcesso'] };
var ABA_PROJETOS = { aba: 'Projetos', cols: ['id', 'nome', 'cliente', 'municipio', 'membros', 'criadoPor', 'pastaId', 'criadoEm', 'atualizadoEm', 'excluido', 'dados'] };

/* ======================= ENTRADA HTTP ======================= */

function doGet(e) {
  return json_({ ok: true, app: 'GeoCampo StenGEO', versao: VERSAO });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, erro: 'Requisição inválida' });
  }
  try {
    var acao = req.acao;
    var publicas = { cadastrar: cadastrar_, login: login_, ping: function () { return { versao: VERSAO }; } };
    if (publicas[acao]) return json_(ok_(publicas[acao](req)));

    var usuario = autenticar_(req.token);
    var privadas = {
      eu: function () { return { usuario: publico_(usuario) }; },
      listarProjetos: listarProjetos_,
      equipeProjeto: equipeProjeto_,
      salvarProjeto: salvarProjeto_,
      excluirProjeto: excluirProjeto_,
      sincronizar: sincronizar_,
      enviarArquivo: enviarArquivo_,
      baixarArquivo: baixarArquivo_,
      ia: ia_,
      statusIA: function () { return { configurada: !!prop_('GEMINI_API_KEY') }; },
      listarUsuarios: listarUsuarios_,
      atualizarUsuario: atualizarUsuario_,
      alterarSenha: alterarSenha_,
      salvarChaveIA: salvarChaveIA_
    };
    if (!privadas[acao]) throw new Error('Ação desconhecida: ' + acao);
    return json_(ok_(privadas[acao](req, usuario)));
  } catch (err) {
    return json_({ ok: false, erro: String(err.message || err) });
  }
}

function ok_(dados) { var r = dados || {}; r.ok = true; return r; }
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ======================= CONFIGURAÇÃO ======================= */

function configurarInicial() {
  var ss = planilha_();
  [ABA_USUARIOS, ABA_PROJETOS].concat(Object.keys(COLECOES).map(function (k) { return COLECOES[k]; }))
    .forEach(function (t) { aba_(t); });
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SEGREDO')) props.setProperty('SEGREDO', Utilities.getUuid() + Utilities.getUuid());
  if (!props.getProperty('ADMIN_EMAIL')) props.setProperty('ADMIN_EMAIL', Session.getEffectiveUser().getEmail());
  if (!props.getProperty('GEMINI_MODEL')) props.setProperty('GEMINI_MODEL', 'gemini-3.8-flash');
  pastaRaiz_();
  Logger.log('Configuração concluída. Planilha: ' + ss.getUrl());
}

function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }

function planilha_() {
  var id = prop_('PLANILHA_ID');
  if (id) return SpreadsheetApp.openById(id);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    ss = SpreadsheetApp.create('GeoCampo StenGEO - Banco de dados');
  }
  PropertiesService.getScriptProperties().setProperty('PLANILHA_ID', ss.getId());
  return ss;
}

function aba_(t) {
  var ss = planilha_();
  var sh = ss.getSheetByName(t.aba);
  if (!sh) {
    sh = ss.insertSheet(t.aba);
    sh.getRange(1, 1, 1, t.cols.length).setValues([t.cols]).setFontWeight('bold').setBackground('#0b4f9c').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

function pastaRaiz_() {
  var id = prop_('PASTA_RAIZ_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var it = DriveApp.getFoldersByName(PASTA_RAIZ_NOME);
  var f = it.hasNext() ? it.next() : DriveApp.createFolder(PASTA_RAIZ_NOME);
  PropertiesService.getScriptProperties().setProperty('PASTA_RAIZ_ID', f.getId());
  return f;
}

/* ======================= TABELAS ======================= */

function lerTabela_(t) {
  var sh = aba_(t);
  var n = sh.getLastRow();
  if (n < 2) return [];
  var vals = sh.getRange(2, 1, n - 1, t.cols.length).getValues();
  return vals.map(function (row, i) {
    var o = { _linha: i + 2 };
    t.cols.forEach(function (c, j) { o[c] = row[j]; });
    return o;
  });
}

function gravarLinha_(t, obj, linha) {
  var sh = aba_(t);
  var row = t.cols.map(function (c) {
    var v = obj[c];
    if (v === undefined || v === null) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  });
  if (linha) sh.getRange(linha, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
}

/* ======================= USUÁRIOS / AUTENTICAÇÃO ======================= */

function hash_(senha, salt) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + senha, Utilities.Charset.UTF_8);
  for (var i = 0; i < 500; i++) {
    bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes.concat(Utilities.newBlob(salt).getBytes()));
  }
  return Utilities.base64Encode(bytes);
}

function assinar_(texto) {
  var seg = prop_('SEGREDO');
  if (!seg) throw new Error('Execute configurarInicial() no Apps Script.');
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(texto, seg));
}

function gerarToken_(u) {
  var payload = Utilities.base64EncodeWebSafe(JSON.stringify({ id: u.id, exp: Date.now() + TOKEN_DIAS * 86400000 }));
  return payload + '.' + assinar_(payload);
}

function autenticar_(token) {
  if (!token) throw new Error('SESSAO: faça login novamente.');
  var p = String(token).split('.');
  if (p.length !== 2 || assinar_(p[0]) !== p[1]) throw new Error('SESSAO: sessão inválida.');
  var dados = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(p[0])).getDataAsString());
  if (dados.exp < Date.now()) throw new Error('SESSAO: sessão expirada.');
  var u = lerTabela_(ABA_USUARIOS).filter(function (x) { return x.id === dados.id; })[0];
  if (!u) throw new Error('SESSAO: usuário não encontrado.');
  if (u.status !== 'aprovado') throw new Error('Seu acesso está ' + u.status + '. Aguarde aprovação do administrador.');
  return u;
}

function publico_(u) {
  return { id: u.id, nome: u.nome, email: u.email, funcao: u.funcao, perfil: u.perfil, status: u.status, criadoEm: u.criadoEm, ultimoAcesso: u.ultimoAcesso };
}

function cadastrar_(req) {
  var nome = String(req.nome || '').trim();
  var email = String(req.email || '').trim().toLowerCase();
  var senha = String(req.senha || '');
  if (!nome || !/^\S+@\S+\.\S+$/.test(email)) throw new Error('Informe nome e e-mail válidos.');
  if (senha.length < 6) throw new Error('A senha deve ter pelo menos 6 caracteres.');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var todos = lerTabela_(ABA_USUARIOS);
    if (todos.some(function (u) { return u.email === email; })) throw new Error('E-mail já cadastrado.');
    var admin = String(prop_('ADMIN_EMAIL') || '').toLowerCase();
    var ehAdmin = email === admin || todos.length === 0;
    var salt = Utilities.getUuid();
    var u = {
      id: 'u_' + Utilities.getUuid().slice(0, 8), nome: nome, email: email, funcao: String(req.funcao || ''),
      perfil: ehAdmin ? 'admin' : 'usuario', status: ehAdmin ? 'aprovado' : 'pendente',
      salt: salt, hash: hash_(senha, salt), criadoEm: new Date().toISOString(), ultimoAcesso: ''
    };
    gravarLinha_(ABA_USUARIOS, u);
    if (!ehAdmin && admin) {
      try {
        MailApp.sendEmail(admin, 'GeoCampo StenGEO - novo cadastro aguardando aprovação',
          nome + ' (' + email + ') se cadastrou no app. Entre como administrador em Configurações > Usuários para aprovar.');
      } catch (e) {}
    }
    return { status: u.status, mensagem: ehAdmin ? 'Conta de administrador criada.' : 'Cadastro enviado. Aguarde a aprovação do administrador.' };
  } finally { lock.releaseLock(); }
}

function login_(req) {
  var email = String(req.email || '').trim().toLowerCase();
  var u = lerTabela_(ABA_USUARIOS).filter(function (x) { return x.email === email; })[0];
  if (!u || hash_(String(req.senha || ''), u.salt) !== u.hash) throw new Error('E-mail ou senha incorretos.');
  if (u.status !== 'aprovado') throw new Error('Seu acesso está ' + u.status + '. Aguarde aprovação do administrador.');
  u.ultimoAcesso = new Date().toISOString();
  gravarLinha_(ABA_USUARIOS, u, u._linha);
  return { token: gerarToken_(u), usuario: publico_(u) };
}

function alterarSenha_(req, u) {
  if (hash_(String(req.senhaAtual || ''), u.salt) !== u.hash) throw new Error('Senha atual incorreta.');
  if (String(req.novaSenha || '').length < 6) throw new Error('A nova senha deve ter pelo menos 6 caracteres.');
  u.salt = Utilities.getUuid();
  u.hash = hash_(String(req.novaSenha), u.salt);
  gravarLinha_(ABA_USUARIOS, u, u._linha);
  return {};
}

function exigirAdmin_(u) { if (u.perfil !== 'admin') throw new Error('Apenas administradores.'); }

function listarUsuarios_(req, u) {
  exigirAdmin_(u);
  return { usuarios: lerTabela_(ABA_USUARIOS).map(publico_) };
}

function atualizarUsuario_(req, u) {
  exigirAdmin_(u);
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var alvo = lerTabela_(ABA_USUARIOS).filter(function (x) { return x.id === req.id; })[0];
    if (!alvo) throw new Error('Usuário não encontrado.');
    if (req.excluir) {
      if (alvo.id === u.id) throw new Error('Você não pode excluir a própria conta.');
      aba_(ABA_USUARIOS).deleteRow(alvo._linha);
      return {};
    }
    if (req.status) alvo.status = req.status;
    if (req.perfil) alvo.perfil = req.perfil;
    if (req.nome) alvo.nome = req.nome;
    if (req.funcao !== undefined) alvo.funcao = req.funcao;
    if (req.novaSenha) { alvo.salt = Utilities.getUuid(); alvo.hash = hash_(String(req.novaSenha), alvo.salt); }
    gravarLinha_(ABA_USUARIOS, alvo, alvo._linha);
    return { usuario: publico_(alvo) };
  } finally { lock.releaseLock(); }
}

function salvarChaveIA_(req, u) {
  exigirAdmin_(u);
  var p = PropertiesService.getScriptProperties();
  if (req.chave !== undefined) {
    if (req.chave) p.setProperty('GEMINI_API_KEY', req.chave); else p.deleteProperty('GEMINI_API_KEY');
  }
  if (req.modelo) p.setProperty('GEMINI_MODEL', req.modelo);
  return { configurada: !!p.getProperty('GEMINI_API_KEY'), modelo: p.getProperty('GEMINI_MODEL') };
}

/* ======================= PROJETOS ======================= */

function membrosDe_(p) {
  try { return JSON.parse(p.membros || '[]'); } catch (e) { return []; }
}

function podeVer_(p, u) {
  if (u.perfil === 'admin') return true;
  if (p.criadoPor === u.email) return true;
  return membrosDe_(p).indexOf(u.email) >= 0;
}

function projetoPublico_(p) {
  var extra = {};
  try { extra = JSON.parse(p.dados || '{}'); } catch (e) {}
  extra.id = p.id; extra.nome = p.nome; extra.cliente = p.cliente; extra.municipio = p.municipio;
  extra.membros = membrosDe_(p); extra.criadoPor = p.criadoPor; extra.criadoEm = p.criadoEm;
  extra.atualizadoEm = Number(p.atualizadoEm) || 0; extra.excluido = p.excluido === true || p.excluido === 'TRUE';
  return extra;
}

function listarProjetos_(req, u) {
  var lista = lerTabela_(ABA_PROJETOS).filter(function (p) { return podeVer_(p, u); }).map(projetoPublico_);
  return { projetos: lista };
}

function obterProjeto_(id, u) {
  var p = lerTabela_(ABA_PROJETOS).filter(function (x) { return x.id === id; })[0];
  if (!p) throw new Error('Projeto não encontrado (sincronize o projeto primeiro).');
  if (!podeVer_(p, u)) throw new Error('Sem acesso a este projeto.');
  return p;
}

function equipeProjeto_(req, u) {
  var p = obterProjeto_(req.id, u);
  var emails = [String(p.criadoPor).toLowerCase()].concat(membrosDe_(p));
  var usuarios = lerTabela_(ABA_USUARIOS);
  var vistos = {};
  var equipe = emails.filter(function (e) { if (!e || vistos[e]) return false; vistos[e] = 1; return true; }).map(function (e) {
    var x = usuarios.filter(function (k) { return k.email === e; })[0];
    return x ? { email: e, nome: x.nome, funcao: x.funcao, status: x.status, perfil: x.perfil, ultimoAcesso: x.ultimoAcesso, criador: e === String(p.criadoPor).toLowerCase() }
             : { email: e, nome: '', status: 'nao_cadastrado', criador: false };
  });
  return { equipe: equipe };
}

function salvarProjeto_(req, u) {
  var d = req.projeto || {};
  if (!d.id || !d.nome) throw new Error('Projeto sem id/nome.');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var existente = lerTabela_(ABA_PROJETOS).filter(function (x) { return x.id === d.id; })[0];
    if (existente && !podeVer_(existente, u)) throw new Error('Sem acesso a este projeto.');
    var membros = (d.membros || []).map(function (m) { return String(m).trim().toLowerCase(); }).filter(String);
    var extra = {};
    Object.keys(d).forEach(function (k) {
      if (['id', 'nome', 'cliente', 'municipio', 'membros', 'criadoPor', 'criadoEm', 'atualizadoEm', 'excluido'].indexOf(k) < 0) extra[k] = d[k];
    });
    var reg = {
      id: d.id, nome: d.nome, cliente: d.cliente || '', municipio: d.municipio || '',
      membros: JSON.stringify(membros),
      criadoPor: existente ? existente.criadoPor : u.email,
      pastaId: existente ? existente.pastaId : '',
      criadoEm: existente ? existente.criadoEm : (d.criadoEm || new Date().toISOString()),
      atualizadoEm: d.atualizadoEm || Date.now(), excluido: !!d.excluido, dados: JSON.stringify(extra)
    };
    gravarLinha_(ABA_PROJETOS, reg, existente ? existente._linha : null);
    return { projeto: projetoPublico_(reg) };
  } finally { lock.releaseLock(); }
}

function excluirProjeto_(req, u) {
  var p = obterProjeto_(req.id, u);
  if (u.perfil !== 'admin' && p.criadoPor !== u.email) throw new Error('Apenas o criador ou um administrador pode excluir.');
  p.excluido = true; p.atualizadoEm = Date.now();
  gravarLinha_(ABA_PROJETOS, p, p._linha);
  return {};
}

function pastaProjeto_(p, sub) {
  var pasta = null;
  if (p.pastaId) { try { pasta = DriveApp.getFolderById(p.pastaId); } catch (e) {} }
  if (!pasta) {
    pasta = pastaRaiz_().createFolder(String(p.nome));
    p.pastaId = pasta.getId();
    gravarLinha_(ABA_PROJETOS, p, p._linha);
  } else if (pasta.getName() !== String(p.nome)) {
    pasta.setName(String(p.nome)); // acompanha o nome do projeto (inclusive ao renomear)
  }
  if (!sub) return pasta;
  var it = pasta.getFoldersByName(sub);
  return it.hasNext() ? it.next() : pasta.createFolder(sub);
}

/* ======================= SINCRONIZAÇÃO ======================= */
/**
 * req.projetoId, req.desde (timestamp ms), req.envios = { feicoes:[...], caderneta:[...], arquivos:[...], fotos:[...] }
 * Regra: o registro com maior atualizadoEm vence.
 */
function sincronizar_(req, u) {
  var p = obterProjeto_(req.projetoId, u);
  var desde = Number(req.desde) || 0;
  var envios = req.envios || {};
  var agora = Date.now();
  var recebidos = {};
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    Object.keys(COLECOES).forEach(function (nome) {
      var t = COLECOES[nome];
      var lista = envios[nome] || [];
      var tabela = lerTabela_(t);
      var porId = {};
      tabela.forEach(function (r) { porId[r.id] = r; });
      var novas = [];
      lista.forEach(function (rec) {
        if (!rec || !rec.id || rec.projetoId !== p.id) return;
        var ex = porId[rec.id];
        if (ex && Number(ex.atualizadoEm) > Number(rec.atualizadoEm)) return;
        var linha = linhaDe_(t, rec, u);
        linha.sincronizadoEm = agora;
        if (ex) gravarLinha_(t, linha, ex._linha);
        else novas.push(linha);
      });
      if (novas.length) {
        var sh = aba_(t);
        var rows = novas.map(function (o) { return t.cols.map(function (c) { var v = o[c]; return v === undefined || v === null ? '' : (typeof v === 'object' ? JSON.stringify(v) : v); }); });
        sh.getRange(sh.getLastRow() + 1, 1, rows.length, t.cols.length).setValues(rows);
      }
      recebidos[nome] = lista.length;
    });
  } finally { lock.releaseLock(); }

  var mudancas = {};
  Object.keys(COLECOES).forEach(function (nome) {
    mudancas[nome] = lerTabela_(COLECOES[nome])
      .filter(function (r) { return r.projetoId === p.id && Number(r.sincronizadoEm || r.atualizadoEm) > desde; })
      .map(registroDe_);
  });
  return { recebidos: recebidos, mudancas: mudancas, servidorEm: agora, projeto: projetoPublico_(p) };
}

function linhaDe_(t, rec, u) {
  var o = {};
  t.cols.forEach(function (c) { if (c !== 'dados' && c !== 'sincronizadoEm') o[c] = rec[c]; });
  if (!o.autor) o.autor = u.email;
  o.excluido = !!rec.excluido;
  var copia = JSON.parse(JSON.stringify(rec));
  delete copia.blobLocal; delete copia._sujo;
  o.dados = JSON.stringify(copia);
  return o;
}

function registroDe_(r) {
  var d = {};
  try { d = JSON.parse(r.dados || '{}'); } catch (e) {}
  d.id = r.id; d.projetoId = r.projetoId; d.atualizadoEm = Number(r.atualizadoEm) || 0;
  d.excluido = r.excluido === true || r.excluido === 'TRUE';
  if (r.driveId) d.driveId = r.driveId;
  return d;
}

/* ======================= ARQUIVOS (DRIVE) ======================= */

function enviarArquivo_(req, u) {
  var p = obterProjeto_(req.projetoId, u);
  if (!req.base64 || !req.nome) throw new Error('Arquivo vazio.');
  var pasta = pastaProjeto_(p, req.pasta || 'Arquivos');
  var bytes = Utilities.base64Decode(req.base64);
  var blob = Utilities.newBlob(bytes, req.mime || 'application/octet-stream', req.nome);
  var f = pasta.createFile(blob);
  f.setDescription('GeoCampo | projeto ' + p.id + ' | enviado por ' + u.email);
  return { driveId: f.getId(), url: f.getUrl(), tamanho: f.getSize() };
}

function baixarArquivo_(req, u) {
  var p = obterProjeto_(req.projetoId, u);
  var f = DriveApp.getFileById(req.driveId);
  var desc = f.getDescription() || '';
  if (desc.indexOf('projeto ' + p.id) < 0) throw new Error('Arquivo não pertence a este projeto.');
  var blob = f.getBlob();
  return { nome: f.getName(), mime: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
}

/* ======================= IA (GEMINI) ======================= */

function ia_(req, u) {
  var chave = prop_('GEMINI_API_KEY');
  if (!chave) throw new Error('Chave da IA não configurada no servidor. O administrador deve cadastrá-la em Configurações.');
  var modelo = prop_('GEMINI_MODEL') || 'gemini-3.8-flash';
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(modelo) + ':generateContent';
  var corpo = {
    systemInstruction: { parts: [{ text: String(req.sistema || '') }] },
    contents: [{ role: 'user', parts: [{ text: String(req.texto || '') }] }]
  };
  if (req.audio && req.audio.base64) corpo.contents[0].parts.push({ inline_data: { mime_type: req.audio.mime || 'audio/wav', data: req.audio.base64 } });
  var resp = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-goog-api-key': chave }, payload: JSON.stringify(corpo)
  });
  var j = JSON.parse(resp.getContentText());
  if (resp.getResponseCode() !== 200) throw new Error('IA: ' + ((j.error && j.error.message) || resp.getResponseCode()));
  var partes = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
  return { texto: partes.map(function (x) { return x.text || ''; }).join('').trim() };
}

/** Executar manualmente: renomeia as pastas de projetos já existentes para o nome do projeto. */
function corrigirNomesPastas() {
  lerTabela_(ABA_PROJETOS).forEach(function (p) {
    if (!p.pastaId) return;
    try { var f = DriveApp.getFolderById(p.pastaId); if (f.getName() !== String(p.nome)) f.setName(String(p.nome)); } catch (e) {}
  });
}
