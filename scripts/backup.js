'use strict';
const {createBackup}=require('../src/backup');
const once=process.argv.includes('--once');
const seconds=Number(process.env.BACKUP_INTERVAL_SECONDS||86400);
const interval=(Number.isFinite(seconds)?Math.max(60,seconds):86400)*1000;
(async()=>{
 do{
  try{const dest=await createBackup({src:process.env.DB_FILE||'/app/data/app.db',uploads:process.env.UPLOAD_DIR||'/app/private_uploads',outDir:process.env.BACKUP_DIR||'/app/backups',keep:process.env.BACKUP_KEEP||14});console.log('backup verified:',dest);}
  catch(e){console.error('backup failed:',e.message);if(once)process.exitCode=1;}
  if(once)break;
  await new Promise(r=>setTimeout(r,interval));
 }while(true);
})();
