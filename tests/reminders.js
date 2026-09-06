'use strict';
const assert=require('node:assert/strict'),{remindersFor}=require('../src/reminders');
const state={buildings:[{id:'a'},{id:'archived',archivedAt:'2026-01-01'}],issues:[{id:'late',buildingId:'a',due:'2026-09-05',title:'Late',status:'new'},{id:'today',buildingId:'a',due:'2026-09-06',title:'Today',status:'assigned'},{id:'tomorrow',buildingId:'a',due:'2026-09-07',title:'Tomorrow',status:'new'},{id:'later',buildingId:'a',due:'2026-09-08',status:'new'},{id:'done',buildingId:'a',due:'2020-01-01',status:'done'},{id:'archived',buildingId:'archived',due:'2020-01-01',status:'new'}],inspectionPlans:[{buildingId:'a',nextDue:'2026-09-06',inspectorUserId:'inspector',active:true}]};
const perms={canSeeIssue:()=>true,canAccessBuilding:()=>true,hasPerm:()=>true};
const owner=remindersFor(state,{id:'owner',role:'owner'},perms,'2026-09-06');
assert.deepEqual(owner.filter(n=>n.issueId).map(n=>n.issueId),['late','today','tomorrow']);assert.equal(owner.filter(n=>!n.issueId).length,1);
assert.equal(remindersFor(state,{id:'other',role:'inspector'},{...perms,canSeeIssue:()=>false},'2026-09-06').length,0);
assert.equal(remindersFor(state,{id:'inspector',role:'inspector'},{...perms,canSeeIssue:()=>false},'2026-09-06').length,1);
assert.equal(remindersFor(state,{id:'tenant',role:'tenant'},{...perms,hasPerm:()=>false},'2026-09-06').length,0);
console.log('deadline reminders: dates, completed/archive exclusion and recipients: OK');

state.equipment=[{id:'pump',buildingId:'a',name:'Pump',nextService:'2026-09-06'},{id:'future',buildingId:'a',nextService:'2026-10-01'},{id:'arch',buildingId:'archived',nextService:'2020-01-01'}];
assert.deepEqual(remindersFor(state,{id:'owner',role:'owner'},perms,'2026-09-06').filter(n=>n.equipmentId).map(n=>n.equipmentId),['pump']);
assert.equal(remindersFor(state,{id:'no-access',role:'technician'},{...perms,canAccessBuilding:()=>false},'2026-09-06').some(n=>n.equipmentId),false);
assert.equal(remindersFor(state,{id:'no-permission',role:'technician'},{...perms,hasPerm:()=>false},'2026-09-06').some(n=>n.equipmentId),false);
const {backupStatus}=require('../src/backup-status'),fs=require('fs'),os=require('os'),path=require('path');const temp=fs.mkdtempSync(path.join(os.tmpdir(),'uk-backup-status-'));
try{assert.equal(backupStatus(temp).stale,true);const dir=path.join(temp,'owner-property-2026-09-01');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'BACKUP_INFO.json'),JSON.stringify({format:1,createdAt:'2026-09-01T00:00:00Z'}));assert.equal(backupStatus(temp,Date.parse('2026-09-01T12:00:00Z')).stale,false);assert.equal(backupStatus(temp,Date.parse('2026-09-03T00:00:00Z')).stale,true);assert.equal(backupStatus(temp,Date.parse('2026-08-01T00:00:00Z')).verifiedAtCreation,false);}finally{fs.rmSync(temp,{recursive:true,force:true});}
console.log('Maintenance reminders and stale backup detection: OK');
