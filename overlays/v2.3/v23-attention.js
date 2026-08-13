function v23AttentionItems(){
  if(app.user?.role==='tenant')return[];
  const items=[];
  const push=(o)=>items.push({weight:0,...o});
  for(const i of app.data.issues||[]){
    if(i.status==='done')continue;
    const overdue=isIssueOverdue?.(i) ?? (!!i.due&&i.due<new Date().toISOString().slice(0,10));
    if(!(overdue||i.priority==='critical'||i.status==='awaiting_acceptance'))continue;
    const b=v23Building(i.buildingId);
    push({kind:'issue',id:i.id,weight:overdue?100:i.priority==='critical'?95:70,tone:overdue||i.priority==='critical'?'critical':'attention',icon:'alert',title:i.title,meta:`${b?.name||'Объект'} · ${overdue?'просрочено':i.status==='awaiting_acceptance'?'ждёт подтверждения':'критический приоритет'}`,date:i.due||''});
  }
  if(hasPerm('inspections_view'))for(const p of app.data.inspectionPlans||[]){
    if(p.active===false)continue;const days=v23DaysFromNow(p.nextDue);if(days===null||days>7)continue;const b=v23Building(p.buildingId);push({kind:'inspection',id:p.buildingId,weight:days<0?90:55,tone:days<0?'critical':'attention',icon:'inspection',title:`Осмотр: ${b?.name||'Объект'}`,meta:days<0?`просрочен на ${Math.abs(days)} дн.`:days===0?'сегодня':`через ${days} дн.`,date:p.nextDue||''});
  }
  if(hasPerm('equipment_view'))for(const e of app.data.equipment||[]){
    const days=v23DaysFromNow(e.nextService);if(days===null||days>14)continue;const b=v23Building(e.buildingId);push({kind:'equipment',id:e.id,buildingId:e.buildingId,weight:days<0?85:50,tone:days<0?'critical':'attention',icon:'equipment',title:`ТО: ${e.name}`,meta:`${b?.name||'Объект'} · ${days<0?`просрочено ${Math.abs(days)} дн.`:days===0?'сегодня':`через ${days} дн.`}`,date:e.nextService||''});
  }
  if(hasPerm('metrics_view'))for(const b of app.data.buildings||[]){
    const rows=(app.data.metrics||[]).filter(m=>m.buildingId===b.id).sort((a,c)=>String(a.month).localeCompare(String(c.month)));if(rows.length<2)continue;const latest=rows.at(-1),prev=rows.at(-2),labels=[];for(const [key,label] of [['electricity','электричество'],['water','вода'],['heat','тепло']]){const a=Number(latest[key]||0),p=Number(prev[key]||0);if(p>0&&((a-p)/p)>0.2)labels.push(`${label} +${Math.round((a-p)/p*100)}%`);}if(labels.length)push({kind:'metric',id:b.id,weight:60,tone:'attention',icon:'chart',title:`Аномалия: ${b.name}`,meta:labels.join(' · '),date:latest.month?latest.month+'-01':''});
  }
  for(const r of app.data.dashboard?.recurring||[]){if(!r.open)continue;push({kind:'building',id:r.buildingId,weight:45,tone:'info',icon:'refresh',title:`Повторяется: ${r.category}`,meta:`${r.buildingName}${r.tenantName?' · '+r.tenantName:''} · ${r.count} раз`,date:r.lastAt||''});}
  return items.sort((a,b)=>b.weight-a.weight||String(a.date).localeCompare(String(b.date))).slice(0,12);
}
function v23AttentionRow(x){return `<button class="attention-center-row ${x.tone}" type="button" data-v23-kind="${esc(x.kind)}" data-v23-id="${esc(x.id)}" ${x.buildingId?`data-v23-building="${esc(x.buildingId)}"`:''}><span class="attention-center-icon">${uiIcon(x.icon)}</span><span class="attention-center-copy"><b>${esc(x.title)}</b><small>${esc(x.meta)}</small></span><span class="attention-center-arrow">›</span></button>`;}
function v23BindAttention(root=document){
  $$('[data-v23-kind]',root).forEach(el=>el.onclick=()=>{const kind=el.dataset.v23Kind,id=el.dataset.v23Id;if(kind==='issue')return openIssue(id);if(kind==='inspection')return openInspectionForm(id);if(kind==='equipment'){const eq=(app.data.equipment||[]).find(x=>x.id===id);if(eq&&canManageEquipment())return openEquipmentForm(eq);app.view='equipment';return renderShell();}if(kind==='metric'){app.metricBuilding=id;app.view='metrics';return renderShell();}if(kind==='building')return openBuilding(id);});
}
