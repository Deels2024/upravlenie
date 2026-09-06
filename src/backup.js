'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {DatabaseSync,backup}=require('node:sqlite');
function digest(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function filesIn(dir,prefix=''){
 if(!fs.existsSync(dir))return [];
 return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
  if(!e.isDirectory()&&!e.isFile())throw Error('Backup must not contain symbolic links');
  const rel=path.posix.join(prefix,e.name),file=path.join(dir,e.name);
  return e.isDirectory()?filesIn(file,rel):[{path:rel,size:fs.statSync(file).size,sha256:digest(file)}];
 });
}
function verifyBackup(dir){
 if(fs.lstatSync(dir).isSymbolicLink())throw Error('Backup directory must not be a symbolic link');
 const actualFiles=filesIn(dir);
 const info=JSON.parse(fs.readFileSync(path.join(dir,'BACKUP_INFO.json'),'utf8'));
 const actual=new Map(actualFiles.map(f=>[f.path,f]));
 if(info.format!==1||!Array.isArray(info.files)||!info.files.some(f=>f.path==='app.db'))throw Error('Invalid backup manifest');
 for(const f of info.files){
  if(typeof f.path!=='string'||f.path.split('/').includes('..')||path.isAbsolute(f.path))throw Error('Unsafe backup path');
  if(!actual.has(f.path))throw Error('Backup file is not a regular file');
  const file=actual.get(f.path);
  if(file.size!==f.size||file.sha256!==f.sha256)throw Error('Backup file verification failed: '+f.path);
 }
 const db=new DatabaseSync(path.join(dir,'app.db'),{readOnly:true});
 try{
  if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('SQLite integrity check failed');
  const row=db.prepare('SELECT data FROM app_state WHERE id=1').get();
  const state=JSON.parse(row?.data||'null');if(!state||!Array.isArray(state.buildings)||!Array.isArray(state.users))throw Error('Application data missing');
  const manifest=new Set(info.files.map(f=>f.path));
  for(const [key,folder] of [['issues','issues'],['inspections','inspections']])for(const item of state[key]||[])for(const photo of item.photos||[]){
   const rel=path.posix.join('private_uploads',folder,String(item.id),String(photo.file));
   if(!manifest.has(rel))throw Error('Referenced photo missing: '+rel);
  }
  return {createdAt:info.createdAt,files:info.files.length,buildings:state.buildings.length,users:state.users.length};
 }finally{db.close();}
}
async function createBackup({src,uploads,outDir,keep=14}){
 if(!fs.existsSync(src))throw Error('Database not found');
 fs.mkdirSync(outDir,{recursive:true,mode:0o700});
 const stamp=new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(3).toString('hex');
 const staging=path.join(outDir,'.partial-'+stamp),dest=path.join(outDir,'owner-property-'+stamp);
 fs.mkdirSync(staging,{mode:0o700});
 try{
  const db=new DatabaseSync(src,{readOnly:true});
  try{await backup(db,path.join(staging,'app.db'));}finally{db.close();}
  if(fs.existsSync(uploads))fs.cpSync(uploads,path.join(staging,'private_uploads'),{recursive:true});
  const info={format:1,createdAt:new Date().toISOString(),files:filesIn(staging)};
  fs.writeFileSync(path.join(staging,'BACKUP_INFO.json'),JSON.stringify(info,null,2),{mode:0o600});
  verifyBackup(staging);fs.renameSync(staging,dest);
  const limit=Number.isFinite(Number(keep))?Math.max(1,Math.floor(Number(keep))):14;
  const dirs=fs.readdirSync(outDir,{withFileTypes:true}).filter(e=>e.isDirectory()&&/^owner-property-\d{4}-/.test(e.name)).map(e=>e.name).sort().reverse();
  for(const old of dirs.slice(limit))fs.rmSync(path.join(outDir,old),{recursive:true,force:true});
  return dest;
 }catch(e){fs.rmSync(staging,{recursive:true,force:true});throw e;}
}
module.exports={createBackup,verifyBackup};
