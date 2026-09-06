'use strict';
const {spawn}=require('child_process');
const fs=require('fs'),os=require('os'),path=require('path');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'owner-v3-')),port=18987;
const env={...process.env,NODE_ENV:'test',HOST:'127.0.0.1',PORT:String(port),DB_FILE:path.join(tmp,'app.db'),UPLOAD_DIR:path.join(tmp,'uploads'),OWNER_LOGIN:process.env.OWNER_LOGIN||'owner',OWNER_PASSWORD:process.env.OWNER_PASSWORD||'CI-Only-Owner-Password-2026!'};
const child=spawn(process.execPath,['server.js'],{cwd:root,env,stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',d=>stderr+=d);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function req(url,opt={}){const r=await fetch(`http://127.0.0.1:${port}${url}`,opt),text=await r.text();let data={};try{data=JSON.parse(text)}catch{};return {r,data};}
(async()=>{try{
  for(let i=0;i<50;i++){try{const x=await req('/healthz');if(x.r.ok)break}catch{}await sleep(100)}
  let x=await req('/healthz');if(x.data.version!=='3.0.0')throw Error('bad health version');
  const release=await req('/version.json');if(!release.r.ok||release.data.version!=='3.4.0'||release.r.headers.get('cache-control')!=='no-store')throw Error('release version or cache policy incorrect');
  const html=await (await fetch(`http://127.0.0.1:${port}/`)).text();if(!html.includes('/app.js?v='+release.data.version)||!html.includes('/app.css?v='+release.data.version))throw Error('shell version mismatch');
  x=await req('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:env.OWNER_LOGIN,password:env.OWNER_PASSWORD})});if(!x.r.ok)throw Error('owner login failed '+JSON.stringify(x.data));
  const cookie=(x.r.headers.get('set-cookie')||'').split(';')[0],csrf=x.data.csrf,headers={'content-type':'application/json','cookie':cookie,'x-csrf-token':csrf};
  x=await req('/api/buildings',{headers:{cookie}});if(!x.r.ok||x.data.length!==0)throw Error('fresh database is not empty');
  x=await req('/api/buildings',{method:'POST',headers,body:JSON.stringify({name:'Реальный объект',address:'Санкт-Петербург',area:1000,occupied:500,floors:2,status:'ok'})});if(!x.r.ok)throw Error('create building failed '+JSON.stringify(x.data));const id=x.data.id;
  x=await req('/api/buildings/'+id,{method:'PATCH',headers,body:JSON.stringify({name:'Объект после редактирования',area:1200})});if(!x.r.ok||x.data.name!=='Объект после редактирования')throw Error('edit building failed');
  x=await req('/api/buildings/'+id+'/archive',{method:'POST',headers,body:'{}'});if(!x.r.ok||!x.data.archivedAt)throw Error('archive failed');
  x=await req('/api/buildings?archived=1',{headers:{cookie}});if(!x.r.ok||x.data.length!==1)throw Error('archive list failed');
  x=await req('/api/buildings/'+id+'/restore',{method:'POST',headers,body:'{}'});if(!x.r.ok||x.data.archivedAt)throw Error('restore failed');
  await req('/api/buildings/'+id+'/archive',{method:'POST',headers,body:'{}'});
  x=await req('/api/buildings/'+id,{method:'DELETE',headers});if(!x.r.ok)throw Error('delete empty archived building failed '+JSON.stringify(x.data));
  const assert=require('node:assert/strict');
  const post=(url,data,h=headers)=>req(url,{method:'POST',headers:h,body:JSON.stringify(data)});
  const patch=(url,data,h=headers)=>req(url,{method:'PATCH',headers:h,body:JSON.stringify(data)});
  const login=async(email,password)=>{const x=await post('/api/login',{email,password});assert.equal(x.r.status,200);return {'content-type':'application/json',cookie:x.r.headers.get('set-cookie').split(';')[0],'x-csrf-token':x.data.csrf};};
  const a=(await post('/api/buildings',{name:'A',area:100})).data.id;
  const b=(await post('/api/buildings',{name:'B',area:100})).data.id;
  const pwd='Audit-Worker-Password!';
  const worker=(await post('/api/staff',{name:'Одинаковое имя',email:'worker',password:pwd,role:'technician',buildingIds:[a]})).data.user;
  const twin=(await post('/api/staff',{name:'Одинаковое имя',email:'twin',password:pwd,role:'technician',buildingIds:[a]})).data.user;
  const wh=await login('worker',pwd), th=await login('twin',pwd);
  for(const h of [wh,th]){
    assert.equal((await req('/api/admin',{headers:h})).r.status,403,'staff cannot read admin');
    assert.equal((await post('/api/staff',{name:'rogue',email:'rogue'},h)).r.status,403,'staff cannot create accounts');
    assert.equal((await patch('/api/staff/'+worker.id,{password:'Other-Password!'},h)).r.status,403,'staff cannot reset passwords');
    assert.deepEqual((await req('/api/buildings',{headers:h})).data.map(x=>x.id),[a]);
  }
  const failed=await patch('/api/staff/'+worker.id,{name:'MUTATED',email:'changed',password:'short'});
  assert.equal(failed.r.status,422);
  let account=(await req('/api/admin',{headers})).data.users.find(x=>x.id===worker.id);
  assert.equal(account.name,'Одинаковое имя','failed update must be atomic');assert.equal(account.email,'worker');
  assert.equal((await patch('/api/staff/'+worker.id,{name:'MUTATED',email:'twin'})).r.status,409);
  assert.equal((await req('/api/admin',{headers})).data.users.find(x=>x.id===worker.id).name,'Одинаковое имя');
  assert.equal((await post('/api/issues',{buildingId:b,title:'Wrong assignment',responsibleUserId:worker.id})).r.status,422);
  const issue=(await post('/api/issues',{buildingId:a,title:'Task A',responsibleUserId:worker.id})).data;
  assert.ok(issue.id);assert.equal((await req('/api/issues',{headers:wh})).data.length,1);
  assert.equal((await req('/api/issues',{headers:th})).data.length,0,'same name does not grant access');
  const other=(await post('/api/issues',{buildingId:b,title:'Task B'})).data;
  assert.equal((await patch('/api/issues/'+other.id,{priority:'critical',responsibleUserId:worker.id})).r.status,422);
  assert.equal((await req('/api/issues',{headers})).data.find(x=>x.id===other.id).priority,'normal');
  assert.equal((await patch('/api/issues/'+issue.id,{status:'done'})).r.status,422,'photo workflow required');
  assert.equal((await post('/api/issues',{buildingId:a,title:'Bypass report',status:'done'})).r.status,422);
  const tenant=(await post('/api/tenants',{buildingId:b,company:'Tenant B',area:10})).data;
  assert.equal((await post('/api/issues',{buildingId:a,tenantId:tenant.id,title:'Wrong tenant'})).r.status,422);
  assert.equal((await post('/api/issues',{buildingId:'missing',title:'Missing building'})).r.status,403);
  const report={author:'Исполнитель',text:'Работа выполнена',markDone:true,photos:[{name:'result.png',type:'image/png',data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII='}]};
  assert.equal((await post('/api/issues/'+issue.id+'/reports',{...report,photos:[]},wh)).r.status,422);
  const completed=await post('/api/issues/'+issue.id+'/reports',report,wh);
  assert.equal(completed.r.status,201);assert.equal(completed.data.status,'done');
  assert.equal((await req(completed.data.photos[0].url,{headers:th})).r.status,403,'same-name staff cannot read private photo');
  const tenantIssue=(await post('/api/issues',{buildingId:b,tenantId:tenant.id,title:'Tenant repair'})).data;
  const waiting=await post('/api/issues/'+tenantIssue.id+'/reports',report);
  assert.equal(waiting.r.status,201);assert.equal(waiting.data.status,'awaiting_acceptance');
  assert.equal((await patch('/api/issues/'+tenantIssue.id,{status:'awaiting_acceptance',priority:'high'})).r.status,200,'editing awaiting task preserves workflow');
  const nextPwd='Updated-Worker-Password!';
  assert.equal((await patch('/api/staff/'+worker.id,{email:'worker-new',password:nextPwd})).r.status,200);
  assert.equal((await req('/api/me',{headers:wh})).r.status,401,'password change revokes session');
  const nextHeaders=await login('worker-new',nextPwd);
  assert.equal((await patch('/api/staff/'+worker.id,{active:false})).r.status,200);
  assert.equal((await req('/api/me',{headers:nextHeaders})).r.status,401,'disable revokes session');
  assert.equal((await post('/api/issues',{buildingId:a,title:'Disabled worker',responsibleUserId:worker.id})).r.status,422);
  console.log('v3-clean smoke: objects, staff, permissions, assignments, password sessions: OK');

}catch(e){console.error(e.stack||e);console.error(stderr);process.exitCode=1}finally{child.kill('SIGTERM')}})();

