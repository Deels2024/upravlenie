'use strict';

const v23BaseNavItems=navItems;
const v23BaseRenderView=renderView;
const v23BaseRenderDashboard=renderDashboard;

function v23Date(value){if(!value)return null;const d=new Date(value.length===10?value+'T12:00:00':value);return Number.isNaN(d.getTime())?null:d;}
function v23DateKey(value){const d=v23Date(value);if(!d)return'';return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}
function v23DaysFromNow(value){const d=v23Date(value);if(!d)return null;const a=new Date();a.setHours(0,0,0,0);d.setHours(0,0,0,0);return Math.round((d-a)/86400000);}
function v23MonthLabel(d){return new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'}).format(d).replace(/^./,x=>x.toUpperCase());}
function v23Building(id){return (app.data.buildings||[]).find(b=>b.id===id)||(app.data.archivedBuildings||[]).find(b=>b.id===id);}
