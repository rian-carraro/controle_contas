/*
  db.js
  Wrapper mínimo para IndexedDB usado pelo app.
  - Cria object stores: cards, incomes, expenses, fixed, invoices, settings
  - Fornece funções utilitárias simples: add, put, getAll, getByKey, where
  - exportAll() para exportar todas as tabelas
*/

const DB_NAME = 'financas-db-v1';
const DB_VERSION = 1;
let db; // referência para a conexão do IndexedDB

/**
 * openDB - abre/atualiza a base IndexedDB e garante que as objectStores existam
 * Ao abrir com sucesso, também define window.db para que outros scripts possam detectar a inicialização.
 */
function openDB(){
  return new Promise((res, rej)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e)=>{
      const idb = e.target.result;
      // stores principais do aplicativo
      if(!idb.objectStoreNames.contains('cards')) idb.createObjectStore('cards',{keyPath:'id',autoIncrement:true});
      if(!idb.objectStoreNames.contains('incomes')) idb.createObjectStore('incomes',{keyPath:'id',autoIncrement:true});
      if(!idb.objectStoreNames.contains('expenses')) idb.createObjectStore('expenses',{keyPath:'id',autoIncrement:true});
      if(!idb.objectStoreNames.contains('fixed')) idb.createObjectStore('fixed',{keyPath:'id',autoIncrement:true});
      if(!idb.objectStoreNames.contains('invoices')) idb.createObjectStore('invoices',{keyPath:'id',autoIncrement:true});
      if(!idb.objectStoreNames.contains('settings')) idb.createObjectStore('settings',{keyPath:'key'});
    };
    req.onsuccess = (e)=>{ db = e.target.result; window.db = db; res(db); };
    req.onerror = (e)=> rej(e.target.error);
  });
}

/**
 * tx - helper para criar uma transaction e retornar os objectStores utilizados
 * @param {string[]} storeNames - nomes das stores a incluir na transação
 * @param {string} mode - 'readonly' | 'readwrite'
 */
function tx(storeNames, mode='readonly'){
  const tx = db.transaction(storeNames, mode);
  const stores = {};
  storeNames.forEach(name=>stores[name]=tx.objectStore(name));
  return {tx, stores};
}

// Operações CRUD mínimas (baseadas em promises)
async function add(store, val){
  return new Promise((res, rej)=>{
    const {stores} = tx([store],'readwrite');
    const req = stores[store].add(val);
    req.onsuccess = ()=>{
      // emitir evento global para a app saber que os dados mudaram
      try{ document.dispatchEvent(new CustomEvent('data-changed',{detail:{store,action:'add',key:req.result}})); }catch(e){}
      res(req.result);
    };
    req.onerror = (e)=>rej(e.target.error);
  });
}
async function put(store, val){
  return new Promise((res, rej)=>{
    const {stores} = tx([store],'readwrite');
    const req = stores[store].put(val);
    req.onsuccess = ()=>{
      // emitir evento global informando atualização
      try{ document.dispatchEvent(new CustomEvent('data-changed',{detail:{store,action:'put',key:req.result}})); }catch(e){}
      res(req.result);
    };
    req.onerror = (e)=>rej(e.target.error);
  });
}
async function getAll(store){
  return new Promise((res, rej)=>{
    const {stores} = tx([store]);
    const req = stores[store].getAll();
    req.onsuccess = ()=>res(req.result);
    req.onerror = (e)=>rej(e.target.error);
  });
}
async function getByKey(store, key){
  return new Promise((res, rej)=>{
    const {stores} = tx([store]);
    const req = stores[store].get(key);
    req.onsuccess = ()=>res(req.result);
    req.onerror = (e)=>rej(e.target.error);
  });
}
// delete (remove) registro por chave
async function del(store, key){
  return new Promise((res, rej)=>{
    const {stores} = tx([store],'readwrite');
    const req = stores[store].delete(key);
    req.onsuccess = ()=>{
      // emitir evento global informando remoção
      try{ document.dispatchEvent(new CustomEvent('data-changed',{detail:{store,action:'del',key}})); }catch(e){}
      res(true);
    };
    req.onerror = (e)=>rej(e.target.error);
  });
}

/**
 * where - consulta simples em memória com predicate
 * Observação: carrega todos os registros da store e filtra no JS. Adequado para protótipo/local.
 */
async function where(store, predicate){
  const all = await getAll(store);
  return all.filter(predicate);
}

// inicializa DB automaticamente
openDB().catch(err=>console.error('DB open failed',err));

// util para exportar todo o conteúdo (usado na função de exportação)
async function exportAll(){
  const cards = await getAll('cards');
  const incomes = await getAll('incomes');
  const expenses = await getAll('expenses');
  const fixeds = await getAll('fixed');
  const invoices = await getAll('invoices');
  return {cards,incomes,expenses,fixeds,invoices};
}
