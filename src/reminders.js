'use strict';
function remindersFor(state,user,{canSeeIssue,canAccessBuilding,hasPerm},today){
 const tomorrow=new Date(today+'T12:00:00Z');tomorrow.setUTCDate(tomorrow.getUTCDate()+1);const next=tomorrow.toISOString().slice(0,10);
 const rows=[];const reads=state.reminderReads?.[user.id]||{};
 const make=(type,id,due,name,meta)=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(due||'')||due>next)return;
  const phase=due<today?'overdue':due===today?'today':'tomorrow';
  const key=`reminder:${type}:${id}:${due}:${phase}`;
  rows.push({id:key,userId:user.id,kind:'reminder',severity:phase,title:`${type==='issue'?'Задача':type==='equipment'?'ТО оборудования':'Осмотр'}: ${phase==='overdue'?'срок пропущен':phase==='today'?'срок сегодня':'срок завтра'}`,text:name,at:today+'T00:00:00Z',readAt:reads[key]||'',due,...meta});
 };
 const active=id=>state.buildings.some(b=>b.id===id&&!b.archivedAt);
 if(user.role!=='tenant')for(const i of state.issues){if(i.status!=='done'&&i.status!=='awaiting_acceptance'&&active(i.buildingId)&&canSeeIssue(user,i))make('issue',i.id,i.due,i.title,{issueId:i.id,buildingId:i.buildingId});}
 if(hasPerm(user,'inspections_view'))for(const p of state.inspectionPlans||[]){if(p.active!==false&&active(p.buildingId)&&canAccessBuilding(user,p.buildingId)&&(user.role==='owner'||p.inspectorUserId===user.id))make('inspection',p.buildingId,p.nextDue,state.buildings.find(b=>b.id===p.buildingId)?.name||'Объект',{buildingId:p.buildingId});}
 if(user.role!=='tenant'&&hasPerm(user,'equipment_view'))for(const e of state.equipment||[]){if(active(e.buildingId)&&canAccessBuilding(user,e.buildingId))make('equipment',e.id,e.nextService,e.name,{equipmentId:e.id,buildingId:e.buildingId});}
 return rows.sort((a,b)=>a.due.localeCompare(b.due));
}
module.exports={remindersFor};
