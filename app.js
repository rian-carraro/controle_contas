// Lógica principal da aplicação
// Este arquivo controla a renderização das views, interação do usuário e liga com o db.js
document.addEventListener('DOMContentLoaded', async ()=>{
  // espera a inicialização do IndexedDB (open em db.js)
  await waitForDB();
  // migrar parcelamentos antigos para incluir parcelGroup (torna "editar todas" confiável)
  await migrateParcelGroups();
  // configura eventos de UI (menu, navegação)
  initUI();
  // renderiza a view inicial
  renderView('dashboard');
});

/**
 * waitForDB - helper simples que aguarda window.db ser definido pelo db.js
 * O app depende dessa variável para executar consultas ao IndexedDB.
 */
function waitForDB(){
  return new Promise((res)=>{
    const check = ()=>{ if(window.db) return res(); setTimeout(check,50); }; check();
  });
}

// Migração: agrupa parcelas históricas sem parcelGroup
// Estratégia: agrupa por (description, totalInstallments, cardId). Se existir um conjunto
// completo com parcelas 1..N, adiciona um parcelGroup comum a cada item que não possua.
async function migrateParcelGroups(){
  try{
    const expenses = await getAll('expenses');
    // map key -> array
    const map = new Map();
    for(const e of expenses){
      const tot = Number(e.totalInstallments||0);
      if(!tot || tot<=1) continue; // não é parcelado
      const key = `${String(e.description||'')}::${tot}::${String(e.cardId||'')}`;
      if(!map.has(key)) map.set(key, []);
      map.get(key).push(e);
    }
    for(const [key, arr] of map.entries()){
      // verificar se temos um conjunto completo 1..N
      const parts = key.split('::');
      const tot = Number(parts[1]||0);
      if(arr.length < tot) continue;
      const hasAll = new Set(arr.map(x=>Number(x.installment||0))).size === tot && arr.some(x=>x.installment===1);
      if(!hasAll) continue;
      // gerar parcelGroup para este conjunto e aplicar somente em itens sem parcelGroup
      const groupId = 'mig::'+Date.now().toString(36)+'::'+Math.floor(Math.random()*10000);
      for(const it of arr){
        if(!it.parcelGroup){
          it.parcelGroup = groupId;
          await put('expenses', it);
        }
      }
    }
  }catch(err){ console.warn('migração parcelGroup falhou', err); }
}

// Navegação e render
// Pré-carrega os templates presentes em index.html (templates <template id="...">)
const templates = {};
['dashboard','movimentos','movimentos-mes','cartoes','receitas','contas'].forEach(id=>{
  templates[id] = document.getElementById(id+'-tpl').content;
});

/**
 * initUI - configura os eventos de navegação (sidebar) e elementos globais
 */
function initUI(){
  const buttons = document.querySelectorAll('.sidebar nav button');
  buttons.forEach(b=>b.addEventListener('click',()=>{
    // marca botão ativo e renderiza view correspondente
    buttons.forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    const view = b.dataset.view;
    renderView(view);
    // fecha a sidebar no mobile após navegar
    const sb = document.querySelector('.sidebar'); if(sb && sb.classList.contains('show')) sb.classList.remove('show');
  }));

  // valor inicial do filtro de mês (header)
  const monthInput = document.getElementById('filter-month');
  if(monthInput) monthInput.value = dayjs().format('YYYY-MM');

  // botão de menu para mobile (abre/fecha sidebar)
  const menuBtn = document.getElementById('menu-btn');
  if(menuBtn){ menuBtn.addEventListener('click', ()=>{ const sb = document.querySelector('.sidebar'); if(sb) sb.classList.toggle('show'); }); }
}

async function renderView(view){
  const content = document.getElementById('content');
  content.innerHTML = '';
  const node = document.importNode(templates[view], true);
  content.appendChild(node);
  document.getElementById('main-title').textContent = view.charAt(0).toUpperCase()+view.slice(1);

  // init view specific
  if(view==='dashboard') renderDashboard();
  if(view==='movimentos') initMovimentos();
  if(view==='movimentos-mes') initMovimentosMes();
  if(view==='cartoes') initCartoes();
  if(view==='receitas') initReceitas();
  if(view==='contas') initContas();
  // faturas/export views removed
}

// Dashboard
async function renderDashboard(){
  let incomes = await getAll('incomes');
  let expenses = await getAll('expenses');
  // aplicar filtros (categoria / loja) se presentes
  const fCat = document.getElementById('filter-category')?.value || '';
  const fShop = (document.getElementById('filter-shop')?.value || '').toLowerCase();
  if(fCat){
    incomes = incomes.filter(i=> (i.category||'') === fCat);
    expenses = expenses.filter(e=> (e.category||'') === fCat);
  }
  if(fShop){
    incomes = incomes.filter(i=> (i.shop||'').toLowerCase().includes(fShop));
    expenses = expenses.filter(e=> (e.shop||'').toLowerCase().includes(fShop));
  }
  const sumIn = incomes.reduce((s,i)=>s+Number(i.value||0),0);
  const sumEx = expenses.reduce((s,i)=>s+Number(i.value||0),0);
  document.getElementById('sum-incomes').textContent = formatBR(sumIn);
  document.getElementById('sum-expenses').textContent = formatBR(sumEx);
  document.getElementById('sum-balance').textContent = formatBR(sumIn-sumEx);
  const latest = expenses.concat(incomes).sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,8);
  const el = document.getElementById('latest-movements');
  el.innerHTML = '';
  for(const it of latest){
    const div = document.createElement('div'); div.className='list-item';
    const left = document.createElement('div');
    const right = document.createElement('div'); right.style.display='flex'; right.style.alignItems='center'; right.style.gap='8px';
    left.innerHTML = `<div>${it.description||it.desc||''}</div>`;
    // detalhe pequeno: data, cartão/método e parcelas se houver
    let detail = '';
    if(it.date) detail += dayjs(it.date).format('DD/MM/YYYY');
  if(it.cardId){ const c = await getByKey('cards', it.cardId); detail += ` • ${c?c.name:'Cartão'}`; }
  if(it.shop) detail += ` • ${it.shop}`;
    if(it.installment) detail += ` • ${it.installment}/${it.totalInstallments}`;
    left.innerHTML += `<div class='small'>${detail}</div>`;
    right.textContent = formatBR(it.value);
    div.appendChild(left); div.appendChild(right); el.appendChild(div);
  }

  // Mostrar saldo restante por cartão (exibe Limite / Usado (ciclo) / Usado (total) / Restante)
  const cardsBalEl = document.getElementById('cards-balance');
  if(cardsBalEl){
    const cards = await getAll('cards');
    // agrupa despesas por cartão para evitar queries repetidas
    const allExpenses = expenses; // já temos as despesas carregadas
    const currentCycle = document.getElementById('filter-month')?.value || dayjs().format('YYYY-MM');
    cardsBalEl.innerHTML = '';
    cards.forEach(c=>{
      const usedTotal = allExpenses.filter(e=>e.cardId===c.id).reduce((s,x)=>s+Number(x.value||0),0);
      const usedCycle = allExpenses.filter(e=>e.cardId===c.id && e.invoiceMonth===currentCycle).reduce((s,x)=>s+Number(x.value||0),0);
      const limit = Number(c.limit||0);
      const remainingTotal = limit - usedTotal;
      const remainingCycle = limit - usedCycle;
      const cardDiv = document.createElement('div'); cardDiv.className='card';
      cardDiv.style.borderLeft = `6px solid ${c.color||'#ccc'}`;
      cardDiv.innerHTML = `<div><strong>${c.name}</strong></div>
        <div class='card-meta'>
          <div>Limite: ${formatBR(limit)}</div>
        </div>`;
      cardsBalEl.appendChild(cardDiv);
    });
  }
}

// Movimentos
async function initMovimentos(){
  const form = document.getElementById('form-movimento');
  const cardSelect = document.getElementById('mov-card');
  const movIdInput = document.getElementById('mov-id');
  const movStoreInput = document.getElementById('mov-store');
  const cancelMovBtn = document.getElementById('cancel-mov-edit');
  const movShopInput = document.getElementById('mov-shop');
  await refreshCardOptions(cardSelect);
  // aplicar formatação de moeda ao campo Valor
  attachCurrencyField('mov-value');
  // evita anexar múltiplos listeners se initMovimentos for chamado novamente
  form.onsubmit = async (e)=>{
    e.preventDefault();
    const type = document.getElementById('mov-type').value;
    const desc = document.getElementById('mov-desc').value;
    const date = document.getElementById('mov-date').value;
    const value = parseCurrencyBR(document.getElementById('mov-value').value);
    const category = document.getElementById('mov-category').value;
  const shop = movShopInput? movShopInput.value : '';
  const cardId = document.getElementById('mov-card').value || null;
  const method = document.getElementById('mov-method')? document.getElementById('mov-method').value : '';
    const parcels = Number(document.getElementById('mov-parcels').value)||1;

    // se estamos editando um movimento existente
    if(movIdInput && movIdInput.value && movStoreInput && movStoreInput.value){
      const store = movStoreInput.value;
      const rawId = movIdInput.value;
      if(store==='incomes'){
        const id = Number(rawId);
        await put('incomes',{id,description:desc,date,value});
        showToast('Receita atualizada');
      }else if(store==='expenses'){
        // editar apenas esta despesa
        const id = Number(rawId);
        const existing = await getByKey('expenses', id);
        const updated = Object.assign({}, existing, {description:desc,date,value,category,shop: movShopInput? movShopInput.value : existing.shop, cardId: cardId? Number(cardId): null, method: method||existing.method});
        await put('expenses', updated);
        showToast('Despesa atualizada');
      }else if(store==='expenses-group' || store==='expenses-group-fallback'){
        // editar todas as parcelas do grupo
        let items = [];
        if(store==='expenses-group'){
          const groupId = rawId;
          items = await where('expenses', e=>e.parcelGroup===groupId);
        }else{
          // fallback: marker MATCH::desc::total::cardId
          const parts = rawId.split('::');
          const descMatch = parts[1] || '';
          const tot = Number(parts[2]) || 0;
          const cardMatch = parts[3] || '';
          items = await where('expenses', e=>e.description===descMatch && Number(e.totalInstallments||0)===tot && (cardMatch==='' || String(e.cardId||'')===cardMatch));
        }
        // interpretar o campo Valor como VALOR_TOTAL e redistribuir entre parcelas
        const totalNew = parseCurrencyBR(document.getElementById('mov-value').value);
        const installments = items[0]? Number(items[0].totalInstallments||1) : 1;
        // distribuir em centavos para garantir que a soma das parcelas === totalNew (evita erros de arredondamento)
        const totalCents = Math.round(totalNew * 100);
        const base = Math.floor(totalCents / installments);
        let remainder = totalCents - base * installments; // número de parcelas que receberão +1 cent
        // ordenar parcelas por número da parcela (se disponível) para aplicar distribuição previsível
        items.sort((a,b)=> (Number(a.installment)||0) - (Number(b.installment)||0));
        for(let idx=0; idx<items.length; idx++){
          const it = items[idx];
          const cents = base + (remainder>0? 1 : 0);
          if(remainder>0) remainder--;
          const val = cents / 100;
          const updated = Object.assign({}, it, {description:desc,date:it.date,value:val,category,shop: movShopInput? movShopInput.value : it.shop, cardId: cardId? Number(cardId): it.cardId, method: method||it.method});
          await put('expenses', updated);
        }
        showToast('Parcelas atualizadas');
      }
      // limpar estado de edição
      movIdInput.value = ''; movStoreInput.value = '';
      if(cancelMovBtn) cancelMovBtn.style.display = 'none';
      await renderView('movimentos');
      return;
    }

    if(type==='income'){
      await add('incomes',{description:desc,date,value});
    }else{
      // despesa: verifica se foi especificado um cartão
      const card = cardId? await getByKey('cards', Number(cardId)) : null;
      if(card){
        // avisar caso o total ultrapasse o restante do limite (somente aviso)
        try{
          const allExp = await getAll('expenses');
          const usedTotal = allExp.filter(e=>e.cardId===card.id).reduce((s,x)=>s+Number(x.value||0),0);
          const remainingTotal = Number(card.limit||0) - usedTotal;
          if(value > remainingTotal){
            showToast('Aviso: este lançamento ultrapassa o restante do limite do cartão');
          }
        }catch(err){/* silent */}
        // para cada parcela, criar um lançamento mensal e vincular invoiceMonth
        const parcelGroup = Date.now().toString();
        for(let i=0;i<parcels;i++){
          const dt = dayjs(date).add(i,'month').format('YYYY-MM-DD');
          const invMonth = computeInvoiceMonth(card, dt);
          const locked = await isInvoiceLocked(card.id, invMonth);
          if(locked){
            showToast('Não é possível lançar numa fatura já baixada: '+invMonth);
            continue;
          }
            await add('expenses',{description:desc,date:dt,value:(value/parcels),cardId:card.id,installment:i+1,totalInstallments:parcels,invoiceMonth:invMonth,parcelGroup:parcelGroup,category,shop,method});
        }
      }else{
          await add('expenses',{description:desc,date,value,category,shop,method});
      }
    }
    form.reset();
    await renderView('movimentos');
    showToast('Movimento salvo');
  };

  // cancelar edição de movimento
  if(cancelMovBtn) cancelMovBtn.onclick = ()=>{ form.reset(); if(movIdInput) movIdInput.value=''; if(movStoreInput) movStoreInput.value=''; cancelMovBtn.style.display='none'; };

  // filtros removidos da UI nesta view — render apenas a lista (os elementos são opcionais e tratados de forma segura)

  await renderMovementsList();
}

async function renderMovementsList(){
  const list = document.getElementById('list-movements');
  const incomes = await getAll('incomes');
  const expenses = await getAll('expenses');
  const fixeds = await getAll('fixed');
  // aplicar filtros (categoria, loja, cartão, faixa de valor, intervalo de datas)
  const fCat = document.getElementById('filter-category')?.value || '';
  const fShop = (document.getElementById('filter-shop')?.value || '').toLowerCase();
  const fCard = document.getElementById('filter-card')?.value || '';
  const movDate = document.getElementById('mov-filter-date')?.value || '';
  const minRaw = (document.getElementById('filter-min')?.value || '').trim();
  const maxRaw = (document.getElementById('filter-max')?.value || '').trim();
  const min = minRaw? parseCurrencyBR(minRaw) : null;
  const max = maxRaw? parseCurrencyBR(maxRaw) : null;
  const dateFrom = document.getElementById('filter-date-from')?.value || '';
  const dateTo = document.getElementById('filter-date-to')?.value || '';
  function applyFilters(arr, isExpense){
    return arr.filter(it=>{
      if(fCat && (it.category||'') !== fCat) return false;
      if(fShop && !((it.shop||'').toLowerCase().includes(fShop))) return false;
  // filtro por data (se fornecida) — compara igualdade no dia
  if(movDate){ if(!it.date) return false; if(!dayjs(it.date).isSame(dayjs(movDate),'day')) return false; }
      if(min !== null && Number(it.value||0) < min) return false;
      if(max !== null && Number(it.value||0) > max) return false;
      if(dateFrom && dayjs(it.date).isBefore(dayjs(dateFrom),'day')) return false;
      if(dateTo && dayjs(it.date).isAfter(dayjs(dateTo),'day')) return false;
      if(isExpense && fCard && String(it.cardId||'') !== fCard) return false;
      return true;
    });
  }
  // gerar ocorrências de contas fixas dentro do intervalo de datas (ou mês atual se sem filtro)
  const fixedOccurrences = [];
  // determinar intervalo considerado
  let from = dateFrom? dayjs(dateFrom).startOf('day') : null;
  let to = dateTo? dayjs(dateTo).endOf('day') : null;
  if(!from && !to){ // sem filtros de data: mostrar ocorrências do mês atual
    const now = dayjs(); from = now.startOf('month'); to = now.endOf('month');
  }
  if(from && to){
    // iterar meses entre from e to inclusive
    let cursor = from.startOf('month');
    const endMonth = to.endOf('month');
    while(cursor.isBefore(endMonth) || cursor.isSame(endMonth)){
      const year = cursor.year(); const month = cursor.month()+1; // month 1..12
      for(const f of fixeds){
        // construir data com dia f.day (ajustar se dia > dias do mês)
        const dayInMonth = Math.min(Number(f.day||1), cursor.daysInMonth());
        const dateStr = dayjs(`${year}-${String(month).padStart(2,'0')}-${String(dayInMonth).padStart(2,'0')}`).format('YYYY-MM-DD');
  fixedOccurrences.push(Object.assign({}, {id: 'fixed-occ-'+f.id+'-'+dateStr, description: f.description, date: dateStr, value: Number(f.value||0), fixedId: f.id, category: f.category||'', shop: f.shop||'', method: f.method||''}));
      }
      cursor = cursor.add(1,'month');
    }
  }

  const incomesFiltered = applyFilters(incomes, false);
  const expensesFiltered = applyFilters(expenses, true);
  // aplicar filtros também sobre as ocorrências fixas
  const fixedFiltered = applyFilters(fixedOccurrences, true);

  // juntar todos os tipos em um único array com tag para permitir ordenação e agrupamento por mês
  const incomesTagged = incomesFiltered.map(i=> Object.assign({}, i, {__type:'income'}));
  const expensesTagged = expensesFiltered.map(e=> Object.assign({}, e, {__type:'expense'}));
  const fixedTagged = fixedFiltered.map(f=> Object.assign({}, f, {__type:'fixed'}));
  const all = incomesTagged.concat(expensesTagged, fixedTagged).sort((a,b)=> new Date(b.date) - new Date(a.date));

  list.innerHTML = '';
  let currentMonth = '';
  for(const it of all){
    const monthKey = dayjs(it.date).format('YYYY-MM');
    if(monthKey !== currentMonth){
      currentMonth = monthKey;
      const dMonth = dayjs(it.date);
      const monthNamesPt = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
      const mh = document.createElement('h4'); mh.textContent = `${monthNamesPt[dMonth.month()]} ${dMonth.year()}`;
      list.appendChild(mh);
    }
    // renderizar item conforme seu tipo
    if(it.__type === 'income'){
      const d = document.createElement('div'); d.className='list-item';
      const left = document.createElement('div');
      left.innerHTML = `<div>${it.description}</div><div class='small'>${dayjs(it.date).format('DD/MM/YYYY')}</div>`;
      const right = document.createElement('div'); right.style.display='flex'; right.style.gap='8px'; right.style.alignItems='center';
      const val = document.createElement('div'); val.textContent = formatBR(it.value);
      const editBtn = document.createElement('button'); editBtn.className='icon-btn'; editBtn.setAttribute('aria-label','Editar receita');
      editBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" fill="currentColor"/><path d="M20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/></svg>`;
      editBtn.onclick = ()=>{
        document.getElementById('mov-type').value = 'income';
        document.getElementById('mov-desc').value = it.description;
        document.getElementById('mov-date').value = it.date;
        document.getElementById('mov-value').value = formatCurrencyBR(it.value);
        const mid = document.getElementById('mov-id'); if(mid) mid.value = it.id;
        const mstore = document.getElementById('mov-store'); if(mstore) mstore.value = 'incomes';
        const cancelBtn = document.getElementById('cancel-mov-edit'); if(cancelBtn) cancelBtn.style.display = 'inline-block';
        document.getElementById('mov-desc').scrollIntoView({behavior:'smooth',block:'center'});
      };
      const delBtn = document.createElement('button'); delBtn.className='icon-btn danger'; delBtn.setAttribute('aria-label','Remover receita');
      delBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12z" fill="currentColor"/><path d="M19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/></svg>`;
      delBtn.onclick = async ()=>{ if(!window.confirm('Excluir esta receita?')) return; await del('incomes', it.id); showToast('Receita removida'); await renderMovementsList(); };
      right.appendChild(val); right.appendChild(editBtn); right.appendChild(delBtn);
      d.appendChild(left); d.appendChild(right); list.appendChild(d);
    }else if(it.__type === 'fixed'){
      const d = document.createElement('div'); d.className='list-item';
      const left = document.createElement('div');
      const metaParts = [];
      if(it.method) metaParts.push(it.method);
      if(it.shop) metaParts.push(it.shop);
      const meta = metaParts.length? ' • ' + metaParts.join(' • ') : '';
      left.innerHTML = `<div><span class="badge">Conta fixa</span> ${it.description} <div class='small'>${dayjs(it.date).format('DD/MM/YYYY')}${meta}</div></div>`;
      const right = document.createElement('div'); right.style.display='flex'; right.style.gap='8px'; right.style.alignItems='center';
      const val = document.createElement('div'); val.textContent = formatBR(it.value);
      const editBtn = document.createElement('button'); editBtn.className='icon-btn'; editBtn.setAttribute('aria-label','Editar conta fixa'); editBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" fill="currentColor"/><path d="M20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/></svg>`;
      editBtn.onclick = async ()=>{
        const original = await getByKey('fixed', Number(String(it.fixedId))); if(!original) return; await renderView('contas'); setTimeout(()=>{ document.getElementById('fixed-id').value = original.id; document.getElementById('fixed-desc').value = original.description; document.getElementById('fixed-value').value = formatCurrencyBR(original.value); document.getElementById('fixed-day').value = original.day; const cancel = document.getElementById('cancel-fixed-edit'); if(cancel) cancel.style.display='inline-block'; },120);
      };
      const delBtn = document.createElement('button'); delBtn.className='icon-btn danger'; delBtn.setAttribute('aria-label','Remover conta fixa'); delBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12z" fill="currentColor"/><path d="M19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/></svg>`;
      delBtn.onclick = async ()=>{ if(!window.confirm('Excluir esta conta fixa (todas as ocorrências mensais)?')) return; await del('fixed', Number(String(it.fixedId))); showToast('Conta fixa removida'); await renderMovementsList(); };
      right.appendChild(val); right.appendChild(editBtn); right.appendChild(delBtn);
      d.appendChild(left); d.appendChild(right); list.appendChild(d);
    }else{
      // expense
      const ex = it;
      const d = document.createElement('div'); d.className='list-item';
      const left = document.createElement('div');
      const cardName = ex.cardId? ( (await getByKey('cards', ex.cardId))?.name || 'Cartão' ) : null;
      const methodLabel = ex.method || (cardName? cardName : (ex.category || '—'));
      left.innerHTML = `<div>${ex.description} <small class='small'>${ex.installment?ex.installment+'/'+ex.totalInstallments:''}</small></div><div class='small'>${dayjs(ex.date).format('DD/MM/YYYY')} • ${methodLabel}${ex.shop? ' • '+ex.shop : ''}</div>`;
      const right = document.createElement('div'); right.style.display='flex'; right.style.gap='8px'; right.style.alignItems='center';
      const val = document.createElement('div'); val.textContent = formatBR(ex.value);
      const editBtn = document.createElement('button'); editBtn.className='icon-btn'; editBtn.setAttribute('aria-label','Editar despesa');
      editBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" fill="currentColor"/><path d="M20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/></svg>`;
      editBtn.onclick = async ()=>{
        if(ex.totalInstallments && ex.totalInstallments>1){
          const all = window.confirm('Deseja editar todas as parcelas? OK = Todas / Cancel = Apenas esta');
          if(all){
            const group = ex.parcelGroup;
            if(group){ const mid = document.getElementById('mov-id'); if(mid) mid.value = group; const mstore = document.getElementById('mov-store'); if(mstore) mstore.value = 'expenses-group'; }
            else{ const marker = `MATCH::${ex.description}::${ex.totalInstallments}::${ex.cardId||''}`; const mid = document.getElementById('mov-id'); if(mid) mid.value = marker; const mstore = document.getElementById('mov-store'); if(mstore) mstore.value = 'expenses-group-fallback'; }
          }else{ const mid = document.getElementById('mov-id'); if(mid) mid.value = ex.id; const mstore = document.getElementById('mov-store'); if(mstore) mstore.value = 'expenses'; }
        }else{ const mid = document.getElementById('mov-id'); if(mid) mid.value = ex.id; const mstore = document.getElementById('mov-store'); if(mstore) mstore.value = 'expenses'; }
        document.getElementById('mov-type').value = 'expense';
        document.getElementById('mov-desc').value = ex.description;
        document.getElementById('mov-date').value = ex.date;
        const mstoreVal = document.getElementById('mov-store')?.value;
        if(mstoreVal && (mstoreVal==='expenses-group' || mstoreVal==='expenses-group-fallback')){
          let items = [];
          if(mstoreVal==='expenses-group'){ const groupId = document.getElementById('mov-id').value; items = await where('expenses', e=>e.parcelGroup===groupId); }
          else{ const raw = document.getElementById('mov-id').value || ''; const parts = raw.split('::'); const descMatch = parts[1] || ''; const tot = Number(parts[2]) || 0; const cardMatch = parts[3] || ''; items = await where('expenses', e=>e.description===descMatch && Number(e.totalInstallments||0)===tot && (cardMatch==='' || String(e.cardId||'')===cardMatch)); }
          const total = items.reduce((s,x)=>s+Number(x.value||0),0);
          document.getElementById('mov-value').value = formatCurrencyBR(total);
          document.getElementById('mov-parcels').value = items[0]? items[0].totalInstallments || 1 : (ex.totalInstallments||1);
        }else{ document.getElementById('mov-value').value = formatCurrencyBR(ex.value); document.getElementById('mov-parcels').value = ex.totalInstallments || 1; }
        document.getElementById('mov-card').value = ex.cardId || '';
        const mshop = document.getElementById('mov-shop'); if(mshop) mshop.value = ex.shop || '';
        const cancelBtn = document.getElementById('cancel-mov-edit'); if(cancelBtn) cancelBtn.style.display = 'inline-block';
        document.getElementById('mov-desc').scrollIntoView({behavior:'smooth',block:'center'});
      };
      const delBtn = document.createElement('button'); delBtn.className='icon-btn danger'; delBtn.setAttribute('aria-label','Remover despesa');
      delBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12z" fill="currentColor"/><path d="M19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/></svg>`;
      delBtn.onclick = async ()=>{ if(!window.confirm('Excluir esta despesa?')) return; await del('expenses', ex.id); showToast('Despesa removida'); await renderMovementsList(); };
      right.appendChild(val); right.appendChild(editBtn); right.appendChild(delBtn);
      d.appendChild(left); d.appendChild(right); list.appendChild(d);
    }
  }
}

// Cartões
async function initCartoes(){
  // elementos do formulário de cartão (inclui input hidden `card-id` para edição)
  const form = document.getElementById('form-card');
  const cardIdInput = document.getElementById('card-id');
  const cancelBtn = document.getElementById('cancel-edit');
  const limitInput = document.getElementById('card-limit');

  // submit do formulário: cria ou atualiza dependendo se card-id estiver preenchido
  // usa onsubmit para evitar múltiplos listeners caso a função seja chamada novamente
  // também armazena o limite do cartão (em número) no registro
  attachCurrencyField('card-limit');
  form.onsubmit = async (e)=>{
    e.preventDefault();
    const id = cardIdInput.value ? Number(cardIdInput.value) : null;
    const name = document.getElementById('card-name').value;
    const color = document.getElementById('card-color').value;
    const type = document.getElementById('card-type')? document.getElementById('card-type').value : 'credito';
    const open = Number(document.getElementById('card-open').value);
    const close = Number(document.getElementById('card-close').value);
    const limit = parseCurrencyBR(document.getElementById('card-limit').value) || 0;

    if(id){
      // atualiza cartão existente
      await put('cards',{id,name,color,open,close,limit,type});
      showToast('Cartão atualizado');
    }else{
      // cria novo cartão
      await add('cards',{name,color,open,close,limit,type});
      showToast('Cartão salvo');
    }

    // reset form e lista
    form.reset(); cardIdInput.value = '';
    cancelBtn.style.display = 'none';
    await initCartoes();
  };

  // cancelar edição: limpa o form
  // evita múltiplos handlers em chamadas repetidas
  cancelBtn.onclick = ()=>{ form.reset(); cardIdInput.value=''; cancelBtn.style.display='none'; };

  // renderiza a lista de cartões com ação de editar
  const cards = await getAll('cards');
  const list = document.getElementById('cards-list'); list.innerHTML='';
  const allExpenses = await getAll('expenses');
  const currentCycle = document.getElementById('filter-month')?.value || dayjs().format('YYYY-MM');
  // botão salvar referência para atualizar cor conforme seleção
  const saveBtn = document.getElementById('save-card');
  const colorInput = document.getElementById('card-color');
  // helper: calcula se cor é escura para ajustar cor do texto
  function isColorDark(hex){
    if(!hex) return false;
    const h = hex.replace('#','');
    const r = parseInt(h.substring(0,2),16);
    const g = parseInt(h.substring(2,4),16);
    const b = parseInt(h.substring(4,6),16);
    // luminance perceptual
    const lum = 0.2126*r + 0.7152*g + 0.0722*b;
    return lum < 140; // threshold
  }
  function updateSaveBtnColor(c){
    if(!saveBtn) return;
    // reset to default (let CSS control the default appearance)
    saveBtn.style.background = '';
    saveBtn.style.color = '';
  }
  // ao mudar cor no input, atualizar o próprio input (servirá de preview)
  if(colorInput){
    // usa oninput para prevenir múltiplos listeners caso initCartoes seja executado novamente
    colorInput.oninput = (ev)=>{
      ev.target.style.background = ev.target.value;
      ev.target.style.borderColor = isColorDark(ev.target.value)?'rgba(255,255,255,0.2)':'#d1d5db';
    };
    // inicializa visual do color input
    if(colorInput.value){ colorInput.style.background = colorInput.value; colorInput.style.borderColor = isColorDark(colorInput.value)?'rgba(255,255,255,0.2)':'#d1d5db'; }
  }
  cards.forEach(c=>{
    const el = document.createElement('div'); el.className='list-item';
    // estrutura: nome + datas, cor do cartão, botões de ação
  const limit = Number(c.limit||0);
  el.innerHTML = `<div><strong>${c.name}</strong><div class='small'>fechamento: ${c.close} • vencimento: ${c.open}</div><div class='card-meta'>Limite: ${formatBR(limit)}</div></div><div style="display:flex;gap:8px;align-items:center"><div style='width:28px;height:28px;background:${c.color};border-radius:6px'></div></div>`;
    // botão de editar (ícone)
    const editBtn = document.createElement('button'); editBtn.className='icon-btn'; editBtn.setAttribute('aria-label','Editar cartão');
    editBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" fill="currentColor"/><path d="M20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/></svg>`;
    editBtn.addEventListener('click', ()=>{
      // preenche form com os dados do cartão para edição
      document.getElementById('card-name').value = c.name;
  const ci = document.getElementById('card-color');
  ci.value = c.color || '#6ea8fe';
  const li = document.getElementById('card-limit');
  if(li) li.value = c.limit? formatCurrencyBR(c.limit) : '';
  // atualiza visual do próprio input color (serve como preview)
  ci.style.background = ci.value;
  ci.style.borderColor = isColorDark(ci.value)?'rgba(255,255,255,0.2)':'#d1d5db';
      document.getElementById('card-open').value = c.open;
      document.getElementById('card-close').value = c.close;
      cardIdInput.value = c.id;
      cancelBtn.style.display = 'inline-block';
      // rolar para o form (útil em mobile)
      document.getElementById('card-name').scrollIntoView({behavior:'smooth',block:'center'});
    });
    el.querySelector('div:last-child').appendChild(editBtn);

    // botão de excluir (ícone)
    const delBtn = document.createElement('button'); delBtn.className='icon-btn danger'; delBtn.setAttribute('aria-label','Remover cartão');
    delBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12z" fill="currentColor"/><path d="M19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/></svg>`;
    delBtn.addEventListener('click', async ()=>{
      // antes de excluir, verificar se há movimentos vinculados
      const linked = await where('expenses', e=>e.cardId===c.id);
      let msg = '';
      if(linked.length>0) msg = `Este cartão possui ${linked.length} movimentos vinculados. Ao excluir o cartão, esses movimentos ficarão sem vínculo com cartão. Deseja continuar?`;
      else msg = 'Confirma exclusão deste cartão?';
  if(!window.confirm(msg)) return;
      try{
        await del('cards', c.id);
        showToast('Cartão removido');
        await initCartoes();
      }catch(err){
        console.error('Erro ao remover cartão',err); showToast('Erro ao remover cartão');
      }
    });
    el.querySelector('div:last-child').appendChild(delBtn);
    list.appendChild(el);
  });
}

// Receitas
async function initReceitas(){
  const form = document.getElementById('form-income');
  attachCurrencyField('income-value');
  // usa onsubmit para garantir apenas um handler ativo
  const incomeIdInput = document.getElementById('income-id');
  const cancelIncomeBtn = document.getElementById('cancel-income-edit');
  form.onsubmit = async (e)=>{
    e.preventDefault();
    const desc = document.getElementById('income-desc').value;
    const date = document.getElementById('income-date').value;
    const value = parseCurrencyBR(document.getElementById('income-value').value);
    if(incomeIdInput && incomeIdInput.value){
      const id = Number(incomeIdInput.value);
      await put('incomes',{id,description:desc,date,value});
      showToast('Receita atualizada');
      incomeIdInput.value = '';
      if(cancelIncomeBtn) cancelIncomeBtn.style.display = 'none';
      await initReceitas();
      return;
    }
    await add('incomes',{description:desc,date,value});
    form.reset();
    await initReceitas();
    showToast('Receita salva');
  };
  if(cancelIncomeBtn) cancelIncomeBtn.onclick = ()=>{ form.reset(); if(incomeIdInput) incomeIdInput.value=''; cancelIncomeBtn.style.display='none'; };
  const list = document.getElementById('incomes-list'); list.innerHTML='';
  const incomes = await getAll('incomes');
  incomes.sort((a,b)=>new Date(b.date)-new Date(a.date));
  for(const i of incomes){
    const d = document.createElement('div'); d.className='list-item';
    const left = document.createElement('div'); left.innerHTML = `<div>${i.description}</div><div class='small'>${dayjs(i.date).format('DD/MM/YYYY')}</div>`;
    const right = document.createElement('div'); right.style.display='flex'; right.style.gap='8px'; right.style.alignItems='center';
    const val = document.createElement('div'); val.textContent = formatBR(i.value);
    const editBtn = document.createElement('button'); editBtn.className='icon-btn'; editBtn.setAttribute('aria-label','Editar receita'); editBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" fill="currentColor"/><path d="M20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/></svg>`;
    editBtn.onclick = ()=>{
      document.getElementById('income-desc').value = i.description;
      document.getElementById('income-date').value = i.date;
      document.getElementById('income-value').value = formatCurrencyBR(i.value);
      if(incomeIdInput) incomeIdInput.value = i.id;
      if(cancelIncomeBtn) cancelIncomeBtn.style.display = 'inline-block';
      document.getElementById('income-desc').scrollIntoView({behavior:'smooth',block:'center'});
    };
    const delBtn = document.createElement('button'); delBtn.className='icon-btn danger'; delBtn.setAttribute('aria-label','Remover receita'); delBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12z" fill="currentColor"/><path d="M19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/></svg>`;
    delBtn.onclick = async ()=>{
      if(!window.confirm('Excluir esta receita?')) return;
      await del('incomes', i.id);
      showToast('Receita removida');
      await initReceitas();
    };
    right.appendChild(val); right.appendChild(editBtn); right.appendChild(delBtn);
    d.appendChild(left); d.appendChild(right);
    list.appendChild(d);
  }
}

// Contas Fixas
async function initContas(){
  const form = document.getElementById('form-fixed');
  attachCurrencyField('fixed-value');
  // usa onsubmit para evitar handlers duplicados em reinicializações
  form.onsubmit = async (e)=>{
    e.preventDefault();
  const idRaw = document.getElementById('fixed-id').value || '';
  const desc = document.getElementById('fixed-desc').value;
  const value = parseCurrencyBR(document.getElementById('fixed-value').value);
  const day = Number(document.getElementById('fixed-day').value);
  const category = document.getElementById('fixed-category')?.value || '';
  const shop = document.getElementById('fixed-shop')?.value || '';
  const method = document.getElementById('fixed-method')?.value || '';
    if(idRaw){
      const id = Number(idRaw);
      const existing = await getByKey('fixed', id);
      if(existing){
        const updated = Object.assign({}, existing, {description:desc,value,day,category,shop,method});
        await put('fixed', updated);
        showToast('Conta fixa atualizada');
      }
    }else{
      await add('fixed',{description:desc,value,day,category,shop,method});
      showToast('Conta fixa salva');
    }
    // reset form and re-render
    form.reset();
    document.getElementById('fixed-id').value = '';
    const cancel = document.getElementById('cancel-fixed-edit'); if(cancel) cancel.style.display='none';
    await initContas();
  };

  // cancelar edição
  const cancelFixed = document.getElementById('cancel-fixed-edit'); if(cancelFixed) cancelFixed.onclick = ()=>{ form.reset(); document.getElementById('fixed-id').value=''; cancelFixed.style.display='none'; };

  const list = document.getElementById('fixed-list'); list.innerHTML='';
  const fixeds = await getAll('fixed');
  fixeds.forEach(f=>{
    const d = document.createElement('div'); d.className='list-item';
    const left = document.createElement('div'); left.innerHTML = `<div>${f.description} <div class='small'>venc: ${f.day}</div></div>`;
    const right = document.createElement('div'); right.style.display='flex'; right.style.gap='8px'; right.style.alignItems='center';
    const val = document.createElement('div'); val.textContent = formatBR(f.value);
    const editBtn = document.createElement('button'); editBtn.className='icon-btn'; editBtn.setAttribute('aria-label','Editar conta fixa'); editBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" fill="currentColor"/><path d="M20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/></svg>`;
    editBtn.onclick = ()=>{
  document.getElementById('fixed-id').value = f.id;
  document.getElementById('fixed-desc').value = f.description;
  document.getElementById('fixed-value').value = formatCurrencyBR(f.value);
  document.getElementById('fixed-day').value = f.day;
  document.getElementById('fixed-category').value = f.category || '';
  if(document.getElementById('fixed-shop')) document.getElementById('fixed-shop').value = f.shop || '';
  document.getElementById('fixed-method').value = f.method || '';
      const cancel = document.getElementById('cancel-fixed-edit'); if(cancel) cancel.style.display='inline-block';
      document.getElementById('fixed-desc').scrollIntoView({behavior:'smooth',block:'center'});
    };
    const delBtn = document.createElement('button'); delBtn.className='icon-btn danger'; delBtn.setAttribute('aria-label','Remover conta fixa'); delBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12z" fill="currentColor"/><path d="M19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/></svg>`;
    delBtn.onclick = async ()=>{
      if(!window.confirm('Excluir esta conta fixa?')) return;
      await del('fixed', f.id);
      showToast('Conta fixa removida');
      await initContas();
    };
    right.appendChild(val); right.appendChild(editBtn); right.appendChild(delBtn);
    d.appendChild(left); d.appendChild(right);
    list.appendChild(d);
  });
}

// Faturas view removed from UI — related template and sidebar entry were removed.

// Movimentações do mês - subtabs: cartões / movimentações
async function initMovimentosMes(){
  const monthInput = document.getElementById('mm-month');
  const searchInput = document.getElementById('mm-search');
  const cardFilter = document.getElementById('mm-filter-card');
  const catFilter = document.getElementById('mm-filter-category');
  const minFilter = document.getElementById('mm-filter-min');
  const maxFilter = document.getElementById('mm-filter-max');
  const dateFrom = document.getElementById('mm-filter-date-from');
  const dateTo = document.getElementById('mm-filter-date-to');
  const clearFiltersBtn = document.getElementById('mm-clear-filters');
  const paneCards = document.getElementById('mm-cards-list');
  const paneMov = document.getElementById('mm-mov-list');
  const paginationEl = document.getElementById('mm-cards-pagination');
  // paginação: estado local
  let page = 1; const pageSize = 6; // ajustar conforme desejado
  // subtabs
  const subtabs = document.querySelectorAll('.subtabs button');
  subtabs.forEach(b=> b.addEventListener('click', ()=>{
    subtabs.forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    const s = b.dataset.sub;
    document.getElementById('mm-cartoes').style.display = s==='cartoes' ? '' : 'none';
    document.getElementById('mm-movimentacoes').style.display = s==='movimentacoes' ? '' : 'none';
  }));

  // inicializar valores
  monthInput.value = monthInput.value || (document.getElementById('filter-month')?.value || dayjs().format('YYYY-MM'));
  await refreshCardOptions(cardFilter);

  // eventos
  monthInput.onchange = renderAll;
  if(searchInput) searchInput.oninput = ()=>renderAll();
  cardFilter.onchange = renderAll;
  if(catFilter) catFilter.onchange = renderAll;
  if(minFilter) { attachCurrencyField('mm-filter-min'); minFilter.onblur = ()=>renderAll(); minFilter.oninput = ()=>{} }
  if(maxFilter) { attachCurrencyField('mm-filter-max'); maxFilter.onblur = ()=>renderAll(); maxFilter.oninput = ()=>{} }
  if(dateFrom) dateFrom.onchange = renderAll;
  if(dateTo) dateTo.onchange = renderAll;
  if(clearFiltersBtn) clearFiltersBtn.onclick = ()=>{ if(searchInput) searchInput.value=''; if(cardFilter) cardFilter.value=''; if(catFilter) catFilter.value=''; if(minFilter) minFilter.value=''; if(maxFilter) maxFilter.value=''; if(dateFrom) dateFrom.value=''; if(dateTo) dateTo.value=''; page=1; renderAll(); };

  // ouvir mudanças de dados globais (emitidos por db.js) para re-render automático
  const onDataChanged = ()=>{ renderAll(); };
  document.removeEventListener('data-changed', onDataChanged);
  document.addEventListener('data-changed', onDataChanged);

  await renderAll();

  async function renderAll(){
    await renderMmCartoes();
    await renderMmMovimentacoes();
  }

  async function renderMmCartoes(){
    const m = monthInput.value;
    paneCards.innerHTML = '';
    const cards = await getAll('cards');
  const q = (searchInput?.value||'').toLowerCase();
    // aplicar filtros sobre os cartões
    const filtered = [];
    for(const c of cards){
      const items = await where('expenses', e=>e.cardId===c.id && e.invoiceMonth===m);
      // aplicar pesquisa simples
      if(q){
        const match = c.name.toLowerCase().includes(q) || items.some(it=> (it.description||'').toLowerCase().includes(q) || (it.shop||'').toLowerCase().includes(q));
        if(!match) continue;
      }
      // filtro por cartão selecionado
      const fcard = cardFilter.value || '';
      if(fcard && String(c.id)!==fcard) continue;
      // filtro por categoria
      const fcat = catFilter?.value || '';
      if(fcat){ const hasCat = items.some(it=> (it.category||'')===fcat); if(!hasCat) continue; }
      // filtro por valor min/max
      const min = minFilter?.value? parseCurrencyBR(minFilter.value) : null;
      const max = maxFilter?.value? parseCurrencyBR(maxFilter.value) : null;
      if(min!==null){ const sum = items.reduce((s,x)=>s+Number(x.value||0),0); if(sum < min) continue; }
      if(max!==null){ const sum = items.reduce((s,x)=>s+Number(x.value||0),0); if(sum > max) continue; }
      // filtro por data intervalo (considera as datas dos lançamentos)
      const df = dateFrom?.value || '';
      const dt = dateTo?.value || '';
      if(df || dt){
        const ok = items.some(it=>{ const dd = dayjs(it.date); if(df && dd.isBefore(dayjs(df),'day')) return false; if(dt && dd.isAfter(dayjs(dt),'day')) return false; return true; });
        if(!ok) continue;
      }
      filtered.push({card:c, items});
    }
    // paginação simples
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if(page>totalPages) page = totalPages;
    const start = (page-1)*pageSize; const end = start+pageSize;
    const pageItems = filtered.slice(start,end);
    // renderizar página atual
    for(const entry of pageItems){
      const c = entry.card; const items = entry.items;
      const total = items.reduce((s,x)=>s+Number(x.value||0),0);
      // parcelamentos presentes (totalInstallments>1)
      const parcels = items.filter(x=>Number(x.totalInstallments||0)>1);
      const paid = await isInvoiceLocked(c.id, m);
      const el = document.createElement('div'); el.className='card'; el.style.borderLeft = `6px solid ${c.color||'#ccc'}`;
      el.innerHTML = `<div><strong>${c.name}</strong> <div class='small'>${items.length} lançamentos • Parcelas: ${parcels.length}</div></div><div>Total no mês: ${formatBR(total)}</div>`;
      // botão para marcar/desmarcar fatura (com confirmação)
      let paidNow = paid;
      const btn = document.createElement('button');
      btn.textContent = paidNow? 'Pago' : 'Marcar como paga';
      btn.className = paidNow? 'action-btn paid-btn' : 'action-btn unpaid-btn';
      btn.onclick = async ()=>{
        const ok = window.confirm(paidNow? 'Remover marcação de paga desta fatura?' : 'Marcar esta fatura como paga?');
        if(!ok) return;
        if(paidNow){
          const invs = await where('invoices', i=>i.cardId===c.id && i.month===m && i.paid===true);
          for(const inv of invs){ await del('invoices', inv.id); }
          showToast('Fatura marcada como não paga');
          paidNow = false; btn.textContent = 'Marcar como paga'; btn.className = 'action-btn unpaid-btn';
        }else{
          await add('invoices',{cardId:c.id,month:m,paid:true,paidAt:new Date().toISOString()});
          showToast('Fatura marcada como paga');
          paidNow = true; btn.textContent = 'Pago'; btn.className = 'action-btn paid-btn';
        }
        // rely on 'data-changed' event emitted by db.add/put/del to trigger other views if needed
      };
      // botão para ver fatura: abre modal com todos os lançamentos do cartão/mês
  const viewBtn = document.createElement('button'); viewBtn.textContent = 'Ver fatura';
  viewBtn.className = 'action-btn view-btn';
      viewBtn.onclick = async ()=>{
        // abrir modal preenchendo com os lançamentos deste cartão no mês selecionado
        openInvoiceModal(c, m, items);
      };
  // agrupar botões de ação em um container para facilitar estilo (stacking)
  const actionsWrap = document.createElement('div'); actionsWrap.className = 'card-actions';
  actionsWrap.appendChild(btn); actionsWrap.appendChild(viewBtn);
  el.appendChild(actionsWrap);
      paneCards.appendChild(el);
    }
    // renderizar paginação
    if(paginationEl){
      paginationEl.innerHTML = '';
      const prev = document.createElement('button'); prev.textContent='Anterior'; prev.disabled = page<=1; prev.onclick = ()=>{ page = Math.max(1,page-1); renderMmCartoes(); };
      const next = document.createElement('button'); next.textContent='Próxima'; next.disabled = page>=totalPages; next.onclick = ()=>{ page = Math.min(totalPages,page+1); renderMmCartoes(); };
      const info = document.createElement('div'); info.className='page-info'; info.textContent = `Página ${page} de ${totalPages}`;
      paginationEl.appendChild(prev); paginationEl.appendChild(info); paginationEl.appendChild(next);
    }
    // também renderizar contas fixas (boletos) como entradas do mês
    try{
      const fixedsAll = await getAll('fixed');
      for(const f of fixedsAll){
        const cursor = dayjs(m+'-01');
        const dayOfMonth = Number(f.day || 1);
        const dayInMonth = Math.min(dayOfMonth, cursor.daysInMonth());
        const dateStr = cursor.date(dayInMonth).format('YYYY-MM-DD');
        const totalF = Number(f.value||0);
        const fel = document.createElement('div'); fel.className='card'; fel.style.borderLeft = `6px solid ${'#9fd6c8'}`;
        fel.innerHTML = `<div><strong>${f.description}</strong> <div class='small'>venc: ${f.day} • Conta fixa</div></div><div>Total no mês: ${formatBR(totalF)}</div>`;
        // determine current paid state
        const invsNow = await where('invoices', i=>i.fixedId===f.id && i.month===m && i.paid===true);
        let paidNow = invsNow.length>0;
  const btnF = document.createElement('button');
  btnF.textContent = paidNow? 'Pago' : 'Marcar como paga';
  btnF.className = paidNow? 'action-btn paid-btn' : 'action-btn unpaid-btn';
        btnF.onclick = async ()=>{
          const ok = window.confirm(paidNow? 'Remover marcação de paga desta conta fixa?' : 'Marcar esta conta fixa como paga?'); if(!ok) return;
          if(paidNow){
            const invs = await where('invoices', i=>i.fixedId===f.id && i.month===m && i.paid===true);
            for(const inv of invs) await del('invoices', inv.id);
            showToast('Conta fixa marcada como não paga');
            paidNow = false;
            btnF.textContent = 'Marcar como paga'; btnF.className = 'unpaid-btn';
          }else{
            await add('invoices',{fixedId:f.id,month:m,paid:true,paidAt:new Date().toISOString()});
            showToast('Conta fixa marcada como paga');
            paidNow = true;
            btnF.textContent = 'Pago'; btnF.className = 'paid-btn';
          }
          // rely on 'data-changed' event emitted by db.js to trigger other views
        };
  const viewBtnF = document.createElement('button'); viewBtnF.textContent = 'Ver fatura';
  viewBtnF.className = 'action-btn view-btn';
        viewBtnF.onclick = async ()=>{
          const item = {description: f.description, date: dateStr, value: f.value, method: f.method||'', shop: f.shop||''};
          openInvoiceModal({name: f.description, color:'#d1f0ea'}, m, [item], {fixedId: f.id});
        };
  const fActions = document.createElement('div'); fActions.className = 'card-actions';
  fActions.appendChild(btnF); fActions.appendChild(viewBtnF);
  fel.appendChild(fActions);
        paneCards.appendChild(fel);
      }
    }catch(err){ console.warn('erro ao renderizar contas fixas no mm-cartoes',err); }
  }

  async function renderMmMovimentacoes(){
    const m = monthInput.value;
    paneMov.innerHTML = '';
  const q = (searchInput?.value||'').toLowerCase();
    const cardSel = cardFilter.value || '';
    const incomes = (await getAll('incomes')).filter(i=> dayjs(i.date).format('YYYY-MM')===m);
      const expenses = (await getAll('expenses')).filter(e=> dayjs(e.date).format('YYYY-MM')===m);
      // incluir contas fixas como ocorrências neste mês
      const fixeds = await getAll('fixed');
      const fixedOccurrences = [];
      for(const f of fixeds){
        const dayOfMonth = Number(f.day || 1);
        const parts = m.split('-'); const yyyy = parts[0]; const mm = parts[1];
        const cursor = dayjs(`${yyyy}-${mm}-01`);
        const dayInMonth = Math.min(dayOfMonth, cursor.daysInMonth());
        const dateStr = cursor.date(dayInMonth).format('YYYY-MM-DD');
  fixedOccurrences.push({id: 'fixed-occ-'+f.id+'-'+m, description: f.description, date: dateStr, value: Number(f.value||0), fixedId: f.id, category: f.category||'', shop: f.shop||'', method: f.method||''});
      }
  const all = incomes.concat(expenses, fixedOccurrences).sort((a,b)=>new Date(b.date)-new Date(a.date));
    for(const it of all){
      if(q){
        const text = ((it.description||'')+' '+(it.shop||'')+' '+(it.category||'')).toLowerCase();
        if(!text.includes(q)) continue;
      }
      if(cardSel && String(it.cardId||'')!==cardSel) continue;
      const div = document.createElement('div'); div.className='list-item';
      const left = document.createElement('div');
      const type = it.totalInstallments? (it.installment? `${it.installment}/${it.totalInstallments}` : '') : '';
      const method = it.method || (it.cardId? ( (await getByKey('cards', it.cardId))?.name || 'Cartão' ) : (it.category||'—'));
      left.innerHTML = `<div>${it.description} <div class='small'>${dayjs(it.date).format('DD/MM/YYYY')} • ${method} ${type? '• '+type : ''}</div></div>`;
      const right = document.createElement('div'); right.textContent = formatBR(it.value||0);
      div.appendChild(left); div.appendChild(right); paneMov.appendChild(div);
    }
  }
}

async function isInvoiceLocked(cardId, month){
  const inv = await where('invoices', i=>i.cardId===cardId && i.month===month && i.paid===true);
  return inv.length>0;
}

// Export view removed from UI — template and sidebar entry were removed.

// util helpers
function formatBR(v){ return 'R$ '+Number(v||0).toFixed(2).replace('.',','); }

// toast helper
function showToast(msg, timeout=3000){
  const el = document.getElementById('toast'); if(!el) { alert(msg); return; }
  el.textContent = msg; el.style.display = 'block'; el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(()=>{ el.style.transition='opacity .25s'; el.style.opacity='0'; setTimeout(()=>el.style.display='none',250); }, timeout);
}

// ===== Currency helpers (BRL) =====
// formata número para string em BRL (ex: 1234.5 -> "R$ 1.234,50")
function formatCurrencyBR(n){
  if(isNaN(n)) n = 0;
  return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n);
}

// converte string formatada (ex: "R$ 1.234,56" ou "1234,56" ou "1234.56") em Number
function parseCurrencyBR(str){
  if(str===undefined || str===null) return 0;
  // remove tudo que não seja dígito, ponto ou vírgula
  let s = String(str).replace(/[^0-9,\.\-]/g,'');
  if(s==='') return 0;
  // remover pontos de milhar e transformar vírgula decimal em ponto
  s = s.replace(/\./g,'').replace(/,/g,'.');
  const v = parseFloat(s);
  return isNaN(v)?0:v;
}

// attach currency formatting: on focus keep plain numeric, on blur format to BRL
function attachCurrencyField(id){
  const el = document.getElementById(id); if(!el) return;
  el.addEventListener('focus', ()=>{
    const n = parseCurrencyBR(el.value);
    // mostra número sem o R$ para facilitar edição
    el.value = n? String(n).replace('.',',') : '';
  });
  el.addEventListener('blur', ()=>{
    const n = parseCurrencyBR(el.value);
    el.value = formatCurrencyBR(n);
  });
  // inicializa valor já formatado se houver algum valor pré-existente
  el.value = el.value? formatCurrencyBR(parseCurrencyBR(el.value)) : '';
}

async function refreshCardOptions(selectEl){
  if(!selectEl) return;
  const cards = await getAll('cards');
  selectEl.innerHTML = '<option value="">-- nenhum --</option>';
  cards.forEach(c=>{ const o = document.createElement('option'); o.value=c.id; o.textContent=c.name; selectEl.appendChild(o); });
}

// compute invoice month given card config (open,close) and transaction date (YYYY-MM-DD)
function computeInvoiceMonth(card, dateStr){
  const d = dayjs(dateStr);
  const day = d.date();
  const open = card.open; const close = card.close;
  // Caso simples: se open <= close, fatura cobre dias [open..close] incluídos no mês em que close ocorre
  if(open<=close){
    if(day>=open && day<=close) return d.format('YYYY-MM');
    // se dia > close => será da próxima fatura (mes seguinte)
    if(day>close) return d.add(1,'month').format('YYYY-MM');
    // se dia < open => pertence à fatura corrente (mês anterior close)
    return d.format('YYYY-MM');
  }else{
    // open > close (período atravessa mês) -> se dia>=open ou dia<=close pertence ao mês do d.format('YYYY-MM')
    if(day>=open || day<=close) return d.format('YYYY-MM');
    return d.subtract(1,'month').format('YYYY-MM');
  }
}

async function generateInvoicePDF(card, month, expenses){
  // usa jsPDF (umd)
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFillColor(card.color);
  doc.rect(0,0,210,20,'F');
  doc.setTextColor('#ffffff'); doc.setFontSize(14); doc.text(`${card.name} — ${month}`,10,14);
  doc.setTextColor('#000000'); doc.setFontSize(12);
  let y = 30;
  let total = 0;
  expenses.forEach(e=>{
    doc.text(`${dayjs(e.date).format('DD/MM/YYYY')} - ${e.description}`,10,y);
    doc.text(formatBR(e.value),150,y);
    y+=8; total+=Number(e.value||0);
    if(y>270){ doc.addPage(); y=20; }
  });
  doc.setFontSize(12); doc.text('Total: '+formatBR(total),10,y+8);
  doc.save(`${card.name}_${month}.pdf`);
}

function toCSVBundle(data){
  // cria CSV simples concatenando seções
  function arrToCSV(arr){
    if(!arr||arr.length===0) return '';
    const keys = Object.keys(arr[0]);
    const lines = [keys.join(',')];
    arr.forEach(o=>{ lines.push(keys.map(k=>`"${(o[k]||'').toString().replace(/"/g,'""')}"`).join(',')); });
    return lines.join('\n');
  }
  let out = '';
  out += "-- cards --\n"+arrToCSV(data.cards)+"\n\n";
  out += "-- incomes --\n"+arrToCSV(data.incomes)+"\n\n";
  out += "-- expenses --\n"+arrToCSV(data.expenses)+"\n\n";
  out += "-- fixed --\n"+arrToCSV(data.fixeds)+"\n\n";
  out += "-- invoices --\n"+arrToCSV(data.invoices)+"\n\n";
  return out;
}

function downloadFile(content, filename, type){
  const blob = new Blob([content],{type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=filename; a.click();
  URL.revokeObjectURL(url);
}

// --- Invoice modal helpers ---
let __invoiceModalLastFocused = null;
let __invoiceModalKeyHandler = null;

// openInvoiceModal: shows invoice modal for either a card or a fixed occurrence
// params:
//  entity: {name, color, id?}
//  month: 'YYYY-MM'
//  items: array of expense-like items
//  opts: optional { fixedId: number } - when present, mark/unmark uses fixedId instead of cardId
async function openInvoiceModal(entity, month, items, opts={}){
  const modal = document.getElementById('invoice-modal'); if(!modal) return;
  const title = modal.querySelector('#invoice-modal-title');
  const list = modal.querySelector('#invoice-modal-list');
  const totalEl = modal.querySelector('#invoice-modal-total');
  const markBtn = modal.querySelector('#invoice-mark-paid');
  const exportBtn = modal.querySelector('#invoice-export-pdf');

  title.textContent = `${entity.name} — ${month}`;
  list.innerHTML = '';
  items = items.slice().sort((a,b)=> new Date(a.date) - new Date(b.date) || (Number(a.installment||0) - Number(b.installment||0)));
  let total = 0;
  for(const it of items){
    const row = document.createElement('div'); row.className='list-item';
    const left = document.createElement('div');
    const instal = it.installment? `${it.installment}/${it.totalInstallments}` : '';
    left.innerHTML = `<div>${it.description || ''} <div class='small'>${dayjs(it.date).format('DD/MM/YYYY')} • ${it.method||''}${it.shop? ' • '+it.shop : ''}${instal? ' • '+instal : ''}</div></div>`;
    const right = document.createElement('div'); right.textContent = formatBR(it.value||0);
    row.appendChild(left); row.appendChild(right); list.appendChild(row);
    total += Number(it.value||0);
  }
  totalEl.textContent = `Total: ${formatBR(total)}`;

  // determine paid state: if opts.fixedId use that, else use entity.id as cardId
  let paid = false;
  if(opts.fixedId){ const inv = await where('invoices', i=>i.fixedId===opts.fixedId && i.month===month && i.paid===true); paid = inv.length>0; }
  else if(entity.id!==undefined && entity.id!==null){ const inv = await where('invoices', i=>i.cardId===entity.id && i.month===month && i.paid===true); paid = inv.length>0; }

  markBtn.textContent = paid? 'Marcar fatura como não paga' : 'Marcar fatura como paga';
  markBtn.disabled = false;

  markBtn.onclick = async ()=>{
    const ok = window.confirm(paid? 'Remover marcação de paga desta fatura?' : 'Marcar esta fatura como paga?'); if(!ok) return;
    if(paid){
      if(opts.fixedId){ const invs = await where('invoices', i=>i.fixedId===opts.fixedId && i.month===month && i.paid===true); for(const inv of invs) await del('invoices', inv.id); }
      else { const invs = await where('invoices', i=>i.cardId===entity.id && i.month===month && i.paid===true); for(const inv of invs) await del('invoices', inv.id); }
      showToast('Fatura marcada como não paga');
      // update UI immediately
      paid = false;
      markBtn.textContent = 'Marcar como paga';
      markBtn.classList.remove('paid-btn'); markBtn.classList.add('unpaid-btn');
    }else{
      if(opts.fixedId){ await add('invoices',{fixedId:opts.fixedId,month:month,paid:true,paidAt:new Date().toISOString()}); }
      else { await add('invoices',{cardId:entity.id,month:month,paid:true,paidAt:new Date().toISOString()}); }
      showToast('Fatura marcada como paga');
      paid = true;
      markBtn.textContent = 'Pago';
      markBtn.classList.remove('unpaid-btn'); markBtn.classList.add('paid-btn');
    }
  };

  exportBtn.onclick = async ()=>{ generateInvoicePDF(entity, month, items); };

  // show modal + accessibility
  modal.classList.add('show'); modal.setAttribute('aria-hidden','false');
  __invoiceModalLastFocused = document.activeElement;
  const focusable = Array.from(modal.querySelectorAll('a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(el=>el.offsetParent!==null);
  if(focusable.length) focusable[0].focus();
  __invoiceModalKeyHandler = (e)=>{
    if(e.key === 'Escape'){ e.preventDefault(); closeInvoiceModal(); return; }
    if(e.key === 'Tab'){
      if(focusable.length===0){ e.preventDefault(); return; }
      const first = focusable[0]; const last = focusable[focusable.length-1];
      if(e.shiftKey){ if(document.activeElement === first){ e.preventDefault(); last.focus(); } }
      else { if(document.activeElement === last){ e.preventDefault(); first.focus(); } }
    }
  };
  document.addEventListener('keydown', __invoiceModalKeyHandler);
}

function closeInvoiceModal(){
  const modal = document.getElementById('invoice-modal'); if(!modal) return;
  modal.classList.remove('show'); modal.setAttribute('aria-hidden','true');
  if(__invoiceModalKeyHandler) document.removeEventListener('keydown', __invoiceModalKeyHandler);
  try{ if(__invoiceModalLastFocused && __invoiceModalLastFocused.focus) __invoiceModalLastFocused.focus(); }catch(e){}
  __invoiceModalLastFocused = null; __invoiceModalKeyHandler = null;
}

// fechar modal ao clicar no X ou no backdrop
document.addEventListener('click', (e)=>{
  const act = e.target?.dataset?.action;
  if(act==='close') closeInvoiceModal();
  if(e.target && e.target.classList && e.target.classList.contains('modal-close')) closeInvoiceModal();
});

// Modal helper: mostra um modal com título, mensagem e botões (array de rótulos)
// retorna a string do botão clicado
// showModal removido: confirmações usam window.confirm
