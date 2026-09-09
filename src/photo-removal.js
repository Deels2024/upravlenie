'use strict';
// Remove references together; reports and documented defects keep their mandatory evidence.
function removePhoto(item,id,kind){
 const photo=item.photos.find(p=>p.id===id);if(!photo)return null;
 const next=structuredClone(item),drop=ids=>(ids||[]).filter(pid=>pid!==id);
 if(kind==='issue'){
  if((next.reports||[]).some(r=>(r.photos||[]).includes(id)&&drop(r.photos).length===0))throw Error('REQUIRED_REPORT_PHOTO');
  if(next.sourceInspectionId&&photo.kind==='problem'&&next.photos.filter(p=>p.kind==='problem').length<=1)throw Error('REQUIRED_PROBLEM_PHOTO');
  next.reports.forEach(r=>r.photos=drop(r.photos));next.acceptanceHistory.forEach(r=>r.photos=drop(r.photos));
 }else{
  if((next.exteriorPhotoIds||[]).includes(id)&&drop(next.exteriorPhotoIds).length<3)throw Error('REQUIRED_INSPECTION_PHOTOS');
  if((next.tenantChecks||[]).some(c=>c.status==='problem'&&(c.photoIds||[]).includes(id)&&!drop(c.photoIds).length))throw Error('REQUIRED_INSPECTION_PHOTOS');
  if((next.buildingFinding?.photoIds||[]).includes(id)&&!drop(next.buildingFinding.photoIds).length)throw Error('REQUIRED_INSPECTION_PHOTOS');
  next.exteriorPhotoIds=drop(next.exteriorPhotoIds);next.tenantChecks.forEach(c=>c.photoIds=drop(c.photoIds));if(next.buildingFinding)next.buildingFinding.photoIds=drop(next.buildingFinding.photoIds);
 }
 next.photos=next.photos.filter(p=>p.id!==id);return {next,photo};
}
module.exports={removePhoto};
