/* Banco local (IndexedDB) — permite trabalhar offline no campo */
const DB = (() => {
  const NOME = 'geocampo', VERSAO = 1;
  const COM_PROJETO = ['feicoes', 'caderneta', 'arquivos', 'fotos'];
  let dbp = null;

  function abrir() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(NOME, VERSAO);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('kv', { keyPath: 'k' });
        db.createObjectStore('projetos', { keyPath: 'id' });
        db.createObjectStore('blobs', { keyPath: 'id' });
        COM_PROJETO.forEach(n => db.createObjectStore(n, { keyPath: 'id' }).createIndex('projetoId', 'projetoId'));
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }

  async function tx(store, modo, fn) {
    const db = await abrir();
    return new Promise((res, rej) => {
      const t = db.transaction(store, modo);
      const s = t.objectStore(store);
      let out;
      const req = fn(s);
      if (req) req.onsuccess = () => { out = req.result; };
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }

  return {
    get: (s, id) => tx(s, 'readonly', st => st.get(id)),
    put: (s, obj) => tx(s, 'readwrite', st => st.put(obj)),
    del: (s, id) => tx(s, 'readwrite', st => st.delete(id)),
    todos: s => tx(s, 'readonly', st => st.getAll()),
    doProjeto: (s, pid) => tx(s, 'readonly', st => st.index('projetoId').getAll(pid)),
    async putVarios(s, lista) {
      if (!lista.length) return;
      return tx(s, 'readwrite', st => { lista.forEach(o => st.put(o)); });
    },
    async kv(k, v) {
      if (v === undefined) { const r = await tx('kv', 'readonly', st => st.get(k)); return r ? r.v : undefined; }
      return tx('kv', 'readwrite', st => st.put({ k, v }));
    },
    async limparTudo() {
      const db = await abrir();
      const nomes = Array.from(db.objectStoreNames);
      return new Promise((res, rej) => {
        const t = db.transaction(nomes, 'readwrite');
        nomes.forEach(n => t.objectStore(n).clear());
        t.oncomplete = res; t.onerror = () => rej(t.error);
      });
    },
    COM_PROJETO
  };
})();
