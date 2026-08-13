'use strict';

let objectPortfolioMode='active';
Object.assign(iconPaths,{
  edit:'<path d="M4 20h4l11-11-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  archive:'<rect x="3" y="5" width="18" height="4" rx="1"/><path d="M5 9v10h14V9M10 13h4"/>',
  restore:'<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v6h6"/>',
  trash:'<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>'
});

function objectPortfolioRows(){
  return objectPortfolioMode==='archive'?(app.data.archivedBuildings||[]):(app.data.buildings||[]);
}

function objectPlural(n){
  const x=Math.abs(Number(n)||0)%100,y=x%10;
  if(x>10&&x<20)return 'объектов';
  if(y===1)return 'объект';
  if(y>=2&&y<=4)return 'объекта';
  return 'объектов';
}

function buildingCard(b){
  const open=app.data.issues.filter(i=>i.buildingId===b.id&&i.status!=='done').length;
  const ten=app.data.tenants.filter(t=>t.buildingId===b.id).length;
  const plan=(app.data.inspectionPlans||[]).find(p=>p.buildingId===b.id);
  const occ=b.area?Math.round(Number(b.occupied||0)/Number(b.area)*100):0;
  const free=Math.max(0,Number(b.area||0)-Number(b.occupied||0));
  const archived=!!b.archivedAt;
  const health=b.health||{score:100,status:b.status||'ok'};
  const statusText={ok:'Норма',attention:'Внимание',critical:'Критично'}[health.status]||'Норма';
  const ownerDelete=archived&&app.user.role==='owner';
  return `<article class="property-card ${archived?'archived':''}" data-building-card="${esc(b.id)}">
    <button class="property-card-main" type="button" data-building-open="${esc(b.id)}">
      <div class="property-card-head">
        <div class="property-symbol">${uiIcon('building')}</div>
        <div class="property-title"><div class="property-name">${esc(b.name)}</div><div class="property-address">${esc(b.address)}</div></div>
        <span class="property-status ${esc(health.status)}">${archived?'Архив':statusText}</span>
      </div>
      <div class="health-inline"><span>Здоровье объекта</span><b class="health-score ${esc(health.status)}">${health.score}/100</b></div>
      <div class="property-facts"><span><b>${num(b.area)}</b> м²</span><span><b>${ten}</b> арендаторов</span><span class="${open?'warn':''}"><b>${open}</b> проблем</span></div>
      <div class="occupancy-line"><div><span>Заполняемость</span><strong>${occ}%</strong></div><div class="progress"><i style="width:${Math.min(100,occ)}%"></i></div><small>Свободно ${num(free)} м²${plan&&!archived?' · осмотр '+fmtDate(plan.nextDue):''}</small></div>
    </button>
    <div class="property-card-actions property-crud-actions">
      <button class="link-btn" type="button" data-building-open="${esc(b.id)}">${uiIcon('folder')}<span>Открыть</span></button>
      ${canManageBuildings()&&!archived?`<button class="link-btn" type="button" data-building-edit="${esc(b.id)}">${uiIcon('edit')}<span>Изменить</span></button><button class="link-btn danger-text" type="button" data-building-archive="${esc(b.id)}">${uiIcon('archive')}<span>В архив</span></button>`:''}
      ${archived&&canManageBuildings()?`<button class="link-btn success-link" type="button" data-building-restore="${esc(b.id)}">${uiIcon('restore')}<span>Восстановить</span></button>`:''}
      ${ownerDelete?`<button class="link-btn danger-text" type="button" data-building-delete="${esc(b.id)}">${uiIcon('trash')}<span>Удалить</span></button>`:''}
    </div>
  </article>`;
}

function renderBuildings(v){
  const active=app.data.buildings||[],archived=app.data.archivedBuildings||[];
  const manageable=canManageBuildings();
  v.innerHTML=`<div class="subhead object-page-head"><div><div class="eyebrow">ПОРТФЕЛЬ НЕДВИЖИМОСТИ</div><h2>Объекты</h2><p>Добавляйте новые объекты, меняйте данные действующих и переносите старые в архив без потери истории.</p></div><div class="action-row">${hasPerm('inspections_create')?'<button class="btn btn-secondary" id="buildingInspection">'+uiIcon('calendar')+'<span>Осмотр</span></button>':''}${manageable?'<button class="btn btn-primary" id="newBuilding">'+uiIcon('plus')+'<span>Добавить объект</span></button>':''}</div></div>
    <div class="portfolio-summary"><div><span>Активные</span><strong>${active.length}</strong></div><div><span>В архиве</span><strong>${archived.length}</strong></div><div><span>Всего записей</span><strong>${active.length+archived.length}</strong></div></div>
    <div class="object-mode-tabs" role="tablist" aria-label="Состояние объектов"><button type="button" class="${objectPortfolioMode==='active'?'active':''}" data-object-mode="active">Активные <b>${active.length}</b></button>${manageable?`<button type="button" class="${objectPortfolioMode==='archive'?'active':''}" data-object-mode="archive">Архив <b>${archived.length}</b></button>`:''}</div>
    <div class="object-toolbar"><div class="search-box"><span class="search-icon">${uiIcon('search')}</span><input id="buildingSearch" placeholder="Найти объект по названию или адресу"></div><select id="buildingStatus"><option value="all">Все состояния</option><option value="ok">Норма</option><option value="attention">Требуют внимания</option><option value="critical">Критические</option></select><div class="toolbar-count"><b id="buildingCount">0</b><span id="buildingCountLabel">объектов</span></div></div>
    <div id="buildingGrid" class="property-grid"></div>
    ${objectPortfolioMode==='archive'?'<div class="archive-help">'+uiIcon('archive')+'<div><b>Архив не удаляет историю</b><span>Арендаторы, проблемы, осмотры, оборудование и расходы остаются связанными с объектом. Безвозвратное удаление доступно владельцу только для пустой карточки.</span></div></div>':''}`;
  const paint=()=>{
    const rows=objectPortfolioRows(),q=($('#buildingSearch')?.value||'').trim().toLowerCase(),st=$('#buildingStatus')?.value||'all';
    const filtered=rows.filter(b=>(objectPortfolioMode==='archive'||st==='all'||b.status===st)&&(!q||`${b.name} ${b.address}`.toLowerCase().includes(q)));
    $('#buildingGrid').innerHTML=filtered.map(buildingCard).join('')||`<div class="empty property-empty">${objectPortfolioMode==='archive'?'Архив пуст':'Объекты не найдены'}</div>`;
    $('#buildingCount').textContent=filtered.length;$('#buildingCountLabel').textContent=objectPlural(filtered.length);bindBuildingActions();
  };
  $$('[data-object-mode]').forEach(btn=>btn.onclick=()=>{objectPortfolioMode=btn.dataset.objectMode;renderBuildings(v);});
  $('#buildingSearch').oninput=paint;$('#buildingStatus').onchange=paint;
  $('#buildingInspection')?.addEventListener('click',()=>openInspectionForm());
  $('#newBuilding')?.addEventListener('click',()=>openBuildingForm());
  paint();
}
