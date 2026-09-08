'use strict';
const {createHash}=require('node:crypto');
const SESSION_TTL=30*24*60*60*1000;
const RENEW_INTERVAL=60*60*1000;
const key=sid=>createHash('sha256').update(sid).digest('hex');

class SessionStore {
 constructor(sqlite,clock=Date.now){
  this.db=sqlite;this.clock=clock;
  sqlite.exec(`CREATE TABLE IF NOT EXISTS auth_sessions (
   token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, csrf TEXT NOT NULL,
   expires INTEGER NOT NULL, renewed_at INTEGER NOT NULL
  ); CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires);
  CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id);`);
  this.cleanup();
 }
 cleanup(){this.db.prepare('DELETE FROM auth_sessions WHERE expires<=?').run(this.clock());}
 set(sid,session){
  this.cleanup();const now=this.clock();
  this.db.prepare('INSERT INTO auth_sessions VALUES (?,?,?,?,?)').run(key(sid),session.userId,session.csrf,now+SESSION_TTL,now);
 }
 get(sid){
  if(!/^[a-f0-9]{64}$/.test(sid))return null;
  const s=this.db.prepare('SELECT user_id AS userId,csrf,expires,renewed_at AS renewedAt FROM auth_sessions WHERE token_hash=?').get(key(sid));
  if(s&&s.expires<=this.clock()){this.delete(sid);return null;}return s;
 }
 renew(sid,s){
  const now=this.clock();if(now-s.renewedAt<RENEW_INTERVAL)return false;
  const updated=this.db.prepare('UPDATE auth_sessions SET expires=?,renewed_at=? WHERE token_hash=? AND expires>?').run(now+SESSION_TTL,now,key(sid),now);
  return updated.changes>0;
 }
 delete(sid){this.db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(key(sid));}
 revokeUser(userId){this.db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(userId);}
 get size(){return this.db.prepare('SELECT count(*) AS n FROM auth_sessions WHERE expires>?').get(this.clock()).n;}
}
module.exports={SessionStore,SESSION_TTL,RENEW_INTERVAL};
