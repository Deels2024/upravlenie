'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'uk-reopen-'));
const base='http://127.0.0.1:18990',env={...process.env,NODE_ENV:'test',HOST:'127.0.0.1',PORT:'18990',DB_FILE:path.join(tmp,'app.db'),UPLOAD_DIR:path.join(tmp,'uploads'),OWNER_LOGIN:'owner',OWNER_PASSWORD:'Reopen-Test-Only-2026!'};
let server,context;const errors=[];
async function start(){
 server=spawn(process.execPath,['server.js'],{cwd:root,env,stdio:'ignore'});
 for(let i=0;i<50;i++){try{if((await fetch(base+'/healthz')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Server failed to start');
}
async function stop(){if(server&&server.exitCode===null)await new Promise(r=>{server.once('exit',r);server.kill('SIGTERM');});}
async function reopen(){
 context=await chromium.launchPersistentContext(path.join(tmp,'browser'),{executablePath:process.env.BROWSER_EXECUTABLE,headless:true,viewport:{width:390,height:844},args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.goto(base);return page;
}
(async()=>{try{
 await start();let page=await reopen();await page.locator('[name="email"]').fill(env.OWNER_LOGIN);await page.locator('[name="password"]').fill(env.OWNER_PASSWORD);await page.locator('#loginForm [type="submit"]').click();await page.locator('#pageTitle').waitFor();
 const cookie=(await context.cookies()).find(c=>c.name==='sid');assert.ok(cookie.httpOnly);assert.ok(cookie.expires>Date.now()/1000+29*86400);assert.ok(!(await page.evaluate(()=>document.cookie)).includes('sid='));
 await context.close();await stop();await start();page=await reopen();await page.locator('#pageTitle').waitFor();assert.equal(await page.locator('#loginForm').count(),0,'browser and service restart preserve login');
 await page.route('**/api/me',r=>r.abort('failed'));await page.reload();await page.locator('#retrySession').waitFor();assert.equal(await page.locator('#loginForm').count(),0,'transport failure is not treated as logout');await page.unroute('**/api/me');await page.locator('#retrySession').click();await page.locator('#pageTitle').waitFor();
 await page.route('**/api/buildings',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"UNAVAILABLE"}'}));await page.reload();await page.locator('#retrySession').waitFor();assert.equal(await page.locator('#loginForm').count(),0,'data-load failure preserves session');await page.unroute('**/api/buildings');await page.locator('#retrySession').click();await page.locator('#pageTitle').waitFor();
 await page.locator('[data-view="settings"]:visible').click();
 await page.route('**/api/logout',r=>r.abort('failed'));await page.locator('#logoutMobile').click();assert.equal(await page.locator('#loginForm').count(),0,'failed logout must not pretend the durable session ended');await page.unroute('**/api/logout');
 await page.locator('#logoutMobile').click();await page.locator('#loginForm').waitFor();await context.close();await stop();await start();page=await reopen();await page.locator('#loginForm').waitFor();assert.equal(await page.locator('#pageTitle').count(),0,'explicit logout stays effective across restart');
 assert.deepEqual(errors,[]);console.log('Browser sessions: actual browser/service reopen, connection retry, failed logout and durable logout: OK');
}finally{await context?.close();await stop();fs.rmSync(tmp,{recursive:true,force:true});}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
