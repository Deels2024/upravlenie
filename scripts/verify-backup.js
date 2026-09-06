'use strict';
const {verifyBackup}=require('../src/backup');
try{if(!process.argv[2])throw Error('Usage: node scripts/verify-backup.js /path/to/backup');console.log(JSON.stringify(verifyBackup(process.argv[2])));}
catch(e){console.error(e.message);process.exitCode=1;}
