'use strict';
const fs=require('fs'),path=require('path');
function backupStatus(dir,now=Date.now()){
 const empty={configured:!!dir,lastBackupAt:null,verifiedAtCreation:false,count:0,stale:true,ageHours:null,latestName:null};
 if(!dir)return empty;
 try{
  const names=fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.isDirectory()&&/^owner-property-\d{4}-[A-Za-z0-9-]+$/.test(e.name)).map(e=>e.name).sort().reverse();
  if(!names.length)return empty;
  const info=JSON.parse(fs.readFileSync(path.join(dir,names[0],'BACKUP_INFO.json'),'utf8')),at=Date.parse(info.createdAt);
  if(info.format!==1||!Number.isFinite(at)||at>now+300000)return {...empty,count:names.length};
  const hours=Math.max(0,(now-at)/3600000);
  return {...empty,lastBackupAt:info.createdAt,verifiedAtCreation:true,count:names.length,stale:hours>36,ageHours:Math.round(hours*10)/10,latestName:names[0]};
 }catch{return empty;}
}
module.exports={backupStatus};
