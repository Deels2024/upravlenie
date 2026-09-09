'use strict';
const PhotoInputs=(()=>{
 const forms=new WeakMap(),prepared=new WeakMap();
 const types=new Set(['image/jpeg','image/png','image/webp']);
 const setFiles=(input,files)=>{const dt=new DataTransfer();files.forEach(f=>dt.items.add(f));input.files=dt.files;};
 function attach(form){
  if(!form||forms.has(form))return;
  const inputs=new Map();
  const release=row=>row.urls.forEach(url=>URL.revokeObjectURL(url));
  function render(input){
   const row=inputs.get(input);release(row);row.urls=[];row.files=[...input.files];row.preview.replaceChildren();
   row.files.forEach((file,index)=>{
    const tile=document.createElement('div');tile.className='selected-photo';
    const img=document.createElement('img'),url=URL.createObjectURL(file);row.urls.push(url);img.src=url;img.alt=`Выбранное фото ${index+1}`;
    const name=document.createElement('span');name.textContent=file.name;
    const remove=document.createElement('button');remove.type='button';remove.className='btn btn-ghost';remove.textContent='Убрать';remove.setAttribute('aria-label','Убрать фото '+(index+1));
    remove.onclick=()=>{setFiles(input,[...input.files].filter((_,n)=>n!==index));render(input);const event=new Event('change',{bubbles:true});event.photoSelectionSet=true;input.dispatchEvent(event);};
    tile.append(img,name,remove);row.preview.append(tile);
   });
  }
  function scan(){
   for(const [input,row]of inputs)if(!form.contains(input)){release(row);inputs.delete(input);}
   form.querySelectorAll('input[type="file"]').forEach(input=>{
    if(inputs.has(input))return;const preview=document.createElement('div');preview.className='photo-selection';input.after(preview);inputs.set(input,{preview,files:[],urls:[]});render(input);
   });
  }
  form.addEventListener('change',event=>{
   const input=event.target;if(input.type!=='file')return;scan();if(event.photoSelectionSet)return;
   const row=inputs.get(input),incoming=[...input.files];
   const combined=input.multiple?[...row.files,...incoming]:incoming;
   const unique=combined.filter((f,n,all)=>all.findIndex(x=>x.name===f.name&&x.size===f.size&&x.lastModified===f.lastModified)===n);
   if(unique.length>(input.multiple?5:1)||unique.some(f=>!types.has(f.type)||f.size>40_000_000)){
    setFiles(input,row.files);toast('Выберите до 5 фото JPG, PNG или WEBP, каждое до 40 МБ. Для HEIC сохраните копию в JPEG.');
   }else setFiles(input,unique);
   render(input);
  },true);
  form.addEventListener('draftrestored',()=>{scan();for(const input of inputs.keys())render(input);});
  const observer=new MutationObserver(scan);scan();observer.observe(form,{childList:true,subtree:true});
  forms.set(form,{dispose(){observer.disconnect();for(const row of inputs.values())release(row);}});
 }
 async function compress(file){
  if(!types.has(file.type))throw Error('Выберите JPG, PNG или WEBP. Для HEIC сохраните копию в JPEG.');
  if(file.size>40_000_000)throw Error('Фото должно быть меньше 40 МБ');
  if(file.size<=1_500_000)return file;
  const url=URL.createObjectURL(file),img=new Image();
  try{
   await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('Не удалось прочитать фото. Выберите другой снимок.'));img.src=url;});
   const scale=Math.min(1,2400/Math.max(img.naturalWidth,img.naturalHeight));
   const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
   const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(img,0,0,canvas.width,canvas.height);
   for(const quality of [.86,.7,.5]){
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
    if(blob&&blob.size<=4_000_000)return new File([blob],file.name.replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg',lastModified:file.lastModified});
   }
   throw Error('Не удалось уменьшить фото. Выберите другой снимок.');
  }finally{URL.revokeObjectURL(url);}
 }
 async function prepare(input){
  const files=[...(input?.files||[])];if(files.length>5)throw Error('Не более 5 фотографий за один раз');
  const out=[];for(const file of files){if(!prepared.has(file))prepared.set(file,compress(file).catch(err=>{prepared.delete(file);throw err;}));out.push(await prepared.get(file));}return out;
 }
 return {attach,prepare,dispose:form=>forms.get(form)?.dispose()};
})();
