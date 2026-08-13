'use strict';
function findObjectCardRecord(id){return [...(app.data.buildings||[]),...(app.data.archivedBuildings||[])].find(b=>b.id===id);}
function bindBuildingActions(){
  $$('[data-building-open]').forEach(x=>x.onclick=e=>{e.stopPropagation();openBuilding(x.dataset.buildingOpen);});
  $$('[data-building-edit]').forEach(x=>x.onclick=e=>{e.stopPropagation();const b=findObjectCardRecord(x.dataset.buildingEdit);if(b)openBuildingForm(b);});
  $$('[data-building-archive]').forEach(x=>x.onclick=e=>{e.stopPropagation();const b=findObjectCardRecord(x.dataset.buildingArchive);if(b)openBuildingArchiveConfirm(b);});
  $$('[data-building-restore]').forEach(x=>x.onclick=e=>{e.stopPropagation();openBuilding(x.dataset.buildingRestore);});
}
