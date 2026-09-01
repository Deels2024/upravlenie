'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { DatabaseSync } = require('node:sqlite');

const config = require('./src/config')(__dirname);
const {PORT,HOST,PROD,COOKIE_SECURE,PUBLIC_DIR,DATA_FILE,PRIVATE_ROOT,DB_FILE}=config;
const ISSUE_UPLOAD_DIR = path.join(PRIVATE_ROOT, 'issues');
const INSPECTION_UPLOAD_DIR = path.join(PRIVATE_ROOT, 'inspections');
fs.mkdirSync(ISSUE_UPLOAD_DIR, { recursive:true, mode:0o700 });
fs.mkdirSync(INSPECTION_UPLOAD_DIR, { recursive:true, mode:0o700 });

const SESSION_TTL = 1000 * 60 * 60 * 8;
const sessions = new Map();
const loginAttempts = new Map();

const OWNER_LOGIN = String(process.env.OWNER_LOGIN || 'owner').trim().toLowerCase();
const OWNER_PASSWORD = String(process.env.OWNER_PASSWORD || '');

const PERMISSIONS = [
  'dashboard_view','buildings_view','tenants_view','tenants_manage','issues_view','issues_edit',
  'inspections_view','inspections_create','equipment_view','metrics_view','expenses_view',
  'staff_manage','security_view'
];
const ROLE_DEFAULTS = {
  admin:['dashboard_view','buildings_view','tenants_view','tenants_manage','issues_view','issues_edit','inspections_view','inspections_create','equipment_view','metrics_view','expenses_view','security_view'],
  inspector:['dashboard_view','buildings_view','tenants_view','issues_view','inspections_view','inspections_create'],
  manager:['dashboard_view','buildings_view','tenants_view','issues_view','issues_edit','inspections_view','equipment_view','metrics_view'],
  technician:['dashboard_view','buildings_view','issues_view','issues_edit','equipment_view']
};
const STAFF_ROLES = ['admin','inspector','manager','technician'];

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 210000, 32, 'sha256').toString('hex');
}
function createStoredUser(id, role, email, password, extra={}) {
  const salt=crypto.randomBytes(16).toString('hex');
  return {id,role,email:String(email).toLowerCase(),salt,passwordHash:hashPassword(password,salt),active:true,createdAt:new Date().toISOString(),...extra};
}
function setStoredPassword(user,password){const salt=crypto.randomBytes(16).toString('hex');user.salt=salt;user.passwordHash=hashPassword(String(password),salt);}
function generateTempPassword(){
  return 'OP-'+crypto.randomBytes(8).toString('base64url')+'!7';
}

function loadSeedData(){
  try{
    if(fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));
  }catch(e){ console.error('Failed to load seed data:',e.message); }
  return {buildings:[],tenants:[],issues:[],equipment:[],metrics:[],expenses:[],securityLog:[]};
}

fs.mkdirSync(path.dirname(DB_FILE),{recursive:true,mode:0o700});
const sqlite = new DatabaseSync(DB_FILE);
sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
sqlite.exec('CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL, updated_at TEXT NOT NULL)');
let db = null;

function initStorage(){
  const row=sqlite.prepare('SELECT data FROM app_state WHERE id=1').get();
  if(row?.data){ db=JSON.parse(row.data); }
  else { db=loadSeedData(); persist(); }
}

function persist(){
  if(!db) return;
  sqlite.prepare('INSERT INTO app_state(id,data,updated_at) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at')
    .run(JSON.stringify(db), new Date().toISOString());
}
function nowIso(){ return new Date().toISOString(); }
function dateOnly(v=nowIso()){ return String(v).slice(0,10); }
function addDaysIso(v,days){ const d=new Date(v); d.setDate(d.getDate()+Number(days||0)); return d.toISOString().slice(0,10); }
function logSecurity(actor,event){
  if(!Array.isArray(db.securityLog)) db.securityLog=[];
  db.securityLog.unshift({at:nowIso().replace('T',' ').slice(0,16),actor:String(actor||'Ð¡Ð¸ÑÑÐµÐ¼Ð°').slice(0,100),event:String(event||'').slice(0,220)});
  db.securityLog=db.securityLog.slice(0,300);
}
function notifyUser(userId,title,text,meta={}){
  const u=findUser(userId);if(!u||u.active===false)return;
  db.notifications.unshift({id:'n'+crypto.randomBytes(5).toString('hex'),userId:u.id,title:String(title||'Ð£Ð²ÐµÐ´Ð¾Ð¼Ð»ÐµÐ½Ð¸Ðµ').slice(0,120),text:String(text||'').slice(0,300),at:nowIso(),readAt:'',issueId:meta.issueId||'',buildingId:meta.buildingId||'',inspectionId:meta.inspectionId||''});
  db.notifications=db.notifications.slice(0,1000);
}
function uniqueStrings(arr,allowed=null){
  const out=[...new Set((Array.isArray(arr)?arr:[]).map(String))];
  return allowed?out.filter(x=>allowed.includes(x)):out;
}

function ensureIssueShape(item){
  if(!Array.isArray(item.photos)) item.photos=[];
  if(!Array.isArray(item.reports)) item.reports=[];
  if(!Array.isArray(item.timeline)) item.timeline=[];
  if(!Array.isArray(item.acceptanceHistory)) item.acceptanceHistory=[];
  if(!('resolvedBy' in item)) item.resolvedBy='';
  if(!('resolvedAt' in item)) item.resolvedAt='';
  if(!('tenantAcceptedAt' in item)) item.tenantAcceptedAt='';
  if(!('tenantAcceptedBy' in item)) item.tenantAcceptedBy='';
  if(!('responsibleUserId' in item)) item.responsibleUserId='';
  if(!('curatorUserId' in item)) item.curatorUserId='';
  if(!('sourceInspectionId' in item)) item.sourceInspectionId='';
  return item;
}
function ensureInspectionShape(item){
  if(!Array.isArray(item.photos)) item.photos=[];
  if(!Array.isArray(item.exteriorPhotoIds)) item.exteriorPhotoIds=[];
  if(!Array.isArray(item.tenantChecks)) item.tenantChecks=[];
  if(!Array.isArray(item.createdIssueIds)) item.createdIssueIds=[];
  return item;
}
function ensureDataShape(){
  for(const key of ['buildings','tenants','issues','equipment','metrics','expenses','securityLog']) if(!Array.isArray(db[key])) db[key]=[];
  db.issues.forEach(ensureIssueShape);
  if(!Array.isArray(db.users)) db.users=[];
  if(!Array.isArray(db.inspections)) db.inspections=[];
  db.inspections.forEach(ensureInspectionShape);
  if(!Array.isArray(db.inspectionPlans)) db.inspectionPlans=[];
  if(!Array.isArray(db.routingRules)) db.routingRules=[];
  if(!Array.isArray(db.notifications)) db.notifications=[];

  let owner=db.users.find(u=>u.role==='owner')||db.users.find(u=>u.id==='u-owner');
  if(!owner){
    if(!OWNER_PASSWORD) throw new Error('Startup refused: OWNER_PASSWORD environment variable is required for first start');
    owner=createStoredUser('u-owner','owner',OWNER_LOGIN,OWNER_PASSWORD,{name:'Ð¡Ð¾Ð±ÑÑÐ²ÐµÐ½Ð½Ð¸Ðº',permissions:['*'],buildingIds:db.buildings.filter(b=>!b.archivedAt).map(b=>b.id)});
    db.users.push(owner);
  }
  owner.id=owner.id||'u-owner';owner.role='owner';owner.email=OWNER_LOGIN;owner.active=true;owner.permissions=['*'];
  if(OWNER_PASSWORD)setStoredPassword(owner,OWNER_PASSWORD);
  for(const u of db.users){
    if(typeof u.active!=='boolean') u.active=true;
    if(!Array.isArray(u.permissions)) u.permissions=u.role==='owner'?['*']:(ROLE_DEFAULTS[u.role]||[]);
    if(!Array.isArray(u.buildingIds)) u.buildingIds=[];
    if(!('lastLoginAt' in u)) u.lastLoginAt='';
    if(!('firedAt' in u)) u.firedAt='';
  }
  if(PROD&&!OWNER_PASSWORD) throw new Error('Production startup refused: OWNER_PASSWORD environment variable is required');

  // One-time production cleanup: remove legacy/test employee accounts while preserving
  // owner, tenants, buildings and all operational records.
  if(!db.meta||typeof db.meta!=='object')db.meta={};
  if(!db.meta.staffCleanStartV1){
    const removedStaff=db.users.filter(u=>STAFF_ROLES.includes(u.role));
    const removedIds=new Set(removedStaff.map(u=>u.id));
    db.users=db.users.filter(u=>!removedIds.has(u.id));
    for(const building of db.buildings){
      if(removedIds.has(building.managerUserId)){building.managerUserId='';building.manager='';}
    }
    for(const issue of db.issues){
      if(removedIds.has(issue.responsibleUserId)){
        issue.responsibleUserId='';issue.responsible='';
        if(issue.status==='assigned')issue.status='new';
      }
      if(removedIds.has(issue.curatorUserId)){issue.curatorUserId='';issue.curator='';}
    }
    for(const plan of db.inspectionPlans)if(removedIds.has(plan.inspectorUserId))plan.inspectorUserId='';
    db.routingRules=db.routingRules.filter(rule=>!removedIds.has(rule.responsibleUserId));
    db.notifications=db.notifications.filter(note=>!removedIds.has(note.userId));
    db.meta.staffCleanStartV1={at:nowIso(),removed:removedStaff.length};
    if(removedStaff.length)logSecurity(owner.name,`Удалены тестовые учётные записи сотрудников: ${removedStaff.length}. Объекты и рабочая история сохранены.`);
  }

  const nameToUser=new Map(db.users.map(u=>[u.name,u]));
  for(const b of db.buildings){
    if(!b.managerUserId){ const u=nameToUser.get(b.manager); if(u) b.managerUserId=u.id; }
  }
  for(const i of db.issues){
    if(!i.responsibleUserId && i.responsible){ const u=nameToUser.get(i.responsible); if(u) i.responsibleUserId=u.id; }
    if(!i.curatorUserId && i.curator){ const u=nameToUser.get(i.curator); if(u) i.curatorUserId=u.id; }
  }

  for(const b of db.buildings){
    if(!('archivedAt' in b))b.archivedAt='';
    if(!db.inspectionPlans.some(p=>p.buildingId===b.id)) db.inspectionPlans.push({buildingId:b.id,frequencyDays:7,inspectorUserId:'',active:true,lastInspectionAt:'',nextDue:addDaysIso(nowIso(),7)});
  }
  persist();
}


function findUser(id){ return db.users.find(u=>u.id===id); }
function safeUser(u){
  if(!u) return null;
  return {id:u.id,role:u.role,email:u.email,name:u.name,tenantId:u.tenantId||null,active:u.active!==false,permissions:u.role==='owner'?['*']:uniqueStrings(u.permissions,PERMISSIONS),buildingIds:uniqueStrings(u.buildingIds),lastLoginAt:u.lastLoginAt||''};
}
function publicUser(u){
  const x=safeUser(u); return {...x,createdAt:u.createdAt||'',firedAt:u.firedAt||''};
}
function hasPerm(user,p){ return !!user && (user.role==='owner' || (Array.isArray(user.permissions)&&user.permissions.includes(p))); }
function isTenant(user){ return user?.role==='tenant'; }
function staffUser(user){ return user && user.role!=='tenant'; }
function allowedBuildingSet(user){
  if(user.role==='owner') return new Set(db.buildings.map(b=>b.id));
  if(user.role==='tenant'){
    const t=db.tenants.find(x=>x.id===user.tenantId); return new Set(t?[t.buildingId]:[]);
  }
  return new Set(user.buildingIds||[]);
}
function canAccessBuilding(user,buildingId){ return allowedBuildingSet(user).has(buildingId); }
function visibleBuildings(user){
  if(user.role==='tenant') return db.buildings.filter(b=>!b.archivedAt&&canAccessBuilding(user,b.id));
  if(!hasPerm(user,'buildings_view') && user.role!=='owner') return [];
  return db.buildings.filter(b=>!b.archivedAt&&canAccessBuilding(user,b.id));
}
function visibleTenants(user){
  if(user.role==='tenant') return db.tenants.filter(t=>t.id===user.tenantId);
  if(!hasPerm(user,'tenants_view') && user.role!=='owner') return [];
  return db.tenants.filter(t=>canAccessBuilding(user,t.buildingId));
}
function canSeeIssue(user,issue){
  if(user.role==='tenant') return issue.tenantId===user.tenantId;
  if(!hasPerm(user,'issues_view') && user.role!=='owner') return false;
  if(!canAccessBuilding(user,issue.buildingId)) return false;
  if(user.role==='technician') return issue.responsibleUserId===user.id || issue.responsible===user.name;
  return true;
}
function visibleIssues(user){ return db.issues.filter(i=>canSeeIssue(user,i)); }
function canEditIssue(user,issue){ return staffUser(user) && hasPerm(user,'issues_edit') && canSeeIssue(user,issue); }
function visibleInspections(user){
  if(isTenant(user) || (!hasPerm(user,'inspections_view')&&user.role!=='owner')) return [];
  return db.inspections.filter(i=>canAccessBuilding(user,i.buildingId));
}

const ALLOWED_IMAGE_TYPES=new Map([['image/jpeg','.jpg'],['image/png','.png'],['image/webp','.webp']]);
function decodeImagePayload(photo){
  const mime=String(photo?.type||'').toLowerCase();
  if(!ALLOWED_IMAGE_TYPES.has(mime)) throw new Error('BAD_IMAGE_TYPE');
  const data=String(photo?.data||''); const prefix=`data:${mime};base64,`;
  if(!data.startsWith(prefix)) throw new Error('BAD_IMAGE_DATA');
  const buf=Buffer.from(data.slice(prefix.length),'base64');
  if(!buf.length || buf.length>4_000_000) throw new Error('IMAGE_TOO_LARGE');
  return {mime,buf,ext:ALLOWED_IMAGE_TYPES.get(mime)};
}
function savePhotos(dirRoot,entityId,photoStore,photos,metaBase={}){
  const list=Array.isArray(photos)?photos:[];
  if(list.length>5) throw new Error('TOO_MANY_IMAGES');
  const dir=path.join(dirRoot,entityId); fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const saved=[];
  for(const photo of list){
    const {mime,buf,ext}=decodeImagePayload(photo);
    const id='p'+crypto.randomBytes(8).toString('hex'); const file=id+ext;
    fs.writeFileSync(path.join(dir,file),buf,{mode:0o600});
    const meta={id,originalName:String(photo?.name||'photo').slice(0,120),mime,at:nowIso(),file,...metaBase};
    photoStore.push(meta); saved.push(meta);
  }
  return saved;
}
function saveIssuePhotos(issue,photos,kind,actor){ return savePhotos(ISSUE_UPLOAD_DIR,issue.id,issue.photos,photos,{kind,actor:String(actor||'').slice(0,100)}); }
function publicIssuePhoto(meta,issueId){ const {file,...safe}=meta; return {...safe,url:`/api/issue-media/${encodeURIComponent(issueId)}/${encodeURIComponent(meta.id)}`}; }
function publicIssue(item){
  ensureIssueShape(item);
  const mapIds=ids=>(ids||[]).map(id=>{const p=item.photos.find(x=>x.id===id);return p?publicIssuePhoto(p,item.id):null;}).filter(Boolean);
  return {...item,photos:item.photos.map(p=>publicIssuePhoto(p,item.id)),reports:item.reports.map(r=>({...r,photos:mapIds(r.photos)})),acceptanceHistory:item.acceptanceHistory.map(a=>({...a,photos:mapIds(a.photos)}))};
}
function publicInspectionPhoto(meta,inspectionId){ const {file,...safe}=meta; return {...safe,url:`/api/inspection-media/${encodeURIComponent(inspectionId)}/${encodeURIComponent(meta.id)}`}; }
function publicInspection(item){
  ensureInspectionShape(item);
  const mapIds=ids=>(ids||[]).map(id=>{const p=item.photos.find(x=>x.id===id);return p?publicInspectionPhoto(p,item.id):null;}).filter(Boolean);
  return {...item,photos:undefined,exteriorPhotos:mapIds(item.exteriorPhotoIds),tenantChecks:item.tenantChecks.map(c=>({...c,photos:mapIds(c.photoIds)})),buildingFinding:item.buildingFinding?{...item.buildingFinding,photos:mapIds(item.buildingFinding.photoIds)}:null};
}

function routeUser(buildingId,category){
  const rules=db.routingRules.filter(r=>r.active!==false && r.category===category && (r.buildingId===buildingId||r.buildingId==='*'));
  rules.sort((a,b)=>(b.buildingId===buildingId)-(a.buildingId===buildingId));
  let u=rules.length?findUser(rules[0].responsibleUserId):null;
  if(!u || u.active===false){ const b=db.buildings.find(x=>x.id===buildingId); u=findUser(b?.managerUserId); }
  return u&&u.active!==false?u:null;
}
function createIssueFromPayload(payload,actorUser,options={}){
  const tenantId=payload.tenantId||null;
  const tenant=tenantId?db.tenants.find(t=>t.id===tenantId):null;
  const buildingId=payload.buildingId || tenant?.buildingId;
  if(!buildingId || !String(payload.title||'').trim()) throw new Error('REQUIRED_FIELDS');
  const category=String(payload.category||'ÐÑÑÐ³Ð¾Ðµ').slice(0,60);
  let responsible=findUser(payload.responsibleUserId);
  if(!responsible && payload.responsible){ responsible=db.users.find(u=>u.name===payload.responsible&&u.active!==false); }
  if(!responsible) responsible=routeUser(buildingId,category);
  const curator=findUser(payload.curatorUserId) || findUser(db.buildings.find(b=>b.id===buildingId)?.managerUserId);
  const createdAt=nowIso();
  const item=ensureIssueShape({
    id:'i'+crypto.randomBytes(4).toString('hex'),buildingId,tenantId,title:String(payload.title).trim().slice(0,160),category,
    priority:['low','normal','high','critical'].includes(payload.priority)?payload.priority:'normal',
    status:payload.status|| (responsible?'assigned':'new'),reporter:String(payload.reporter||actorUser?.name||'Ð¡Ð¸ÑÑÐµÐ¼Ð°').slice(0,80),
    curator:curator?.name||String(payload.curator||'').slice(0,80),curatorUserId:curator?.id||'',
    responsible:responsible?.name||String(payload.responsible||'').slice(0,80),responsibleUserId:responsible?.id||'',executor:String(payload.executor||'').slice(0,80),
    due:String(payload.due||''),created:createdAt.slice(0,10),createdAt,cost:Number(payload.cost||0),result:'',sourceInspectionId:options.sourceInspectionId||'',
    timeline:[{at:createdAt,actor:actorUser?.name||'Ð¡Ð¸ÑÑÐµÐ¼Ð°',text:options.sourceInspectionId?'ÐÑÐ¾Ð±Ð»ÐµÐ¼Ð° ÑÐ¾Ð·Ð´Ð°Ð½Ð° Ð°Ð²ÑÐ¾Ð¼Ð°ÑÐ¸ÑÐµÑÐºÐ¸ Ð¸Ð· Ð¾ÑÐ¼Ð¾ÑÑÐ°':'ÐÐ°ÑÐ²ÐºÐ° ÑÐ¾Ð·Ð´Ð°Ð½Ð°'}]
  });
  if(responsible){item.timeline.push({at:createdAt,actor:'Ð¡Ð¸ÑÑÐµÐ¼Ð°',text:`ÐÐ²ÑÐ¾Ð¼Ð°ÑÐ¸ÑÐµÑÐºÐ¸ Ð½Ð°Ð·Ð½Ð°ÑÐµÐ½ Ð¾ÑÐ²ÐµÑÑÑÐ²ÐµÐ½Ð½ÑÐ¹: ${responsible.name}`});notifyUser(responsible.id,'ÐÐ¾Ð²Ð°Ñ Ð¿ÑÐ¾Ð±Ð»ÐµÐ¼Ð° Ð½Ð°Ð·Ð½Ð°ÑÐµÐ½Ð° Ð²Ð°Ð¼',item.title,{issueId:item.id,buildingId:item.buildingId});}
  db.issues.unshift(item); return item;
}

function json(res,status,data,extraHeaders={}){ res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extraHeaders});res.end(JSON.stringify(data)); }
function text(res,status,body,type='text/plain; charset=utf-8'){ res.writeHead(status,{'Content-Type':type});res.end(body); }
function parseCookies(req){ const out={}; for(const part of(req.headers.cookie||'').split(';')){const i=part.indexOf('=');if(i>0)out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim());}return out; }
function getSession(req){
  const sid=parseCookies(req).sid;if(!sid)return null;const s=sessions.get(sid);
  if(!s||s.expires<Date.now()){if(s)sessions.delete(sid);return null;}
  const live=findUser(s.userId); if(!live||live.active===false){sessions.delete(sid);return null;}
  s.expires=Date.now()+SESSION_TTL; s.user=safeUser(live); s.sid=sid; return s;
}
function requireSession(req,res){const s=getSession(req);if(!s){json(res,401,{error:'AUTH_REQUIRED'});return null;}return s;}
function csrfOk(req,s){return ['GET','HEAD','OPTIONS'].includes(req.method)||req.headers['x-csrf-token']===s.csrf;}
function bodyJson(req,maxBytes=1_000_000){return new Promise((resolve,reject)=>{let raw='';let tooLarge=false;req.on('data',c=>{if(tooLarge)return;raw+=c;if(Buffer.byteLength(raw)>maxBytes){tooLarge=true;reject(new Error('too_large'));req.destroy();}});req.on('end',()=>{if(tooLarge)return;try{resolve(raw?JSON.parse(raw):{});}catch(e){reject(e);}});req.on('error',reject);});}
function clientIp(req){return(req.socket.remoteAddress||'unknown').replace('::ffff:','');}
function checkLoginRate(ip){const now=Date.now();const row=loginAttempts.get(ip)||{count:0,reset:now+60000};if(now>row.reset){row.count=0;row.reset=now+60000;}row.count++;loginAttempts.set(ip,row);return row.count<=8;}
function secHeaders(res){
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Permissions-Policy','camera=(self), geolocation=(), microphone=()');res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; manifest-src 'self'; worker-src 'self'");
  if(PROD&&COOKIE_SECURE)res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');
}
function serveStatic(req,res,urlPath){
  let rel=urlPath==='/'?'/index.html':urlPath;rel=rel.split('?')[0];const file=path.normalize(path.join(PUBLIC_DIR,rel));
  if(!file.startsWith(PUBLIC_DIR))return text(res,403,'Forbidden');
  let data;try{data=fs.readFileSync(file);}catch{return text(res,404,'Not found');}
  const ext=path.extname(file).toLowerCase();const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.svg':'image/svg+xml'};const noStore=rel.endsWith('index.html')||rel.endsWith('sw.js');res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':noStore?'no-store':'public, max-age=3600'});res.end(data);
}
function terminateUserSessions(userId){for(const [sid,s] of sessions)if(s.userId===userId)sessions.delete(sid);}
function canManageStaff(user){return user.role==='owner'||hasPerm(user,'staff_manage');}
function calculateAdminStats(){
  const staff=db.users.filter(u=>STAFF_ROLES.includes(u.role));
  const activeStaff=staff.filter(u=>u.active!==false);
  const now=Date.now(),seven=7*864e5,thirty=30*864e5;
  const recentInspections=db.inspections.filter(i=>now-new Date(i.occurredAt||i.createdAt).getTime()<=seven).length;
  const duePlans=db.inspectionPlans.filter(p=>p.active!==false && new Date(p.nextDue+'T23:59:59').getTime()<=now+seven).length;
  const acceptedRejected=db.issues.flatMap(i=>i.acceptanceHistory||[]).filter(a=>a.decision==='rejected'&&now-new Date(a.at).getTime()<=thirty).length;
  const resolved=db.issues.filter(i=>i.resolvedAt&&i.createdAt).map(i=>(new Date(i.resolvedAt)-new Date(i.createdAt))/36e5).filter(n=>Number.isFinite(n)&&n>=0);
  const workload=activeStaff.map(u=>({userId:u.id,name:u.name,role:u.role,open:db.issues.filter(i=>i.status!=='done'&&i.responsibleUserId===u.id).length,inspections:db.inspections.filter(i=>i.inspectorUserId===u.id&&now-new Date(i.occurredAt||i.createdAt).getTime()<=thirty).length})).sort((a,b)=>b.open-a.open);
  return {activeStaff:activeStaff.length,disabledStaff:staff.length-activeStaff.length,openIssues:db.issues.filter(i=>i.status!=='done').length,inspections7d:recentInspections,duePlans,rejected30d:acceptedRejected,avgResolutionHours:resolved.length?Math.round(resolved.reduce((a,b)=>a+b,0)/resolved.length):0,workload};
}

function buildingDependencyCounts(buildingId){
  return {
    tenants:db.tenants.filter(x=>x.buildingId===buildingId).length,
    issues:db.issues.filter(x=>x.buildingId===buildingId).length,
    inspections:db.inspections.filter(x=>x.buildingId===buildingId).length,
    equipment:db.equipment.filter(x=>x.buildingId===buildingId).length,
    metrics:db.metrics.filter(x=>x.buildingId===buildingId).length,
    expenses:db.expenses.filter(x=>x.buildingId===buildingId).length
  };
}
function normalizeBuildingPayload(input,current={}){
  const name=String(input.name??current.name??'').trim().slice(0,120),address=String(input.address??current.address??'').trim().slice(0,220);
  if(!name)throw new Error('BUILDING_NAME_REQUIRED');
  const number=(key,fallback=0)=>{const n=Number(input[key]??current[key]??fallback);return Number.isFinite(n)&&n>=0?n:fallback;};
  const status=['ok','attention','critical'].includes(input.status)?input.status:(current.status||'ok');
  return {...current,name,address,area:number('area'),occupied:number('occupied'),floors:number('floors'),powerKw:number('powerKw'),status,manager:String(input.manager??current.manager??'').trim().slice(0,120),managerUserId:String(input.managerUserId??current.managerUserId??'').trim(),note:String(input.note??current.note??'').trim().slice(0,1500)};
}

async function api(req,res,u){
  if(req.method==='POST'&&u.pathname==='/api/login'){
    const ip=clientIp(req);if(!checkLoginRate(ip))return json(res,429,{error:'TOO_MANY_ATTEMPTS'});
    let b;try{b=await bodyJson(req);}catch{return json(res,400,{error:'BAD_JSON'});}
    const user=db.users.find(x=>x.email===String(b.email||'').toLowerCase()&&x.active!==false);
    let ok=false;if(user){const incoming=Buffer.from(hashPassword(String(b.password||''),user.salt),'hex');const stored=Buffer.from(user.passwordHash,'hex');ok=incoming.length===stored.length&&crypto.timingSafeEqual(stored,incoming);}
    if(!ok)return json(res,401,{error:'INVALID_CREDENTIALS'});
    const sid=crypto.randomBytes(32).toString('hex'),csrf=crypto.randomBytes(24).toString('hex');
    user.lastLoginAt=nowIso();sessions.set(sid,{userId:user.id,user:safeUser(user),csrf,expires:Date.now()+SESSION_TTL});logSecurity(user.name,'Ð£ÑÐ¿ÐµÑÐ½ÑÐ¹ Ð²ÑÐ¾Ð´');persist();
    const cookie=`sid=${encodeURIComponent(sid)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL/1000}${COOKIE_SECURE?'; Secure':''}`;
    return json(res,200,{user:safeUser(user),csrf},{'Set-Cookie':cookie});
  }
  if(req.method==='POST'&&u.pathname==='/api/logout'){
    const s=getSession(req);if(s)sessions.delete(s.sid);return json(res,200,{ok:true},{'Set-Cookie':`sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${COOKIE_SECURE?'; Secure':''}`});
  }
  const s=requireSession(req,res);if(!s)return;if(!csrfOk(req,s))return json(res,403,{error:'CSRF'});const user=s.user;

  if(req.method==='GET'&&u.pathname==='/api/me')return json(res,200,{user,csrf:s.csrf});
  if(req.method==='GET'&&u.pathname==='/api/assignees'){
    if(isTenant(user)||(!hasPerm(user,'issues_edit')&&!hasPerm(user,'inspections_create')&&user.role!=='owner'))return json(res,403,{error:'FORBIDDEN'});
    const allowed=allowedBuildingSet(user);const rows=db.users.filter(x=>x.active!==false&&x.role!=='tenant'&&x.role!=='owner'&&(user.role==='owner'||(x.buildingIds||[]).some(id=>allowed.has(id)))).map(x=>({id:x.id,name:x.name,role:x.role,buildingIds:x.buildingIds||[]}));return json(res,200,rows);
  }
  if(req.method==='GET'&&u.pathname==='/api/notifications'){return json(res,200,db.notifications.filter(n=>n.userId===user.id).slice(0,50));}
  if(req.method==='POST'&&u.pathname==='/api/notifications/read'){let b;try{b=await bodyJson(req);}catch{return json(res,400,{error:'BAD_JSON'});}const ids=Array.isArray(b.ids)?b.ids.map(String):[];const at=nowIso();for(const n of db.notifications)if(n.userId===user.id&&(ids.length===0||ids.includes(n.id)))n.readAt=n.readAt||at;persist();return json(res,200,{ok:true});}
  if(req.method==='GET'&&u.pathname==='/api/buildings'){
    if(u.searchParams.get('archived')==='1'){
      if(user.role!=='owner')return json(res,403,{error:'FORBIDDEN'});
      return json(res,200,db.buildings.filter(b=>!!b.archivedAt));
    }
    return json(res,200,visibleBuildings(user));
  }
  if(req.method==='POST'&&u.pathname==='/api/buildings'){
    if(user.role!=='owner')return json(res,403,{error:'FORBIDDEN'});let b;try{b=await bodyJson(req);}catch{return json(res,400,{error:'BAD_JSON'});}
    let item;try{item=normalizeBuildingPayload(b,{id:'b'+crypto.randomBytes(5).toString('hex'),createdAt:nowIso(),archivedAt:''});}catch(e){return json(res,422,{error:e.message});}
    db.buildings.push(item);const ownerAccount=db.users.find(x=>x.role==='owner');if(ownerAccount&&!ownerAccount.buildingIds.includes(item.id))ownerAccount.buildingIds.push(item.id);db.inspectionPlans.push({buildingId:item.id,frequencyDays:7,inspectorUserId:'',active:true,lastInspectionAt:'',nextDue:addDaysIso(nowIso(),7)});logSecurity(user.name,`Ð¡Ð¾Ð·Ð´Ð°Ð½ Ð¾Ð±ÑÐµÐºÑ ${item.name}`);persist();return json(res,201,item);
  }
  if(req.method==='PATCH'&&/^\/api\/buildings\/[^/]+$/.test(u.pathname)){
    if(user.role!=='owner')return json(res,403,{error:'FORBIDDEN'});const id=decodeURIComponent(u.pathname.split('/')[3]||''),item=db.buildings.find(x=>x.id===id);if(!item)return json(res,404,{error:'NOT_FOUND'});let b;try{b=await bodyJson(req);}catch{return json(res,400,{error:'BAD_JSON'});}
    try{Object.assign(item,normalizeBuildingPayload(b,item));}catch(e){return json(res,422,{error:e.message});}logSecurity(user.name,`ÐÐ·Ð¼ÐµÐ½ÑÐ½ Ð¾Ð±ÑÐµÐºÑ ${item.name}`);persist();return json(res,200,item);
  }
  if(req.method==='POST'&&/^\/api\/buildings\/[^/]+\/archive$/.test(u.pathname)){
    if(user.role!=='owner')return json(res,403,{error:'FORBIDDEN'});const id=decodeURIComponent(u.pathname.split('/')[3]||''),item=db.buildings.find(x=>x.id===id);if(!item)return json(res,404,{error:'NOT_FOUND'});item.archivedAt=nowIso();const plan=db.inspectionPlans.find(x=>x.buildingId===id);if(plan)plan.active=false;logSecurity(user.name,`ÐÐ±ÑÐµÐºÑ ${item.name} Ð¿ÐµÑÐµÐ¼ÐµÑÑÐ½ Ð² Ð°ÑÑÐ¸Ð²`);persist();return json(res,200,item);
  }
  if(req.method==='POST'&&/^\/api\/buildings\/[^/]+\/restore$/.test(u.pathname)){
    if(user.role!=='owner')return json(res,403,{error:'FORBIDDEN'});const id=decodeURIComponent(u.pathname.split('/')[3]||''),item=db.buildings.find(x=>x.id===id);if(!item)return json(res,404,{error:'NOT_FOUND'});item.archivedAt='';const plan=db.inspectionPlans.find(x=>x.buildingId===id);if(plan)plan.active=true;const ownerAccount=db.users.find(x=>x.role==='owner');if(ownerAccount&&!ownerAccount.buildingIds.includes(id))ownerAccount.buildingIds.push(id);logSecurity(user.name,`ÐÐ±ÑÐµÐºÑ ${item.name} Ð²Ð¾ÑÑÑÐ°Ð½Ð¾Ð²Ð»ÐµÐ½ Ð¸Ð· Ð°ÑÑÐ¸Ð²Ð°`);persist();return json(res,200,item);
  }
  if(req.method==='DELETE'&&/^\/api\/buildings\/[^/]+$/.test(u.pathname)){
    if(user.role!=='owner')return json(res,403,{error:'FORBIDDEN'});const id=decodeURIComponent(u.pathname.split('/')[3]||''),index=db.buildings.findIndex(x=>x.id===id);if(index<0)return json(res,404,{error:'NOT_FOUND'});const item=db.buildings[index];if(!item.archivedAt)return json(res,409,{error:'BUILDING_MUST_BE_ARCHIVED'});const dependencies=buildingDependencyCounts(id);if(Object.values(dependencies).some(Boolean))return json(res,409,{error:'BUILDING_HAS_RELATED_DATA',dependencies});db.buildings.splice(index,1);db.inspectionPlans=db.inspectionPlans.filter(x=>x.buildingId!==id);db.routingRules=db.routingRules.filter(x=>x.buildingId!==id);for(const account of db.users)account.buildingIds=(account.buildingIds||[]).filter(x=>x!==id);logSecurity(user.name,`Ð£Ð´Ð°Ð»ÑÐ½ Ð¿ÑÑÑÐ¾Ð¹ Ð°ÑÑÐ¸Ð²Ð½ÑÐ¹ Ð¾Ð±ÑÐµÐºÑ ${item.name}`);persist();return json(res,200,{ok:true});
  }
  if(req.method==='GET'&&u.pathname==='/api/tenants')return json(res,200,visibleTenants(user));
  if(req.method==='GET'&&u.pathname==='/api/issues')return json(res,200,visibleIssues(user).map(publicIssue));
  if(req.method==='GET'&&u.pathname==='/api/inspections')return json(res,200,visibleInspections(user).map(publicInspection));
  if(req.method==='GET'&&u.pathname==='/api/inspection-plans'){
    if(isTenant(user)||(!hasPerm(user,'inspections_view')&&user.role!=='owner'))return json(res,403,{error:'FORBIDDEN'});
    return json(res,200,db.inspectionPlans.filter(p=>canAccessBuilding(user,p.buildingId)));
  }

  if(req.method==='GET'&&u.pathname.startsWith('/api/issue-media/')){
    const parts=u.pathname.split('/').filter(Boolean),issueId=decodeURIComponent(parts[2]||''),photoId=decodeURIComponent(parts[3]||'');const issue=db.issues.find(x=>x.id===issueId);
    if(!issue)return json(res,404,{error:'NOT_FOUND'});if(!canSeeIssue(user,issue))return json(res,403,{error:'FORBIDDEN'});ensureIssueShape(issue);const meta=issue.photos.find(x=>x.id===photoId);if(!meta)return json(res,404,{error:'NOT_FOUND'});
    const file=path.join(ISSUE_UPLOAD_DIR,issue.id,meta.file);if(!file.startsWith(path.join(ISSUE_UPLOAD_DIR,issue.id))||!fs.existsSync(file))return json(res,404,{error:'NOT_FOUND'});
    res.writeHead(200,{'Content-Type':meta.mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline'});fs.createReadStream(file).pipe(res);return;
  }
  if(req.method==='GET'&&u.pathname.startsWith('/api/inspection-media/')){
    const parts=u.pathname.split('/').filter(Boolean),inspectionId=decodeURIComponent(parts[2]||''),photoId=decodeURIComponent(parts[3]||'');const item=db.inspections.find(x=>x.id===inspectionId);
    if(!item)return json(res,404,{error:'NOT_FOUND'});if(isTenant(user)||!hasPerm(user,'inspections_view')||!canAccessBuilding(user,item.buildingId))return json(res,403,{error:'FORBIDDEN'});ensureInspectionShape(item);const meta=item.photos.find(x=>x.id===photoId);if(!meta)return json(res,404,{error:'NOT_FOUND'});
    const file=path.join(INSPECTION_UPLOAD_DIR,item.id,meta.file);if(!file.startsWith(path.join(INSPECTION_UPLOAD_DIR,item.id))||!fs.existsSync(file))return json(res,404,{error:'NOT_FOUND'});
    res.writeHead(200,{'Content-Type':meta.mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline'});fs.createReadStream(file).pipe(res);return;
  }

  if(req.method==='GET'&&u.pathname==='/api/equipment'){
    if(!hasPerm(user,'equipment_view'))return json(res,403,{error:'FORBIDDEN'});return json(res,200,db.equipment.filter(e=>canAccessBuilding(user,e.buildingId)));
  }
  if(req.method==='GET'&&u.pathname==='/api/metrics'){
    if(!hasPerm(user,'metrics_view'))return json(res,403,{error:'FORBIDDEN'});return json(res,200,db.metrics.filter(m=>canAccessBuilding(user,m.buildingId)));
  }
  if(req.method==='GET'&&u.pathname==='/api/expenses'){
    if(!hasPerm(user,'expenses_view'))return json(res,403,{error:'FORBIDDEN'});return json(res,200,db.expenses.filter(e=>canAccessBuilding(user,e.buildingId)));
  }
  if(req.method==='GET'&&u.pathname==='/api/security'){
    if(!hasPerm(user,'security_view'))return json(res,403,{error:'FORBIDDEN'});return json(res,200,{sessions:sessions.size,log:db.securityLog.slice(0,50),failedLastMinute:[...loginAttempts.values()].reduce((a,b)=>a+Math.max(0,b.count-1),0)});
  }
  if(req.method==='GET'&&u.pathname==='/api/admin'){
    if(!canManageStaff(user))return json(res,403,{error:'FORBIDDEN'});
    return json(res,200,{users:db.users.map(publicUser),roles:STAFF_ROLES,permissions:PERMISSIONS,roleDefaults:ROLE_DEFAULTS,routingRules:db.routingRules,inspectionPlans:db.inspectionPlans,stats:calculateAdminStats()});
  }
  if(req.method==='GET'&&u.pathname==='/api/dashboard'){
    const buildings=visibleBuildings(user),tenants=visibleTenants(user),issues=visibleIssues(user);const open=issues.filter(i=>i.status!=='done');
    const payload={buildings,tenants,issues:issues.map(publicIssue),stats:{buildings:buildings.length,tenants:tenants.length,open:open.length,critical:open.filter(i=>i.priority==='critical').length,overdue:open.filter(i=>i.status==='overdue'||(i.due&&i.due<dateOnly())).length,awaitingAcceptance:open.filter(i=>i.status==='awaiting_acceptance').length}};
    if(hasPerm(user,'expenses_view'))payload.stats.expenses=db.expenses.filter(e=>canAccessBuilding(user,e.buildingId)).reduce((a,x)=>a+x.total,0);
    if(hasPerm(user,'inspections_view')){
      const plans=db.inspectionPlans.filter(p=>p.active!==false&&canAccessBuilding(user,p.buildingId));payload.stats.inspectionsDue=plans.filter(p=>p.nextDue<=addDaysIso(nowIso(),7)).length;payload.stats.inspectionsOverdue=plans.filter(p=>p.nextDue<dateOnly()).length;
    }
    return json(res,200,payload);
  }

  if(req.method==='POST'&&u.pathname==='/api/issues'){
    if(isTenant(user)){
      let b;try{b=await bodyJson(req);}catch{return json(res,400,{error:'BAD_JSON'});}const t=db.tenants.find(x=>x.id===user.tenantId);if(!t)return json(res,422,{error:'TENANT_NOT_ASSIGNED'});
      try{const item=createIssueFromPayload({...b,buildingId:t.buildingId,tenantId:t.id,reporter:user.name,status:'new',responsibleUserId:''},user);logSecurity(user.name,`Ð¡Ð¾Ð·Ð´Ð°Ð½Ð° Ð·Ð°ÑÐ²ÐºÐ° ${item.id}`);persist();return json(res,201,publicIssue(item));}catch(e){return json(res,422,{error:e.message});}
    }
    if(!hasPerm(user,'issues_edit'))return json(res,403,{error:'FORBIDDEN'});let b;try{b=await bodyJson(req);}catch{return json(res,400,{error:'BAD_JSON'});}
    const tenant=b.tenantId?db.tenants.find(t=>t.id===b.tenantId):null;const buildingId=b.buildingId||tenant?.buildingId;if(!canAccessBuilding(user,buildingId))return json(res,403,{error:'FORBIDDEN'});
    try{const item=createIssueFromPayload({...b,buildingId},user);logSecurity(user.name,`Ð¡Ð¾Ð·Ð´Ð°Ð½Ð° Ð·Ð°ÑÐ²ÐºÐ° ${item.id}`);persist();return json(res,201,publicIssue(item));}catch(e){return json(res,422,{error:e.message});}
  }
  if(req.method==='POST'&&/^\/api\/issues\/[^/]+\/photos$/.test(u.pathname)){
    const id=decodeURIComponent(u.pathname.split('/')[3]||''),item=db.issues.find(x=>x.id===id);if(!item)return json(res,404,{error:'NOT_FOUND'});if(!canSeeIssue(user,item))return json(res,403,{error:'FORBIDDEN'});
    let b;try{b=await bodyJson(req,30_000_000);}catch{return json(res,413,{error:'UPLOAD_TOO_LARGE'});}const kind=['problem','progress','solution'].includes(b.kind)?b.kind:'problem';if(isTenant(user)&&kind!=='problem')return json(res,403,{error:'FORBIDDEN'});if(!isTenant(user)&&!canEditIssue(user,item))return json(res,403,{error:'FORBIDDEN'});
    try{const saved=saveIssuePhotos(item,b.photos,kind,user.name);if(saved.length)item.timeline.push({at:nowIso(),actor:user.name,text:`ÐÐ¾Ð±Ð°Ð²Ð»ÐµÐ½Ñ ÑÐ¾ÑÐ¾Ð³ÑÐ°ÑÐ¸Ð¸: ${saved.length}`});persist();return json(res,201,{photos:saved.map(p=>publicIssuePhoto(p,item.id))});}catch(e){return json(res,422,{error:e.message});}
  }
  if(req.method==='POST'&&/^\/api\/issues\/[^/]+\/reports$/.test(u.pathname)){
    const id=decodeURIComponent(u.pathname.split('/')[3]||''),item=db.issues.find(x=>x.id===id);if(!item)return json(res,404,{error:'NOT_FOUND'});if(!canEditIssue(user,item))return json(res,403,{error:'FORBIDDEN'});
    let b;try{b=await bodyJson(req,30_000_000);}catch{return json(res,413,{error:'UPLOAD_TOO_LARGE'});}if(!String(b.author||'').trim()||!String(b.text||'').trim())return json(res,422,{error:'REQUIRED_FIELDS'});if(!Array.isArray(b.photos)||!b.photos.length)return json(res,422,{error:'PHOTO_REQUIRED'});
    try{
      const kind=b.markDone?'solution':'progress',saved=saveIssuePhotos(item,b.photos,kind,String(b.author).slice(0,100));const at=nowIso();const report={id:'r'+crypto.randomBytes(5).toString('hex'),kind,author:String(b.author).slice(0,100),recordedBy:user.name,text:String(b.text).slice(0,1500),at,photos:saved.map(p=>p.id)};item.reports.push(report);item.timeline.push({at,actor:user.name,text:`ÐÐ¾Ð±Ð°Ð²Ð»ÐµÐ½ ${kind==='solution'?'Ð¸ÑÐ¾Ð³Ð¾Ð²ÑÐ¹':'Ð¿ÑÐ¾Ð¼ÐµÐ¶ÑÑÐ¾ÑÐ½ÑÐ¹'} ÑÐ¾ÑÐ¾Ð¾ÑÑÑÑ: ${report.author}`});
      if(b.markDone){item.resolvedBy=report.author;item.resolvedAt=at;item.result=report.text;if(item.tenantId){item.status='awaiting_acceptance';item.tenantAcceptedAt='';item.tenantAcceptedBy='';item.timeline.push({at,actor:user.name,text:'Ð Ð°Ð±Ð¾ÑÐ° Ð²ÑÐ¿Ð¾Ð»Ð½ÐµÐ½Ð° â Ð¾Ð¶Ð¸Ð´Ð°ÐµÑÑÑ Ð¿Ð¾Ð´ÑÐ²ÐµÑÐ¶Ð´ÐµÐ½Ð¸Ðµ Ð°ÑÐµÐ½Ð´Ð°ÑÐ¾ÑÐ°'});const tu=db.users.find(x=>x.role==='tenant'&&x.tenantId===item.tenantId&&x.active!==false);if(tu)notifyUser(tu.id,'ÐÑÐ¾Ð±Ð»ÐµÐ¼Ð° Ð¾Ð¶Ð¸Ð´Ð°ÐµÑ Ð²Ð°ÑÐµÐ³Ð¾ Ð¿Ð¾Ð´ÑÐ²ÐµÑÐ¶Ð´ÐµÐ½Ð¸Ñ',item.title,{issueId:item.id,buildingId:item.buildingId});}else{item.status='done';item.timeline.push({at,actor:user.name,text:'ÐÑÐ¾Ð±Ð»ÐµÐ¼Ð° Ð·Ð°ÐºÑÑÑÐ° Ð¸ÑÐ¾Ð³Ð¾Ð²ÑÐ¼ ÑÐ¾ÑÐ¾Ð¾ÑÑÑÑÐ¾Ð¼'});}}
      persist();return json(res,201,publicIssue(item));
    }catch(e){return json(res,422,{error:e.message});}
  }
  if(req.method==='POST'&&/^\/api\/issues\/[^/]+\/tenant-decision$/.test(u.pathname)){
    if(!isTenant(user))return json(res,403,{error:'FORBIDDEN'});const id=decodeURIComponent(u.pathname.split('/')[3]||''),item=db.issues.find(x=>x.id===id);if(!item)return json(res,404,{error:'NOT_FOUND'});if(item.tenantId!==user.tenantId)return json(res,403,{error:'FORBIDDEN'});if(item.status!=='awaiting_acceptance')return json(res,409,{error:'NOT_AWAITING_ACCEPTANCE'});
    let b;try{b=await bodyJson(req,30_000_000);}catch{return json(res,413,{error:'UPLOAD_TOO_LARGE'});}const decision=b.decision==='rejected'?'rejected':'accepted';if(decision==='rejected'&&!String(b.comment||'').trim())return json(res,422,{error:'COMMENT_REQUIRED'});
    try{const saved=saveIssuePhotos(item,b.photos,decision==='accepted'?'acceptance':'rejection',user.name);const at=nowIso();item.acceptanceHistory.push({id:'a'+crypto.randomBytes(5).toString('hex'),decision,actor:user.name,at,comment:String(b.comment||'').slice(0,1500),photos:saved.map(p=>p.id)});if(decision==='accepted'){item.status='done';item.tenantAcceptedAt=at;item.tenantAcceptedBy=user.name;item.timeline.push({at,actor:user.name,text:'ÐÑÐµÐ½Ð´Ð°ÑÐ¾Ñ Ð¿Ð¾Ð´ÑÐ²ÐµÑÐ´Ð¸Ð» ÑÑÑÑÐ°Ð½ÐµÐ½Ð¸Ðµ Ð¿ÑÐ¾Ð±Ð»ÐµÐ¼Ñ'});if(item.responsibleUserId)notifyUser(item.responsibleUserId,'ÐÑÐµÐ½Ð´Ð°ÑÐ¾Ñ Ð¿ÑÐ¸Ð½ÑÐ» ÑÐµÐ·ÑÐ»ÑÑÐ°Ñ',item.title,{issueId:item.id,buildingId:item.buildingId});}else{item.status='in_progress';item.tenantAcceptedAt='';item.tenantAcceptedBy='';item.timeline.push({at,actor:user.name,text:'ÐÑÐµÐ½Ð´Ð°ÑÐ¾Ñ ÑÐ¾Ð¾Ð±ÑÐ¸Ð», ÑÑÐ¾ Ð¿ÑÐ¾Ð±Ð»ÐµÐ¼Ð° Ð¾ÑÑÐ°Ð»Ð°ÑÑ â Ð²Ð¾Ð·Ð²ÑÐ°ÑÐµÐ½Ð¾ Ð² ÑÐ°Ð±Ð¾ÑÑ'});if(item.responsibleUserId)notifyUser(item.responsibleUserId,'ÐÑÐ¾Ð±Ð»ÐµÐ¼Ð° Ð²Ð¾Ð·Ð²ÑÐ°ÑÐµÐ½Ð° Ð² ÑÐ°Ð±Ð¾ÑÑ',item.title,{issueId:item.id,buildingId:item.buildingId});}persist();return json(res,200,publicIssue(item));}catch(e){return json(res,422,{error:e.message});}
  }
  if(req.method==='PATCH'&&/^\/api\/issues\/[^/]+$/.test(u.pathname)){
    const id=decodeURIComponent(u.pathname.split('/')[3]||''),item=db.issues.find(x=>x.id===id);if(!item)return json(res,404,{error:'NOT_FOUND'});if(!canEditIssue(user,item))return json(res,403,{error:'FORBIDDEN'});let b;try{b=await bodyJson(req);}catch{return json(res,400,{error:'BAD_JSON'});}
    if(b.status==='done'&&item.tenantId)return json(res,422,{error:'USE_PHOTO_REPORT_WORKFLOW'});
    const fields=['priority','status','due','executor'];for(const f of fields)if(f in b)item[f]=String(b[f]||'').slice(0,100);
    if('cost'in b)item.cost=Math.max(0,Number(b.cost||0));
    if('responsibleUserId'in b){const old=item.responsibleUserId;const ru=findUser(b.responsibleUserId);if(ru&&ru.active!==false){item.responsibleUserId=ru.id;item.responsible=ru.name;if(old!==ru.id)notifyUser(ru.id,'ÐÐ°Ð¼ Ð½Ð°Ð·Ð½Ð°ÑÐµÐ½Ð° Ð¿ÑÐ¾Ð±Ð»ÐµÐ¼Ð°',item.title,{issueId:item.id,buildingId:item.buildingId});}else if(!b.responsibleUserId){item.responsibleUserId='';item.responsible='';}}
    else if('responsible'in b){item.responsible=String(b.responsible||'').slice(0,80);const ru=db.users.find(x=>x.name===item.responsible&&x.active!==false);item.responsibleUserId=ru?.id||'';}
    if('curatorUserId'in b){const cu=findUser(b.curatorUserId);if(cu&&cu.active!==false){item.curatorUserId=cu.id;item.curator=cu.name;}}
    else if('curator'in b)item.curator=String(b.curator||'').slice(0,80);
    item.timeline.push({at:nowIso(),actor:user.name,text:'ÐÐ°ÑÐ°Ð¼ÐµÑÑÑ Ð¿ÑÐ¾Ð±Ð»ÐµÐ¼Ñ Ð¾Ð±Ð½Ð¾Ð²Ð»ÐµÐ½Ñ'});persist();return json(res,200,publicIssue(item));
  }

  if(req.method==='POST'&&u.pathname==='/api/tenants'){
    if(!hasPerm(user,'tenants_manage'))return json(res,403,{error:'FORBIDDEN'});let b;try{b=await bodyJson(req);}catch{return json(res,400,{error:'BAD_JSON'});}if(!canAccessBuilding(user,b.buildingId))return json(res,403,{error:'FORBIDDEN'});if(!String(b.company||'').trim()||!Number(b.area))return json(res,422,{error:'REQUIRED_FIELDS'});
    const t={id:'t'+crypto.randomBytes(4).toString('hex'),buildingId:String(b.buildingId),company:String(b.company).slice(0,100),legalName:String(b.legalName||'').slice(0,140),unit:String(b.unit||'').slice(0,50),floor:Number(b.floor||0),area:Number(b.area||0),contact:String(b.contact||'').slice(0,100),phone:String(b.phone||'').slice(0,50),ownerResponsible:String(b.ownerResponsible||'').slice(0,100),startDate:String(b.startDate||''),endDate:String(b.endDate||''),note:String(b.note||'').slice(0,500)};db.tenants.push(t);logSecurity(user.name,`ÐÐ¾Ð±Ð°Ð²Ð»ÐµÐ½ Ð°ÑÐµÐ½Ð´Ð°ÑÐ¾Ñ ${t.company}`);persist();return json(res,201,t);
  }

  if(req.method==='POST'&&u.pathname==='/api/inspections'){
    if(!hasPerm(user,'inspections_create'))return json(res,403,{error:'FORBIDDEN'});let b;try{b=await bodyJson(req,90_000_000);}catch{return json(res,413,{error:'UPLOAD_TOO_LARGE'});}const buildingId=String(b.buildingId||'');if(!canAccessBuilding(user,buildingId))return json(res,403,{error:'FORBIDDEN'});
    const ext=Array.isArray(b.exteriorPhotos)?b.exteriorPhotos.filter(x=>x&&x.photo):[];if(ext.length<3||ext.length>4)return json(res,422,{error:'THREE_OR_FOUR_EXTERIOR_PHOTOS_REQUIRED'});
    const rawChecks=Array.isArray(b.tenantChecks)?b.tenantChecks:[];for(const c of rawChecks){if(c?.status==='problem'&&!String(c.notes||c.title||'').trim())return json(res,422,{error:'TENANT_PROBLEM_DESCRIPTION_REQUIRED'});if(c?.status==='problem'&&(!Array.isArray(c.photos)||!c.photos.length))return json(res,422,{error:'TENANT_PROBLEM_PHOTO_REQUIRED'});}
    if(b.buildingFinding&&String(b.buildingFinding.title||'').trim()&&(!Array.isArray(b.buildingFinding.photos)||!b.buildingFinding.photos.length))return json(res,422,{error:'BUILDING_PROBLEM_PHOTO_REQUIRED'});
    const item=ensureInspectionShape({id:'insp'+crypto.randomBytes(5).toString('hex'),buildingId,inspectorUserId:user.id,inspectorName:user.name,occurredAt:String(b.occurredAt||nowIso()),createdAt:nowIso(),overallCondition:['ok','attention','critical'].includes(b.overallCondition)?b.overallCondition:'ok',notes:String(b.notes||'').slice(0,2000),signature:user.name,photos:[],exteriorPhotoIds:[],tenantChecks:[],buildingFinding:null,createdIssueIds:[]});
    try{
      for(const row of ext){const saved=savePhotos(INSPECTION_UPLOAD_DIR,item.id,item.photos,[row.photo],{group:'exterior',label:String(row.side||'Ð¤Ð°ÑÐ°Ð´').slice(0,80),tenantId:'',actor:user.name});item.exteriorPhotoIds.push(...saved.map(p=>p.id));}
      const checks=Array.isArray(b.tenantChecks)?b.tenantChecks:[];
      for(const c of checks){
        const tenant=db.tenants.find(t=>t.id===c.tenantId&&t.buildingId===buildingId);if(!tenant)continue;const status=['ok','problem','not_checked'].includes(c.status)?c.status:'not_checked';
        const check={tenantId:tenant.id,status,notes:String(c.notes||'').slice(0,1000),category:String(c.category||'ÐÑÑÐ³Ð¾Ðµ').slice(0,60),priority:['low','normal','high','critical'].includes(c.priority)?c.priority:'normal',photoIds:[],issueId:''};
        const pics=Array.isArray(c.photos)?c.photos:[];if(status==='problem'&&!String(c.notes||c.title||'').trim())throw new Error('TENANT_PROBLEM_DESCRIPTION_REQUIRED');if(status==='problem'&&!pics.length)throw new Error('TENANT_PROBLEM_PHOTO_REQUIRED');
        if(pics.length){const saved=savePhotos(INSPECTION_UPLOAD_DIR,item.id,item.photos,pics,{group:'tenant',label:tenant.company,tenantId:tenant.id,actor:user.name});check.photoIds=saved.map(p=>p.id);}
        if(status==='problem'){
          const issue=createIssueFromPayload({buildingId,tenantId:tenant.id,title:String(c.title||`ÐÑÐ¼Ð¾ÑÑ ${tenant.company}: ${c.notes}`).slice(0,160),category:check.category,priority:check.priority,reporter:`ÐÑÐ¼Ð¾ÑÑ Â· ${user.name}`},user,{sourceInspectionId:item.id});
          const issuePhotos=check.photoIds.map(pid=>item.photos.find(p=>p.id===pid)).filter(Boolean).map(meta=>({name:meta.originalName,type:meta.mime,data:`data:${meta.mime};base64,${fs.readFileSync(path.join(INSPECTION_UPLOAD_DIR,item.id,meta.file)).toString('base64')}`}));
          saveIssuePhotos(issue,issuePhotos,'problem',user.name);check.issueId=issue.id;item.createdIssueIds.push(issue.id);
        }
        item.tenantChecks.push(check);
      }
      if(b.buildingFinding&&String(b.buildingFinding.title||'').trim()){
        const f=b.buildingFinding,pics=Array.isArray(f.photos)?f.photos:[];if(!pics.length)throw new Error('BUILDING_PROBLEM_PHOTO_REQUIRED');const saved=savePhotos(INSPECTION_UPLOAD_DIR,item.id,item.photos,pics,{group:'building_problem',label:'ÐÑÐ¾Ð±Ð»ÐµÐ¼Ð° Ð¾Ð±ÑÐµÐºÑÐ°',tenantId:'',actor:user.name});
        const issue=createIssueFromPayload({buildingId,title:String(f.title).slice(0,160),category:String(f.category||'ÐÑÑÐ³Ð¾Ðµ'),priority:f.priority||'normal',reporter:`ÐÑÐ¼Ð¾ÑÑ Â· ${user.name}`},user,{sourceInspectionId:item.id});
        const issuePics=saved.map(meta=>({name:meta.originalName,type:meta.mime,data:`data:${meta.mime};base64,${fs.readFileSync(path.join(INSPECTION_UPLOAD_DIR,item.id,meta.file)).toString('base64')}`}));saveIssuePhotos(issue,issuePics,'problem',user.name);
        item.buildingFinding={title:String(f.title).slice(0,160),notes:String(f.notes||'').slice(0,1000),category:String(f.category||'ÐÑÑÐ³Ð¾Ðµ').slice(0,60),priority:['low','normal','high','critical'].includes(f.priority)?f.priority:'normal',photoIds:saved.map(p=>p.id),issueId:issue.id};item.createdIssueIds.push(issue.id);
      }
      db.inspections.unshift(item);const plan=db.inspectionPlans.find(p=>p.buildingId===buildingId);if(plan){plan.lastInspectionAt=item.occurredAt;plan.nextDue=addDaysIso(item.occurredAt,plan.frequencyDays||7);}
      logSecurity(user.name,`ÐÑÐ¾Ð²ÐµÐ´ÑÐ½ Ð¾ÑÐ¼Ð¾ÑÑ ${buildingId}: ÑÐ¾Ð·Ð´Ð°Ð½Ð¾ Ð¿ÑÐ¾Ð±Ð»ÐµÐ¼ ${item.createdIssueIds.length}`);persist();return json(res,201,publicInspection(item));
    }catch(e){return json(res,422,{error:e.message});}
  }

  if(req.method==='POST'&&u.pathname==='/api/staff'){
    if(!canManageStaff(user))return json(res,403,{error:'FORBIDDEN'});
    let b;try{b=await bodyJson(req);}catch{return json(res,400,{error:'BAD_JSON'});}
    const email=String(b.email||'').trim().toLowerCase(),name=String(b.name||'').trim(),role=STAFF_ROLES.includes(b.role)?b.role:'manager';
    if(!email||!name)return json(res,422,{error:'REQUIRED_FIELDS'});
    if(db.users.some(x=>x.email===email))return json(res,409,{error:'EMAIL_EXISTS'});
    const requestedPassword=String(b.password||''),temporaryPassword=requestedPassword||generateTempPassword();
    if(temporaryPassword.length<10)return json(res,422,{error:'PASSWORD_TOO_SHORT'});
    const permissions=uniqueStrings(Array.isArray(b.permissions)?b.permissions:ROLE_DEFAULTS[role],PERMISSIONS);
    const buildingIds=uniqueStrings(b.buildingIds).filter(id=>db.buildings.some(x=>x.id===id));
    const account=createStoredUser('u'+crypto.randomBytes(5).toString('hex'),role,email,temporaryPassword,{name:name.slice(0,100),permissions,buildingIds});
    db.users.push(account);logSecurity(user.name,`Создан сотрудник ${account.name} (${role})`);persist();
    return json(res,201,{user:publicUser(account),temporaryPassword});
  }
  if(req.method==='PATCH'&&/^\/api\/staff\/[^/]+$/.test(u.pathname)){
    if(!canManageStaff(user))return json(res,403,{error:'FORBIDDEN'});
    const id=decodeURIComponent(u.pathname.split('/')[3]||''),target=findUser(id);
    if(!target)return json(res,404,{error:'NOT_FOUND'});
    if(target.role==='owner')return json(res,403,{error:'OWNER_PROTECTED'});
    let b;try{b=await bodyJson(req);}catch{return json(res,400,{error:'BAD_JSON'});}
    if('name'in b&&String(b.name).trim())target.name=String(b.name).trim().slice(0,100);
    if('email'in b){const email=String(b.email||'').trim().toLowerCase();if(!email)return json(res,422,{error:'REQUIRED_FIELDS'});if(db.users.some(x=>x.id!==target.id&&x.email===email))return json(res,409,{error:'EMAIL_EXISTS'});target.email=email;}
    if('role'in b&&STAFF_ROLES.includes(b.role)){target.role=b.role;if(!('permissions'in b))target.permissions=ROLE_DEFAULTS[b.role]||[];}
    if('permissions'in b)target.permissions=uniqueStrings(b.permissions,PERMISSIONS);
    if('buildingIds'in b)target.buildingIds=uniqueStrings(b.buildingIds).filter(x=>db.buildings.some(q=>q.id===x));
    if('password'in b){const password=String(b.password||'');if(password.length<10)return json(res,422,{error:'PASSWORD_TOO_SHORT'});setStoredPassword(target,password);terminateUserSessions(target.id);logSecurity(user.name,`Назначен новый пароль сотруднику ${target.name}`);}
    if('active'in b){target.active=!!b.active;if(!target.active){target.firedAt=nowIso();terminateUserSessions(target.id);}else target.firedAt='';}
    logSecurity(user.name,`${target.active?'Обновлён':'Отключён'} сотрудник ${target.name}`);persist();return json(res,200,publicUser(target));
  }
  if(req.method==='POST'&&/^\/api\/staff\/[^/]+\/reset-password$/.test(u.pathname)){
    if(!canManageStaff(user))return json(res,403,{error:'FORBIDDEN'});
    const id=decodeURIComponent(u.pathname.split('/')[3]||''),target=findUser(id);
    if(!target||target.role==='owner')return json(res,404,{error:'NOT_FOUND'});
    const temporaryPassword=generateTempPassword();setStoredPassword(target,temporaryPassword);terminateUserSessions(target.id);
    logSecurity(user.name,`Создан временный пароль сотруднику ${target.name}`);persist();return json(res,200,{temporaryPassword});
  }
  if(req.method==='POST'&&u.pathname==='/api/routing-rules'){
    if(!canManageStaff(user))return json(res,403,{error:'FORBIDDEN'});let b;try{b=await bodyJson(req);}catch{return json(res,400,{error:'BAD_JSON'});}const buildingId=String(b.buildingId||'*'),category=String(b.category||'ÐÑÑÐ³Ð¾Ðµ').slice(0,60),ru=findUser(b.responsibleUserId);if(buildingId!=='*'&&!db.buildings.some(x=>x.id===buildingId))return json(res,422,{error:'BAD_BUILDING'});if(!ru||ru.active===false||ru.role==='tenant')return json(res,422,{error:'BAD_RESPONSIBLE'});let rule=db.routingRules.find(r=>r.buildingId===buildingId&&r.category===category);if(rule){rule.responsibleUserId=ru.id;rule.active=true;}else{rule={id:'rr'+crypto.randomBytes(4).toString('hex'),buildingId,category,responsibleUserId:ru.id,active:true};db.routingRules.push(rule);}logSecurity(user.name,`ÐÐ°ÑÑÑÑÑ ${category} â ${ru.name}`);persist();return json(res,200,rule);
  }
  if(req.method==='PATCH'&&/^\/api\/inspection-plans\/[^/]+$/.test(u.pathname)){
    if(!canManageStaff(user))return json(res,403,{error:'FORBIDDEN'});const buildingId=decodeURIComponent(u.pathname.split('/')[3]||''),plan=db.inspectionPlans.find(p=>p.buildingId===buildingId);if(!plan)return json(res,404,{error:'NOT_FOUND'});let b;try{b=await bodyJson(req);}catch{return json(res,400,{error:'BAD_JSON'});}if('frequencyDays'in b)plan.frequencyDays=Math.max(1,Math.min(90,Number(b.frequencyDays||7)));if('inspectorUserId'in b){const iu=findUser(b.inspectorUserId);if(!iu||iu.active===false||iu.role==='tenant')return json(res,422,{error:'BAD_INSPECTOR'});plan.inspectorUserId=iu.id;}if('nextDue'in b)plan.nextDue=String(b.nextDue||'').slice(0,10);if('active'in b)plan.active=!!b.active;logSecurity(user.name,`ÐÐ±Ð½Ð¾Ð²Ð»ÑÐ½ Ð³ÑÐ°ÑÐ¸Ðº Ð¾ÑÐ¼Ð¾ÑÑÐ¾Ð² ${buildingId}`);persist();return json(res,200,plan);
  }

  return json(res,404,{error:'NOT_FOUND'});
}

const server=http.createServer(async(req,res)=>{
  secHeaders(res);
  if(req.url==='/healthz'){return json(res,200,{ok:true,version:'3.0.0'});}
  if(req.method==='OPTIONS'){res.writeHead(204,{'Allow':'GET,POST,PATCH,DELETE,OPTIONS'});return res.end();}
  let u;try{u=new URL(req.url,`http://${req.headers.host||'localhost'}`);}catch{return text(res,400,'Bad request');}
  if(u.pathname.startsWith('/api/')){try{return await api(req,res,u);}catch(e){console.error(e);return json(res,500,{error:'SERVER_ERROR'});}}
  return serveStatic(req,res,u.pathname);
});
function main(){
  initStorage();
  ensureDataShape();
  server.listen(PORT,HOST,()=>console.log(`Owner Property PWA listening on http://${HOST}:${PORT}`));
}

try{ main(); }catch(err){
  console.error('Startup failed:',err);
  process.exit(1);
}

async function shutdown(signal){
  console.log(`${signal}: shutting down`);
  server.close(()=>{
    try{ sqlite.close(); }catch{}
    process.exit(0);
  });
  setTimeout(()=>process.exit(1),10000).unref();
}
process.on('SIGTERM',()=>shutdown('SIGTERM'));
process.on('SIGINT',()=>shutdown('SIGINT'));
