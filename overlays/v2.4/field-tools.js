'use strict';
module.exports=async function fieldTools(ctx,req,res,u,user){
  const {crypto,bodyJson,json,nowIso,addDaysIso,persist,hasPerm,isTenant,canAccessBuilding,ensureIssueShape,saveIssuePhotos,publicIssue,createIssueFromPayload,notifyUser,logSecurity}=ctx;
  if(!Array.isArray(ctx.db.followUps))ctx.db.followUps=[];
  const risky=new Set(['Протечка','Водоснабжение','Вентиляция','Отопление','Кровля','Канализация','Электрика']);
  const ensureGenerated=()=>{
    for(const issue of ctx.db.issues){
      ensureIssueShape(issue);
      if(issue.status!=='done'||ctx.db.followUps.some(x=>x.issueId===issue.id))continue;
      if(issue.priority!=='critical'&&issue.priority!=='high'&&!risky.has(issue.category))continue;
      const base=issue.tenantAcceptedAt||issue.resolvedAt||issue.updatedAt||issue.createdAt||nowIso();
      const days=issue.priority==='critical'?3:risky.has(issue.category)?7:14;
      const row={id:'fu'+crypto.randomBytes(5).toString('hex'),issueId:issue.id,buildingId:issue.buildingId,tenantId:issue.tenantId||'',title:`Контроль: ${issue.title}`,category:issue.category||'Другое',priority:issue.priority||'normal',due:addDaysIso(base,days),status:'open',createdAt:nowIso(),createdBy:'Система',completedAt:'',completedBy:'',result:'',comment:'',photoIds:[],reopenedIssueId:''};
      ctx.db.followUps.unshift(row);
      const owner=ctx.db.users.find(x=>x.role==='owner'&&x.active!==false);if(owner)notifyUser(owner.id,'Назначена контрольная проверка',`${row.title} · до ${row.due}`,{buildingId:row.buildingId,issueId:issue.id});
    }
  };
  if(req.method==='GET'&&u.pathname==='/api/followups'){
    if(isTenant(user)||(!hasPerm(user,'inspections_view')&&user.role!=='owner'))return json(res,403,{error:'FORBIDDEN'});
    ensureGenerated();persist();
    const rows=ctx.db.followUps.filter(x=>canAccessBuilding(user,x.buildingId)).sort((a,b)=>String(a.due).localeCompare(String(b.due)));
    return json(res,200,rows);
  }
  if(req.method==='POST'&&/^\/api\/followups\/[^/]+\/complete$/.test(u.pathname)){
    if(isTenant(user)||(!hasPerm(user,'inspections_create')&&user.role!=='owner'))return json(res,403,{error:'FORBIDDEN'});
    const id=decodeURIComponent(u.pathname.split('/')[3]||''),row=ctx.db.followUps.find(x=>x.id===id);if(!row)return json(res,404,{error:'NOT_FOUND'});if(!canAccessBuilding(user,row.buildingId))return json(res,403,{error:'FORBIDDEN'});if(row.status==='done')return json(res,409,{error:'ALREADY_COMPLETED'});
    let b;try{b=await bodyJson(req,20_000_000);}catch{return json(res,400,{error:'BAD_JSON'});}const result=['passed','failed'].includes(b.result)?b.result:'';if(!result)return json(res,422,{error:'RESULT_REQUIRED'});if(!Array.isArray(b.photos)||!b.photos.length)return json(res,422,{error:'PHOTO_REQUIRED'});
    const original=ctx.db.issues.find(x=>x.id===row.issueId);if(!original)return json(res,404,{error:'ORIGINAL_ISSUE_NOT_FOUND'});
    let saved;try{saved=saveIssuePhotos(original,b.photos,'followup',user.name);}catch(e){return json(res,422,{error:e.message});}
    row.status='done';row.completedAt=nowIso();row.completedBy=user.name;row.result=result;row.comment=String(b.comment||'').slice(0,1500);row.photoIds=saved.map(x=>x.id);
    original.timeline.push({at:row.completedAt,actor:user.name,text:result==='passed'?'Контроль после ремонта пройден':'Контроль после ремонта: дефект повторился'});
    if(result==='failed'){
      const created=createIssueFromPayload({buildingId:row.buildingId,tenantId:row.tenantId||null,title:`Повторный дефект: ${original.title}`,category:row.category,priority:row.priority==='critical'?'critical':'high',due:addDaysIso(nowIso(),3),reporter:'Контроль после ремонта'},user);
      try{saveIssuePhotos(created,b.photos,'problem',user.name);}catch{}
      created.timeline.push({at:nowIso(),actor:'Система',text:`Создано после неуспешной контрольной проверки ${row.id}`});row.reopenedIssueId=created.id;
      const owner=ctx.db.users.find(x=>x.role==='owner'&&x.active!==false);if(owner)notifyUser(owner.id,'Дефект повторился',created.title,{buildingId:row.buildingId,issueId:created.id});
    }
    logSecurity(user.name,`Контрольная проверка ${row.title}: ${result}`);persist();return json(res,200,{followUp:row,reopenedIssue:row.reopenedIssueId?publicIssue(ctx.db.issues.find(x=>x.id===row.reopenedIssueId)):null});
  }
  return false;
};
