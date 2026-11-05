import assert from 'node:assert/strict';
import test from 'node:test';
import {sessionOnlineReady} from '../src/lib/portal/posting-policy.ts';
const patient={lifecycleVersion:3,consentWithdrawnAt:null,archivedAt:null,deletedAt:null};
const approval={id:'audit',mediaId:'photo',version:1,action:'approved',policyTextVersion:1,patientVersion:3,fileChecksum:'a'.repeat(64),exportChecksum:'b'.repeat(64),driveVersion:'2',md5Checksum:'c'.repeat(32)};
const photo={id:'photo',kind:'photo',anonymousUseVersion:1,deletedAt:null,useEvents:[approval]};
const session={finishedAt:new Date(),consentEvents:[],media:[photo]};
test('only finished uploads whose every active file has a posting basis are ready',()=>{
 assert.equal(sessionOnlineReady(patient,session),true);
 assert.equal(sessionOnlineReady(patient,{...session,finishedAt:null}),false);
 assert.equal(sessionOnlineReady(patient,{...session,media:[]}),false);
 assert.equal(sessionOnlineReady(patient,{...session,media:[photo,{...photo,id:'video',kind:'video',useEvents:[]}]}),false);
 assert.equal(sessionOnlineReady(patient,{...session,media:[photo,{...photo,id:'private',useEvents:[]}]}),false);
 assert.equal(sessionOnlineReady(patient,{...session,media:[photo,{...photo,id:'deleted',deletedAt:new Date(),useEvents:[]}]}),true);
});
test('written consent and anonymous approvals stay separate and respect lifecycle holds',()=>{
 const written={...session,consentEvents:[{consented:true}],media:[{...photo,kind:'video',useEvents:[]}]};
 assert.equal(sessionOnlineReady(patient,written),true);
 for(const key of ['consentWithdrawnAt','archivedAt','deletedAt']){
  assert.equal(sessionOnlineReady({...patient,[key]:new Date()},session),false);
  assert.equal(sessionOnlineReady({...patient,[key]:new Date()},written),false);
 }
 assert.equal(sessionOnlineReady({...patient,lifecycleVersion:4},session),false);
 assert.equal(sessionOnlineReady(patient,{...session,media:[{...photo,anonymousUseVersion:2}]}),false);
});
