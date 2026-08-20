'use strict';
const fs=require('fs');
const path=require('path');
const { DatabaseSync, backup }=require('node:sqlite');
const src=process.env.DB_FILE||'/app/data/app.db';
const uploads=process.env.UPLOAD_DIR||'/app/private_uploads';
const outDir=process.env.BACKUP_DIR||'/app/backups';
const interval=Number(process.env.BACKUP_INTERVAL_SECONDS||86400)*1000;
const keep=Number(process.env.BACKUP_KEEP||14);
fs.mkdirSync(outDir,{recursive:true});
async function once(){
  if(!fs.existsSync(src)){console.log('backup: database not created yet'); return;}
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const dest=path.join(outDir,`owner-property-${stamp}`);
  fs.mkdirSync(dest,{recursive:true});
  const dbDest=path.join(dest,'app.db');
  const db=new DatabaseSync(src,{readOnly:true});
  try{await backup(db,dbDest);}finally{db.close();}
  if(fs.existsSync(uploads))fs.cpSync(uploads,path.join(dest,'private_uploads'),{recursive:true});
  fs.writeFileSync(path.join(dest,'BACKUP_INFO.txt'),`Created: ${new Date().toISOString()}\nContains: SQLite database + private photo uploads\n`);
  console.log(`backup: ${dest}`);
  const dirs=fs.readdirSync(outDir,{withFileTypes:true}).filter(x=>x.isDirectory()&&x.name.startsWith('owner-property-')).map(x=>x.name).sort().reverse();
  for(const old of dirs.slice(keep)){try{fs.rmSync(path.join(outDir,old),{recursive:true,force:true});}catch{}}
}
async function main(){
  do{try{await once();}catch(e){console.error('backup failed:',e.message);} if(process.argv.includes('--once'))break; await new Promise(r=>setTimeout(r,interval));}while(true);
}
main();
