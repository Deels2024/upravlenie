'use strict';
const expenseFields=['electricity','water','heat','cleaning','security','repair'];
function validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
function tenantPayload(body,previous={}){
 const value={...previous,...body},out={};
 for(const [key,max] of Object.entries({company:100,legalName:140,unit:50,contact:100,phone:50,ownerResponsible:100,note:500}))out[key]=String(value[key]||'').trim().slice(0,max);
 if(!out.company)throw Error('REQUIRED_FIELDS');
 out.area=Number(value.area);out.floor=Number(value.floor||0);
 if(!Number.isFinite(out.area)||out.area<=0||out.area>1e9)throw Error('BAD_AREA');
 if(!Number.isInteger(out.floor)||out.floor< -10||out.floor>300)throw Error('BAD_FLOOR');
 for(const key of ['startDate','endDate']){out[key]=String(value[key]||'');if(out[key]&&!validDate(out[key]))throw Error('BAD_DATE');}
 if(out.startDate&&out.endDate&&out.endDate<out.startDate)throw Error('BAD_DATE_RANGE');
 return out;
}
function expensePayload(body,previous={}){
 const value={...previous,...body},out={month:String(value.month||''),note:String(value.note||'').trim().slice(0,500)};
 if(out.month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(out.month))throw Error('BAD_MONTH');
 if(!out.month&&!previous.id)throw Error('BAD_MONTH');
 let cents=0;
 for(const key of expenseFields){const n=Number(value[key]||0);if(!Number.isFinite(n)||n<0||n>1e12)throw Error('BAD_COST');const rounded=Math.round(n*100);out[key]=rounded/100;cents+=rounded;}
 out.total=cents/100;return out;
}
module.exports={validDate,tenantPayload,expensePayload};
