'use strict';
module.exports=function productionCleanStart(ctx){
  if(!ctx.PROD) return {ran:false,reason:'not-production'};
  ctx.db.meta=ctx.db.meta&&typeof ctx.db.meta==='object'?ctx.db.meta:{};
  if(ctx.db.meta.productionCleanStartAt) return {ran:false,reason:'already-complete',at:ctx.db.meta.productionCleanStartAt};

  const fs=ctx.fs,path=ctx.path;
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const safetyDir=path.join(ctx.BACKUP_DIR||path.join(ctx.ROOT_DIR,'backups'),'production-clean-start-'+stamp);
  fs.mkdirSync(safetyDir,{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(safetyDir,'state-before-cleanup.json'),JSON.stringify(ctx.db,null,2),{mode:0o600});

  try{
    ctx.sqlite?.exec('PRAGMA wal_checkpoint(FULL)');
    const dbFile=process.env.DB_FILE||path.join(ctx.ROOT_DIR,'data','app.ctx.db');
    if(fs.existsSync(dbFile)) fs.copyFileSync(dbFile,path.join(safetyDir,'app.ctx.db'));
  }catch(e){
    fs.writeFileSync(path.join(safetyDir,'backup-warning.txt'),String(e?.message||e),{mode:0o600});
  }

  const owner=(ctx.db.users||[]).find(u=>u.role==='owner')||(ctx.db.users||[]).find(u=>u.id==='u-owner');
  if(!owner) throw new Error('Production cleanup refused: owner account not found');
  owner.buildingIds=[];
  owner.active=true;

  const clearedAt=new Date().toISOString();
  ctx.db={
    buildings:[],tenants:[],issues:[],equipment:[],metrics:[],expenses:[],
    users:[owner],inspections:[],inspectionPlans:[],routingRules:[],notifications:[],
    securityLog:[],meta:{productionCleanStartAt:clearedAt,productionCleanBackup:safetyDir}
  };

  for(const dir of [ctx.ISSUE_UPLOAD_DIR,ctx.INSPECTION_UPLOAD_DIR]){
    try{
      if(!fs.existsSync(dir)) continue;
      for(const name of fs.readdirSync(dir)) fs.rmSync(path.join(dir,name),{recursive:true,force:true});
    }catch(e){
      console.error('Production cleanup photo removal warning:',e.message);
    }
  }

  ctx.logSecurity?.(owner.name||'Собственник','Production clean start: тестовые данные удалены');
  ctx.persist();
  console.log('Production clean start completed:',clearedAt,'backup:',safetyDir);
  return {ran:true,at:clearedAt,backup:safetyDir};
};
