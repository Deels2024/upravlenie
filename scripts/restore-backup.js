'use strict';
const fs=require('fs'),path=require('path'),{verifyBackup}=require('../src/backup');
try{
 const [source,target]=process.argv.slice(2);if(!source||!target)throw Error('Usage: node scripts/restore-backup.js BACKUP_DIR EMPTY_TARGET_DIR');
 const info=verifyBackup(path.resolve(source)),dest=path.resolve(target);
 if(fs.existsSync(dest)&&fs.readdirSync(dest).length)throw Error('Target directory must be empty; existing data will not be overwritten');
 fs.mkdirSync(dest,{recursive:true,mode:0o700});
 fs.copyFileSync(path.join(source,'app.db'),path.join(dest,'app.db'));
 // Restoring older application data must not revive sessions revoked after that backup.
 const {DatabaseSync}=require('node:sqlite'),restored=new DatabaseSync(path.join(dest,'app.db'));
 try{if(restored.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_sessions'").get())restored.exec('DELETE FROM auth_sessions');}finally{restored.close();}
 if(fs.existsSync(path.join(source,'private_uploads')))fs.cpSync(path.join(source,'private_uploads'),path.join(dest,'private_uploads'),{recursive:true});
 console.log(JSON.stringify({restored:true,...info}));
}catch(e){console.error(e.message);process.exitCode=1;}
