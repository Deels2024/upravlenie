'use strict';
const FormSafety=(()=>{
 const prefix='owner-draft:',ttl=86400000;const generations=new Map();let database,serial=Promise.resolve();
 function openDB(){
  if(!database)database=new Promise((resolve,reject)=>{
   const request=indexedDB.open('owner-property-drafts',1);
   request.onupgradeneeded=()=>request.result.createObjectStore('drafts',{keyPath:'key'});
   request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('DRAFT_STORAGE_BLOCKED'));
  }).catch(e=>{database=null;throw e;});
  return database;
 }
 function transact(mode,action){
  const operation=serial.then(async()=>{const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction('drafts',mode);let value;try{action(tx.objectStore('drafts'),v=>value=v);}catch(e){reject(e);return;}tx.oncomplete=()=>resolve(value);tx.onerror=tx.onabort=()=>reject(tx.error||Error('DRAFT_STORAGE_FAILED'));});});
  serial=operation.catch(()=>{});return operation;
 }
 function remove(key){return transact('readwrite',store=>store.delete(key));}
 function clearForUser(userId){
  generations.set(userId,(generations.get(userId)||0)+1);const userPrefix=prefix+userId+':';try{for(const key of Object.keys(sessionStorage))if(key.startsWith(userPrefix))sessionStorage.removeItem(key);}catch{}
  return transact('readwrite',store=>{const r=store.openCursor();r.onsuccess=()=>{const c=r.result;if(c){if(String(c.key).startsWith(userPrefix))c.delete();c.continue();}};}).catch(()=>{});
 }
 function markSaved(form){
  if(!form)return;form.dataset.saved='1';form.dataset.dirty='';
  const key=form.dataset.draftKey;if(key){try{sessionStorage.removeItem(key);}catch{}remove(key).catch(()=>{});}
 }
 function attach(form,{userId,key,onSubmitting,onFinished}){
  if(!form||form.dataset.guarded)return;form.dataset.guarded='1';
  const generation=generations.get(userId)||0;const eligible=!!key&&!form.querySelector('input[type="password"]');
  const storageKey=eligible?prefix+userId+':'+key:'';form.dataset.draftKey=storageKey;
  const controls=()=>[...form.querySelectorAll('input,select,textarea')].filter(e=>!['password','file','hidden','submit','button'].includes(e.type));
  const photoControls=()=>[...form.querySelectorAll('input[type="file"]')];
  const identify=(e,n)=>e.closest('[data-check-tenant]')?'tenant:'+e.closest('[data-check-tenant]').dataset.checkTenant+':'+e.dataset.field:e.name||e.id||'field-'+n;
  const status=(text,state='ready')=>{if(!form.isConnected)return;let note=form.querySelector('[data-draft-status]');if(!note){note=document.createElement('p');note.className='form-status';note.dataset.draftStatus='1';note.setAttribute('role','status');form.querySelector('.modal-body')?.prepend(note);}note.textContent=text;note.dataset.state=state;};
  let restoring=!!storageKey,revision=0,debounce;
  const signature=photos=>JSON.stringify(photos.map(p=>[p.key,p.files.map(f=>[f.name,f.size,f.lastModified])]));
  function snapshot(){
   const photos=photoControls().map((e,n)=>({key:identify(e,n),files:[...e.files]}));
   return {key:storageKey,at:Date.now(),fields:controls().map((e,n)=>({key:identify(e,n),value:e.value,checked:e.checked})),photos,photoSignature:signature(photos),requestId:form.dataset.requestId};
  }
  function save(){
   clearTimeout(debounce);if(!storageKey||restoring||form.dataset.saved==='1'||generation!==(generations.get(userId)||0))return Promise.resolve();
   const record=snapshot(),rev=++revision,count=record.photos.reduce((n,p)=>n+p.files.length,0);
   try{sessionStorage.setItem(storageKey,JSON.stringify({...record,photos:undefined}));}catch{}
   status('Сохраняем черновик на устройстве…','saving');
   const bytes=record.photos.reduce((n,p)=>n+p.files.reduce((sum,f)=>sum+f.size,0),0);
   const stored=bytes>80_000_000?Promise.reject(Error('DRAFT_TOO_LARGE')):transact('readwrite',store=>{if(form.dataset.saved!=='1'&&generation===(generations.get(userId)||0))store.put(record);});
   return stored.then(()=>{if(rev===revision&&form.dataset.saved!=='1')status(`Не отправлено. Черновик сохранён на устройстве на 24 часа${count?'; фото: '+count:''}. Для отправки нажмите кнопку сохранения.`);}).catch(()=>{if(rev===revision&&form.dataset.saved!=='1')status('Не удалось сохранить черновик с фото на устройстве. Не закрывайте форму до успешной отправки.','error');});
  }
  const changed=event=>{if(restoring)return;form.dataset.dirty='1';if(!storageKey)return;if(event.type==='change')save();else{try{const r=snapshot();sessionStorage.setItem(storageKey,JSON.stringify({...r,photos:undefined}));}catch{}clearTimeout(debounce);debounce=setTimeout(save,200);}};
  form.addEventListener('input',changed);form.addEventListener('change',changed);
  const handler=form.onsubmit;
  if(handler)form.onsubmit=async event=>{
   event.preventDefault();if(restoring||form.dataset.busy==='1'||form.dataset.saved==='1')return;
   form.dataset.busy='1';form.setAttribute('aria-busy','true');form.inert=true;save();onSubmitting(form);
   const buttons=[...form.querySelectorAll('[type="submit"]')],labels=buttons.map(b=>b.textContent);buttons.forEach(b=>{b.disabled=true;b.textContent='Сохраняем…';});
   try{await handler(event);}finally{
    form.dataset.busy='';form.removeAttribute('aria-busy');form.inert=false;onFinished(form);
    buttons.forEach((b,n)=>{b.disabled=form.dataset.saved==='1';b.textContent=form.dataset.saved==='1'?'Сохранено':labels[n];});
    if(form.isConnected&&form.dataset.saved==='1')status('Данные сохранены. Можно закрыть форму и обновить список.');
   }
  };
  const requestId=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
  if(!storageKey){form.dataset.requestId=requestId();return;}
  form.inert=true;form.dataset.restoring='1';status('Проверяем сохранённый черновик…','saving');
  const locked=[...form.querySelectorAll('input,select,textarea,button')].map(e=>[e,e.disabled]);locked.forEach(([e])=>e.disabled=true);const unlock=()=>locked.forEach(([e,disabled])=>e.disabled=disabled);
  (async()=>{
   try{
    let textDraft;try{textDraft=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{}
    let diskDraft;try{diskDraft=await transact('readonly',(store,done)=>{const r=store.get(storageKey);r.onsuccess=()=>done(r.result);});}catch{}
    unlock();if(!form.isConnected)return;
    const draft=textDraft&&(!diskDraft||textDraft.at>=diskDraft.at)?textDraft:diskDraft;
    if(draft&&Date.now()-draft.at<ttl&&Array.isArray(draft.fields)){
     if(draft.requestId)form.dataset.requestId=draft.requestId;
     const restore=()=>{controls().forEach((e,n)=>{const value=draft.fields.find(f=>f.key===identify(e,n));if(value){if(e.type==='checkbox'||e.type==='radio')e.checked=!!value.checked;else if(!e.disabled)e.value=value.value;}});};
     restore();form.querySelector('[name="buildingId"]')?.dispatchEvent(new Event('change',{bubbles:true}));restore();
     let count=0;const photosMatch=diskDraft&&Date.now()-diskDraft.at<ttl&&(!draft.photoSignature||draft.photoSignature===diskDraft.photoSignature);
     if(photosMatch)for(const [n,input]of photoControls().entries()){
      const entry=diskDraft.photos?.find(p=>p.key===identify(input,n));if(!entry)continue;const transfer=new DataTransfer();for(const file of entry.files)transfer.items.add(file);input.files=transfer.files;count+=entry.files.length;
     }
     const expected=draft.photoSignature&&JSON.parse(draft.photoSignature).some(p=>p[1].length);
     form.dataset.dirty='1';status(expected&&!photosMatch?'Текст восстановлен. Фото не были сохранены — выберите их повторно.':`Не отправлено. Черновик восстановлен${count?'; фото: '+count:''}. Проверьте данные и нажмите сохранение.`,expected&&!photosMatch?'error':'ready');
     form.dispatchEvent(new Event('draftrestored'));
    }else if(draft){try{sessionStorage.removeItem(storageKey);}catch{}remove(storageKey).catch(()=>{});}
   }catch{status('Черновик восстановлен не полностью. Проверьте поля и выбранные фото.','error');}
   finally{unlock();if(form.dataset.dirty!=='1')form.querySelector('[data-draft-status]')?.remove();if(!form.dataset.requestId)form.dataset.requestId=requestId();restoring=false;form.dataset.restoring='';form.inert=false;}
  })();
 }
 window.addEventListener('beforeunload',e=>{if(document.querySelector('form[data-dirty="1"]')){e.preventDefault();e.returnValue='';}});
 return {attach,markSaved,clearForUser};
})();
