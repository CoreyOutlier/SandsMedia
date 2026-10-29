import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID,createHash,randomInt} from 'node:crypto';
import {encode} from 'next-auth/jwt';
import pg from 'pg';
const origin=process.env.APP_URL;
assert.equal(origin,'http://localhost:3102');assert.equal(new URL(process.env.DATABASE_URL).pathname,'/sandsmedia_upload_test');
const jwt=await encode({secret:process.env.AUTH_SECRET,salt:'authjs.session-token',token:{sub:'test-user',name:'Portal Test',email:'allowed@example.test',verifiedGoogle:true},maxAge:3600});
const testIp=`2001:db8::${randomInt(1,65535).toString(16)}`;
const authCookie=`authjs.session-token=${jwt}`;
async function call(path,body,{expected=200,cookie=authCookie,ip=testIp}={}){const r=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{cookie,origin,'Content-Type':'application/json','x-vercel-forwarded-for':ip},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(120000)});if(r.status!==expected){let code='UNKNOWN';try{code=(await r.json()).error??'UNKNOWN';}catch{}throw new Error(`CHECK_FAILED_${r.status}_${code}`);}return r;}
async function api(path,body,options){return (await call(path,body,options)).json();}
const db=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000});let stage='setup';
try{
 await db.connect();
 const fixtureBuffers=await Promise.all(['photo-1.jpg','photo-2.jpg','synthetic-video.mp4'].map(n=>readFile(new URL('../qa/upload-fixtures/'+n,import.meta.url))));
 const plans=fixtureBuffers.map((b,i)=>({key:randomUUID(),fingerprint:createHash('sha256').update(b).digest('hex'),kind:i===2?'video':'photo',label:['before','after','testimonial'][i],mimeType:i===2?'video/mp4':'image/jpeg',bytes:b.length,width:640,height:480,durationS:i===2?2:null}));
 stage='patient_upload';
 const input={uploadId:randomUUID(),kind:'patient',firstName:'Portal',lastName:'Verification',treatment:'Porcelain veneers',date:'2026-10-29',description:'Synthetic fixture for complete-portal verification',uploadedBy:'Automated test',consented:true,formOnFile:true,files:plans};
 const batch=await api('/api/uploads/start',input);for(let i=0;i<plans.length;i++){const p=plans[i];const signed=await api(`/api/uploads/${batch.id}/sign`,{key:p.key});const r=await fetch(signed.url,{method:'PUT',headers:{'Content-Type':p.mimeType,'Content-Range':`bytes 0-${p.bytes-1}/${p.bytes}`},body:fixtureBuffers[i],signal:AbortSignal.timeout(60000)});assert.ok([200,201].includes(r.status));await api(`/api/uploads/${batch.id}/media`,{key:p.key});}await api(`/api/uploads/${batch.id}/finish`,{});
 const patientId=batch.patient.id;
 stage='directory';
 const byTreatment=await api('/api/library',{q:'veneers',filter:'cleared',media:'video'});assert.ok(byTreatment.rows.some(p=>p.id===patientId));
 const d=await api(`/api/patients/${patientId}`);assert.equal(d.clearance.status,'cleared');assert.equal(d.sessions[0].media.length,3);
 await call('/api/library',{}, {cookie:'',expected:401});await call('/api/admin',undefined,{cookie:'',expected:401});
 const photo=d.sessions[0].media[0],video=d.sessions[0].media[2];
 stage='private_media';await call(photo.thumbnail,undefined,{cookie:'',expected:401});
 stage="private_thumbnail";const thumb=await call(photo.thumbnail);assert.ok(thumb.headers.get('content-type').startsWith('image/'));assert.ok((await thumb.arrayBuffer()).byteLength>100);
 stage="video_range";const range=await fetch(origin+video.stream,{headers:{cookie:authCookie,Range:'bytes=0-127'}});assert.equal(range.status,206);assert.ok(range.headers.get('content-range').startsWith('bytes 0-127/'));assert.equal((await range.arrayBuffer()).byteLength,128);
 stage="invalid_range";const badRange=await fetch(origin+video.stream,{headers:{cookie:authCookie,Range:'bytes=999999999999-'}});assert.equal(badRange.status,416);
 stage="single_download";const single=await call(photo.download);assert.ok(single.headers.get('content-disposition').includes('attachment'));assert.equal((await single.arrayBuffer()).byteLength,plans[0].bytes);
 stage="general_lookup";const general=(await api('/api/library',{general:true,q:'Synthetic general',media:'video'})).rows[0];assert.ok(general);const gd=await api(`/api/general/${general.id}`);
 stage="large_stream";const large=await call(gd.sessions[0].media[0].stream);assert.ok((await large.arrayBuffer()).byteLength>8*1024*1024);
 stage='zip';const zip=await call(d.download);const zipBytes=Buffer.from(await zip.arrayBuffer());assert.equal(zipBytes.readUInt32LE(0),0x04034b50);await writeFile(new URL('../qa/portal-private-test.zip',import.meta.url),zipBytes);assert.ok(zipBytes.includes(Buffer.from('consent.json')));assert.ok(zipBytes.includes(Buffer.from('before-01.jpg')));
 stage='share_create';const created=await api('/api/shares',{patientId,days:1});const token=new URL(created.url).pathname.split('/').pop();stage='share_view';let shared=await api('/api/share-view',{token},{cookie:''});assert.equal(shared.sessions.length,1);assert.equal(shared.name,'Portal V.');const publicPhoto=shared.sessions[0].media[0];stage='shared_thumbnail';await call(publicPhoto.thumbnail,undefined,{cookie:''});
 stage='shared_zip';const publicZip=Buffer.from(await (await call(shared.download,undefined,{cookie:''})).arrayBuffer());assert.ok(!publicZip.includes(Buffer.from('consent.json')));assert.ok(publicZip.includes(Buffer.from('before-01.jpg')));await writeFile(new URL('../qa/portal-public-test.zip',import.meta.url),publicZip);
 const listing=await api(`/api/patients/${patientId}`);assert.ok(listing.links[0].viewCount>=1);assert.equal('tokenHash' in listing.links[0],false);assert.equal('pinHash' in listing.links[0],false);
 const stored=(await db.query('SELECT token_hash FROM share_links WHERE id=$1',[listing.links[0].id])).rows[0];assert.equal(stored.token_hash,createHash('sha256').update(token).digest('hex'));assert.notEqual(stored.token_hash,token);
 stage='og_image';const og=await call('/share-image?token='+token,undefined,{cookie:''});assert.equal(og.headers.get('content-type'),'image/png');assert.ok((await og.arrayBuffer()).byteLength>1000);
 await api(`/api/shares/${listing.links[0].id}`,{});await call(publicPhoto.stream,undefined,{cookie:'',expected:403});const expired=await (await call('/s/'+token,undefined,{cookie:''})).text();assert.ok(expired.includes('This link has expired'));assert.ok(!expired.includes('Portal V.'));
 stage='pin';const pinLink=await api('/api/shares',{patientId,days:7,pin:'6491'});const pinToken=new URL(pinLink.url).pathname.split('/').pop();const lockedHtml=await (await call('/s/'+pinToken,undefined,{cookie:''})).text();assert.ok(lockedHtml.includes('4-digit PIN'));assert.ok(!lockedHtml.includes('Portal V.'));await call('/api/share-view',{token:pinToken},{cookie:'',expected:401});await call('/api/share-access',{token:pinToken,pin:'0000'},{cookie:'',expected:401});const unlocked=await call('/api/share-access',{token:pinToken,pin:'6491'},{cookie:''});const pinCookie=unlocked.headers.get('set-cookie').split(';')[0];shared=await api('/api/share-view',{token:pinToken},{cookie:pinCookie});assert.equal(shared.sessions.length,1);
 for(let i=0;i<5;i++)await call('/api/share-access',{token:pinToken,pin:'0000'},{cookie:'',ip:testIp+':1',expected:401});await call('/api/share-access',{token:pinToken,pin:'6491'},{cookie:'',ip:testIp+':1',expected:429});
 stage='consent_withdrawal';await api(`/api/patients/${patientId}`,{action:'status',sessionId:d.sessions[0].id,status:'posted'});const withdrawn=await api(`/api/patients/${patientId}`,{action:'withdraw'});assert.equal(withdrawn.clearance.status,'withdrawn');assert.equal(withdrawn.postedSessions.length,1);assert.ok(withdrawn.links.every(l=>l.revokedAt));await call(shared.sessions[0].media[0].stream,undefined,{cookie:'',expected:403});await call('/api/shares',{patientId,days:7},{expected:409});await call(`/api/patients/${patientId}`,{action:'status',sessionId:d.sessions[0].id,status:'ready'},{expected:409});
 stage='admin';const settings=await api('/api/admin');assert.ok(settings.emails.includes('allowed@example.test'));const originalPass=await readFile(new URL('../qa/upload-test-passcode.txt',import.meta.url),'utf8');const passLogin=await call('/api/upload-access',{passcode:originalPass.trim()},{cookie:'',ip:testIp+':2'});const uploadCookie=passLogin.headers.get('set-cookie').split(';')[0];await call('/api/library',{}, {cookie:uploadCookie,expected:401});
 await api('/api/admin',{action:'passcode',passcode:'Synthetic-rotation-only-2026'});await call('/api/patients/search',{q:'Portal'},{cookie:uploadCookie,expected:401});await api('/api/admin',{action:'passcode',passcode:originalPass.trim()});
 const recon=await api('/api/admin',{action:'reconcile'});assert.ok(recon.checked>0);assert.equal(recon.mismatched,0);
 const cron=await fetch(origin+'/api/cron/reconcile');assert.equal(cron.status,401);
 console.info('PASS: live Drive directory/search/filters, private thumbnails, video ranges, >8 MiB streaming, originals and ZIP, hashed expiring/PIN links, view logs, revoke/withdrawal, passcode rotation, upload-only isolation, and storage reconciliation.');
}catch(e){console.error('PORTAL_INTEGRATION_FAILED_'+stage+(/^CHECK_FAILED_[A-Z0-9_]+$/.test(e.message)?'_'+e.message:''));process.exitCode=1;}finally{await db.end();}
