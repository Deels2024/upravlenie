'use strict';

function v23LocalMonthKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}
function v23SetFormValue(formSelector,name,value){queueMicrotask(()=>{const form=$(formSelector),field=form?.querySelector(`[name="${name}"]`);if(field)field.value=String(value);});}

const v23RawDate=v23Date;
v23Date=function(value){if(value instanceof Date)return Number.isNaN(value.getTime())?null:new Date(value.getTime());return v23RawDate(value);};

const v23RawOpenTenantForm=openTenantForm;
openTenantForm=function(existing=null){
  if(existing&&existing.buildingId&&!existing.id&&!existing.company){const buildingId=existing.buildingId;v23RawOpenTenantForm(null);v23SetFormValue('#tenantForm','buildingId',buildingId);return;}
  return v23RawOpenTenantForm(existing);
};

const v23RawOpenEquipmentForm=openEquipmentForm;
openEquipmentForm=function(existing=null){
  if(existing&&existing.buildingId&&!existing.id&&!existing.name){const buildingId=existing.buildingId;v23RawOpenEquipmentForm(null);v23SetFormValue('#equipmentForm','buildingId',buildingId);return;}
  return v23RawOpenEquipmentForm(existing);
};

const v23RawOpenExpenseForm=openExpenseForm;
openExpenseForm=function(existing=null,month=''){
  if(!existing&&month&&v23Building(month)){const buildingId=month;v23RawOpenExpenseForm(null,'');v23SetFormValue('#expenseForm','buildingId',buildingId);return;}
  return v23RawOpenExpenseForm(existing,month);
};

v23BuildingInspections=function(c){return `<div class="tab-section-head"><div><h3>Осмотры</h3><p>Следующий: ${c.archived?'—':fmtDate(c.plan?.nextDue)}</p></div>${hasPerm('inspections_create')&&!c.archived?'<button class="btn btn-primary btn-sm" id="tabInspect">'+uiIcon('inspection')+'<span>Провести</span></button>':''}</div><div class="object-tab-list">${c.inspections.slice(0,20).map(i=>`<button class="object-inspection-row" data-inspection-id="${esc(i.id)}"><span class="object-tab-icon">${uiIcon('inspection')}</span><span><b>${fmtDateTime(i.occurredAt||i.createdAt)}</b><small>${esc(i.inspectorName||'')} · ${(i.createdIssueIds||[]).length} проблем · ${(i.exteriorPhotos||i.photos||[]).length} фото</small></span><em>›</em></button>`).join('')||'<div class="empty">Осмотров пока нет</div>'}</div>`;};

const v23RawRenderOperationsCalendar=renderOperationsCalendar;
renderOperationsCalendar=function(v){
  const result=v23RawRenderOperationsCalendar(v);
  const now=new Date(),base=app.calendarMonth?v23Date(app.calendarMonth+'-01'):new Date(now.getFullYear(),now.getMonth(),1),month=new Date(base.getFullYear(),base.getMonth(),1);
  const prev=$('#calPrev'),next=$('#calNext'),today=$('#calToday');
  if(prev)prev.onclick=()=>{app.calendarMonth=v23LocalMonthKey(new Date(month.getFullYear(),month.getMonth()-1,1));renderOperationsCalendar(v);};
  if(next)next.onclick=()=>{app.calendarMonth=v23LocalMonthKey(new Date(month.getFullYear(),month.getMonth()+1,1));renderOperationsCalendar(v);};
  if(today)today.onclick=()=>{app.calendarMonth=v23LocalMonthKey(new Date());renderOperationsCalendar(v);};
  return result;
};
