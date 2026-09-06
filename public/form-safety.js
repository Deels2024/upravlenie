'use strict';
const FormSafety=(()=>{
 const prefix='owner-draft:';
 function clearForUser(userId){try{for(const key of Object.keys(sessionStorage))if(key.startsWith(prefix+userId+':'))sessionStorage.removeItem(key);}catch{}}
 function markSaved(form){if(!form)return;form.dataset.saved='1';form.dataset.dirty='';try{if(form.dataset.draftKey)sessionStorage.removeItem(form.dataset.draftKey);}catch{}}
 function attach(form,{userId,key,onSubmitting,onFinished}){
  if(!form||form.dataset.guarded)return;form.dataset.guarded='1';
  const eligible=!!key&&!form.querySelector('input[type="password"]');
  const storageKey=eligible?prefix+userId+':'+key:'';form.dataset.draftKey=storageKey;
  const controls=()=>[...form.querySelectorAll('input,select,textarea')].filter(e=>!['password','file','hidden','submit','button'].includes(e.type));
  const identify=(e,n)=>e.name||e.id||'field-'+n;
  const save=()=>{if(!storageKey)return;try{const fields=controls().map((e,n)=>({key:identify(e,n),value:e.value,checked:e.checked}));sessionStorage.setItem(storageKey,JSON.stringify({at:Date.now(),fields,requestId:form.dataset.requestId}));}catch{}};
  form.addEventListener('input',()=>{form.dataset.dirty='1';save();});
  form.addEventListener('change',()=>{form.dataset.dirty='1';save();});
  if(storageKey){try{
   const draft=JSON.parse(sessionStorage.getItem(storageKey)||'null');
   if(draft&&Date.now()-draft.at<86400000&&Array.isArray(draft.fields)){
    if(draft.requestId)form.dataset.requestId=draft.requestId;
    const restore=()=>{controls().forEach((e,n)=>{const v=draft.fields.find(f=>f.key===identify(e,n));if(v){if(e.type==='checkbox'||e.type==='radio')e.checked=!!v.checked;else e.value=v.value;}});};
    restore();form.querySelector('[name="buildingId"]')?.dispatchEvent(new Event('change',{bubbles:true}));restore();form.dataset.dirty='1';
    const note=document.createElement('p');note.className='form-status';note.textContent='Текстовый черновик восстановлен. Фотографии после перезагрузки нужно выбрать заново.';form.querySelector('.modal-body')?.prepend(note);
   }
  }catch{}}
  if(!form.dataset.requestId)form.dataset.requestId=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
  const handler=form.onsubmit;
  if(handler)form.onsubmit=async event=>{
   event.preventDefault();if(form.dataset.busy==='1'||form.dataset.saved==='1')return;
   form.dataset.busy='1';form.setAttribute('aria-busy','true');form.inert=true;save();onSubmitting(form);
   const buttons=[...form.querySelectorAll('[type="submit"]')],labels=buttons.map(b=>b.textContent);buttons.forEach(b=>{b.disabled=true;b.textContent='Сохраняем…';});
   try{await handler(event);}finally{
    form.dataset.busy='';form.removeAttribute('aria-busy');form.inert=false;onFinished(form);
    buttons.forEach((b,n)=>{b.disabled=form.dataset.saved==='1';b.textContent=form.dataset.saved==='1'?'Сохранено':labels[n];});
    if(form.isConnected&&form.dataset.saved==='1'){
     const note=document.createElement('p');note.className='form-status';note.setAttribute('role','status');note.textContent='Данные сохранены. Можно закрыть форму и обновить список.';form.querySelector('.modal-body')?.prepend(note);
    }
   }
  };
 }
 window.addEventListener('beforeunload',e=>{if(document.querySelector('form[data-dirty="1"]')){e.preventDefault();e.returnValue='';}});
 return {attach,markSaved,clearForUser};
})();
