'use strict';
const {spawn}=require('child_process');
const fs=require('fs'),os=require('os'),path=require('path');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'owner-v3-')),port=18987;
const env={...process.env,NODE_ENV:'test',HOST:'127.0.0.1',PORT:String(port),DB_FILE:path.join(tmp,'app.db'),OWNER_LOGIN:process.env.OWNER_LOGIN||'owner',OWNER_PASSWORD:process.env.OWNER_PASSWORD||'CI-Only-Owner-Password-2026!'};
const child=spawn(process.execPath,['server.js'],{cwd:root,env,stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',d=>stderr+=d);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function req(url,opt={}){const r=await fetch(`http://127.0.0.1:${port}${url}`,opt),text=await r.text();let data={};try{data=JSON.parse(text)}catch{};return {r,data};}
(async()=>{try{
  for(let i=0;i<50;i++){try{const x=await req('/healthz');if(x.r.ok)break}catch{}await sleep(100)}
  let x=await req('/healthz');if(x.data.version!=='3.0.0')throw Error('bad health version');
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
  console.log('v3-clean smoke: OK');
}catch(e){console.error(e.stack||e);console.error(stderr);process.exitCode=1}finally{child.kill('SIGTERM')}})();
