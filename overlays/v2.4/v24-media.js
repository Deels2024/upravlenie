'use strict';
(function(){
  const rawFilesToPayload=filesToPayload;
  async function optimize(file){
    if(!file||!file.type?.startsWith('image/'))return fileToDataURL(file);
    if(typeof createImageBitmap!=='function')return fileToDataURL(file);
    const bitmap=await createImageBitmap(file);const max=1920,scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height)),w=Math.max(1,Math.round(bitmap.width*scale)),h=Math.max(1,Math.round(bitmap.height*scale));
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;canvas.getContext('2d',{alpha:false}).drawImage(bitmap,0,0,w,h);bitmap.close?.();
    let quality=.84,blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',quality));while(blob&&blob.size>3_600_000&&quality>.55){quality-=.08;blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',quality));}
    if(!blob)throw new Error('Не удалось подготовить фотографию');
    return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
  }
  filesToPayload=async function(input){const files=[...(input?.files||[])];if(files.length>5)throw new Error('Не более 5 фотографий за один раз');const out=[];for(const f of files){if(!allowedPhotoTypes.has(f.type))throw new Error('Разрешены JPG, PNG и WEBP');const data=await optimize(f);const approx=Math.ceil((String(data).length-(String(data).indexOf(',')+1))*3/4);if(approx>4_000_000)throw new Error('После оптимизации фотография всё ещё больше 4 МБ');out.push({name:String(f.name||'photo').replace(/\.[^.]+$/,'')+'.jpg',type:'image/jpeg',data});}return out;};
  window.v24Media={rawFilesToPayload};
})();
