'use strict';
// Run the release script against disposable directories and fake Docker/curl only.
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('node:assert/strict'),{spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..');
for(const scenario of ['success','switch-fails','version-mismatch','backup-stopped','snapshot-fails']){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'uk-release-')),target=path.join(tmp,'upravlenie-v3'),staging=path.join(tmp,'staging'),bin=path.join(tmp,'bin'),stateFile=path.join(tmp,'mock.json');
 fs.mkdirSync(bin);fs.mkdirSync(path.join(target,'public'),{recursive:true});fs.mkdirSync(path.join(staging,'public'),{recursive:true});fs.mkdirSync(path.join(staging,'deploy'));
 fs.writeFileSync(path.join(target,'public/version.json'),JSON.stringify({version:'3.5.0'}));fs.writeFileSync(path.join(target,'docker-compose.production.yml'),'old-compose');fs.writeFileSync(path.join(target,'.env'),'TEST_VALUE=preserved\n');fs.writeFileSync(path.join(target,'previous.txt'),'previous release');
 fs.writeFileSync(path.join(staging,'public/version.json'),JSON.stringify({version:'3.6.0'}));fs.writeFileSync(path.join(staging,'deploy/docker-compose.production.yml'),'new-compose');fs.writeFileSync(path.join(staging,'deploy/Dockerfile.production'),'FROM dummy');
 fs.writeFileSync(stateFile,JSON.stringify({version:'3.5.0',log:[]}));
 const mock=`#!/usr/bin/env node
 const fs=require('fs'),path=require('path'),a=process.argv.slice(2),cmd=path.basename(process.argv[1]),file=process.env.MOCK_STATE,s=JSON.parse(fs.readFileSync(file)),scenario=process.env.MOCK_SCENARIO;let output='',code=0;
 s.log.push([cmd,...a]);
 if(cmd==='docker'){
  if(a[0]==='inspect')output='sha256:previous';
  if(a[0]==='compose'){
   if(a.includes('ps'))output=a.includes('--services')?(scenario==='backup-stopped'&&s.version==='3.6.0'?'app':'app\\nbackup'):'current-container';
   if(a.includes('run')&&scenario==='snapshot-fails')code=1;
   if(a.includes('up')){const compose=a[a.indexOf('-f')+1];s.version=JSON.parse(fs.readFileSync(path.join(path.dirname(compose),'public/version.json'))).version;if(s.version==='3.6.0'&&scenario==='switch-fails')code=1;}
  }
 }
 if(cmd==='curl'){const url=a.at(-1);output=url.endsWith('healthz')?JSON.stringify({ok:true,version:'3.0.0'}):JSON.stringify({version:scenario==='version-mismatch'&&s.version==='3.6.0'?'wrong':s.version});}
 fs.writeFileSync(file,JSON.stringify(s));process.stdout.write(output);if(cmd==='docker'&&output)process.stdout.write('\\n');process.exitCode=code;
 `;
 for(const cmd of ['docker','curl','sleep'])fs.writeFileSync(path.join(bin,cmd),mock,{mode:0o755});
 const result=spawnSync('bash',[path.join(root,'scripts/deploy-production.sh'),staging],{env:{...process.env,PATH:bin+':'+process.env.PATH,UK_DEPLOY_ROOT:tmp,MOCK_STATE:stateFile,MOCK_SCENARIO:scenario},encoding:'utf8',timeout:30000});
 const state=JSON.parse(fs.readFileSync(stateFile));
 assert.equal(result.status,scenario==='success'?0:1,scenario+' '+result.stderr);
 assert.equal(fs.readFileSync(path.join(target,'.env'),'utf8'),'TEST_VALUE=preserved\n');
 const snapshotIndex=state.log.findIndex(a=>a.includes('run')),switchIndex=state.log.findIndex(a=>a.includes('up'));
 assert.ok(snapshotIndex>=0);assert.ok(switchIndex<0||snapshotIndex<switchIndex,'verified snapshot precedes switch');
 if(scenario==='success'){
  assert.match(result.stdout,/RELEASE_VERIFIED/);assert.equal(state.version,'3.6.0');assert.ok(fs.existsSync(path.join(tmp,'upravlenie-rollback/previous/previous.txt')));
 }else{
  assert.doesNotMatch(result.stdout,/RELEASE_VERIFIED/);assert.equal(state.version,'3.5.0');assert.ok(fs.existsSync(path.join(target,'previous.txt')));
  if(scenario!=='snapshot-fails'){assert.match(result.stdout,/ROLLBACK_VERIFIED/);assert.ok(state.log.some(a=>a[0]==='docker'&&a[1]==='tag'&&a[2]==='sha256:previous'&&a[3]==='upravlenie-v3-app:local'));}
 }
 fs.rmSync(tmp,{recursive:true,force:true});
}
console.log('Deployment: successful release, failed switch, mismatched version, stopped backup and failed snapshot: OK');
