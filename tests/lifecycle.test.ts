import test from "node:test";
import assert from "node:assert/strict";
import {canCompleteRenewal} from "../src/lib/portal/lifecycle-policy.ts";
import {clearance} from "../src/lib/clearance.ts";
import {activeLink} from "../src/lib/portal/security.ts";
test("archived patients cannot be socially cleared or reached with media capabilities",()=>{
 const patient={archivedAt:new Date(),consentWithdrawnAt:null,sessions:[{finishedAt:new Date(),consentEvents:[{consented:true}]}]};
 assert.equal(clearance(patient).status,"archived");assert.equal(activeLink({patient,revokedAt:null,expiresAt:new Date(Date.now()+10000)}),false);
});
test("renewal cannot overwrite a later withdrawal or archive/restore cycle",()=>{
 const patient={archivedAt:null,consentWithdrawnAt:new Date(),lifecycleVersion:7};
 assert.equal(canCompleteRenewal(patient,7),true);
 assert.equal(canCompleteRenewal({...patient,lifecycleVersion:8},7),false);
 assert.equal(canCompleteRenewal({...patient,archivedAt:new Date()},7),false);
 assert.equal(canCompleteRenewal({...patient,consentWithdrawnAt:null},7),false);
});
test("restoring consent or archive status cannot revive revoked share links",()=>{
 const patient={archivedAt:null,consentWithdrawnAt:null};
 assert.equal(activeLink({patient,revokedAt:new Date(),expiresAt:new Date(Date.now()+10000)}),false);
});
test("new privately stored sessions cannot override a patient's social withdrawal",()=>{
 const patient={archivedAt:null,consentWithdrawnAt:new Date(),sessions:[{finishedAt:new Date(),consentEvents:[{consented:true}]}]};
 for(const consentEvents of [[],[{consented:true}]]){
  const uploaded={...patient,sessions:[...patient.sessions,{finishedAt:new Date(),consentEvents}]};
  assert.equal(clearance(uploaded).status,"withdrawn");
  assert.equal(activeLink({patient:uploaded,revokedAt:null,expiresAt:new Date(Date.now()+10000)}),false);
 }
});
