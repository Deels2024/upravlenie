'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {SessionStore,SESSION_TTL,RENEW_INTERVAL}=require('../src/sessions');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'uk-sessions-')),file=path.join(dir,'sessions.db');
let now=Date.now(),db=new DatabaseSync(file),store=new SessionStore(db,()=>now);
const sid='a'.repeat(64),other='b'.repeat(64);
try{
 store.set(sid,{userId:'worker',csrf:'csrf1'});store.set(other,{userId:'owner',csrf:'csrf2'});
 assert.equal(store.get(sid).expires,now+SESSION_TTL);
 assert.notEqual(db.prepare('SELECT token_hash FROM auth_sessions LIMIT 1').get().token_hash,sid,'raw bearer token is not stored');
 assert.equal(store.renew(sid,store.get(sid)),false);
 db.close();db=new DatabaseSync(file);store=new SessionStore(db,()=>now);
 assert.equal(store.get(sid).userId,'worker','sessions survive process/database reopen');
 now+=RENEW_INTERVAL;assert.equal(store.renew(sid,store.get(sid)),true);assert.equal(store.get(sid).expires,now+SESSION_TTL);
 store.revokeUser('worker');db.close();db=new DatabaseSync(file);store=new SessionStore(db,()=>now);
 assert.equal(store.get(sid),undefined,'revocation survives restart');assert.equal(store.get(other).userId,'owner');
 now+=SESSION_TTL;assert.equal(store.get(other),null,'expired sessions cannot be renewed');assert.equal(store.size,0);
 assert.equal(store.get('malformed'),null);
 store.set(sid,{userId:'owner',csrf:'csrf3'});store.delete(sid);assert.equal(store.get(sid),undefined);
 console.log('Sessions: durable storage, hashed tokens, renewal, idle expiry and durable revocation: OK');
}finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
