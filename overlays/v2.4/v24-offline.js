'use strict';
(function(){
  const DB='owner-property-offline-v24',STORE='queue';let justQueued=false;
  const openDb=()=>new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE,{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  async function put(row){const db=await openDb();return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(row);tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});}
  async function all(){const db=await openDb();return new Promise((res,rej)=>{const q=db.transaction(STORE).objectStore(STORE).getAll();q.onsuccess=()=>res(q.result||[]);q.onerror=()=>rej(q.error);});}
  async function del(id){const db=await openDb();return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(id);tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});}
  const rawApi=api,rawRefresh=refresh,rawToast=toast;
  api=async function(url,options={}){if(url==='/api/inspections'&&options.method==='POST'&&!navigator.onLine){const row={id:'offline-'+Date.now()+'-'+Math.random().toString(36).slice(2),url,options,createdAt:new Date().toISOString(),userId:app.user?.id||''};await put(row);justQueued=true;v24UpdateNet();return {createdIssueIds:[],offlineQueued:true};}return rawApi(url,options);};
  refresh=async function(){if(!navigator.onLine)return;return rawRefresh();};
  toast=function(msg){if(justQueued&&String(msg).startsWith('Осмотр сохранён')){justQueued=false;return rawToast('Осмотр сохранён офлайн и будет отправлен автоматически.');}return rawToast(msg);};
  async function sync(){if(!navigator.onLine||!app.user)return;const rows=await all();for(const row of rows){if(row.userId&&row.userId!==app.user.id)continue;try{await rawApi(row.url,row.options);await del(row.id);}catch(e){if(e.status&&e.status<500&&e.status!==408)await del(row.id);else break;}}if(rows.length){try{await rawRefresh();renderShell();}catch{}}v24UpdateNet();}
  async function v24UpdateNet(){let count=0;try{count=(await all()).filter(x=>!x.userId||x.userId===app.user?.id).length;}catch{}let el=document.getElementById('v24Net');if(!el){el=document.createElement('button');el.id='v24Net';el.type='button';el.className='v24-net';document.body.appendChild(el);}el.className='v24-net '+(navigator.onLine?'online':'offline');el.textContent=navigator.onLine?(count?`Онлайн · очередь ${count}`:'Онлайн'):`Офлайн · очередь ${count}`;el.title='Осмотры без сети сохраняются на этом устройстве';}
  window.addEventListener('online',sync);window.addEventListener('offline',v24UpdateNet);setInterval(()=>navigator.onLine&&sync(),30000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});setTimeout(v24UpdateNet,600);
  window.v24Offline={sync,all};
})();
