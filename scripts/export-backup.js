'use strict';
// Invoked by the authenticated owner endpoint in a separate process.
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const {verifyBackup}=require('../src/backup');
let archive;
process.on('SIGTERM',()=>{archive?.kill('SIGTERM');process.exit(1);});
try{
 const directory=process.argv[2];verifyBackup(directory);
 const manifest=JSON.parse(fs.readFileSync(path.join(directory,'BACKUP_INFO.json'),'utf8'));
 const files=['BACKUP_INFO.json',...manifest.files.map(f=>f.path)];
 archive=spawn('tar',['-czf','-','-C',directory,'--null','--verbatim-files-from','--files-from=-'],{stdio:['pipe','pipe','pipe']});
 archive.stdin.on('error',()=>{});archive.stdin.end(Buffer.from(files.map(f=>'./'+f).join('\0')+'\0'));
 archive.once('spawn',()=>{process.send?.({ready:true});archive.stdout.pipe(process.stdout);});
 archive.stderr.resume();
 archive.once('error',()=>{process.exitCode=1;process.disconnect?.();});
 archive.once('close',code=>{process.exitCode=code===0?0:1;process.disconnect?.();});
}catch{process.exitCode=1;process.disconnect?.();}
