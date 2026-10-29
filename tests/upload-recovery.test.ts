import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { api } from "../src/lib/upload/browser.ts";
import { UploadRequestError,canDiscardStart,unavailableResume,readPendingUpload,rememberUpload,forgetUpload,pendingUploadKey,reconcileSelection } from "../src/lib/upload/recovery.ts";
import type { FilePlan } from "../src/lib/upload/validation.ts";

test("rejected first starts unlock the draft, but uncertain retries retain their upload ID",()=>{
  const invalid=new UploadRequestError("Safe message","INVALID_LABEL",400);
  assert.equal(canDiscardStart(invalid,true),true);
  assert.equal(canDiscardStart(invalid,false),false);
  for(const [code,status] of [["NETWORK_ERROR",0],["INVALID_RESPONSE",502],["UPLOAD_UNAVAILABLE",503],["UPLOAD_NOT_FOUND",404],["SIGN_IN_REQUIRED",401],["PATIENT_ARCHIVED",409]] as const){
    assert.equal(canDiscardStart(new UploadRequestError("Safe message",code,status),true),false);
  }
});

test("missing uploads require explicit recovery and never prove another account's upload is absent",()=>{
  assert.equal(unavailableResume(new UploadRequestError("Safe message","UPLOAD_NOT_FOUND",404)),true);
  assert.equal(unavailableResume(new UploadRequestError("Safe message","SIGN_IN_REQUIRED",401)),false);
  assert.equal(unavailableResume(new UploadRequestError("Safe message","NOT_FOUND",404)),false);
});

test("pending storage contains only a UUID and completion cannot erase a newer attempt",()=>{
  const entries=new Map<string,string>();
  const storage={getItem:(key:string)=>entries.get(key)??null,setItem:(key:string,value:string)=>{entries.set(key,value);},removeItem:(key:string)=>{entries.delete(key);}};
  const first=randomUUID(),second=randomUUID();rememberUpload(storage,first);assert.equal(readPendingUpload(storage),first);
  rememberUpload(storage,second);forgetUpload(storage,first);assert.equal(readPendingUpload(storage),second);
  assert.deepEqual([...entries.keys()],[pendingUploadKey]);forgetUpload(storage,second);assert.equal(readPendingUpload(storage),null);
  storage.setItem(pendingUploadKey,"broken-hint");assert.equal(readPendingUpload(storage),null);assert.equal(entries.size,0);
  const blocked={getItem:()=>{throw new Error("Unavailable");},setItem:()=>{throw new Error("Unavailable");},removeItem:()=>{throw new Error("Unavailable");}};
  assert.equal(readPendingUpload(blocked),null);assert.doesNotThrow(()=>rememberUpload(blocked,first));assert.doesNotThrow(()=>forgetUpload(blocked));
});

test("restored files follow saved categories and keys, discard unrelated picks, and match duplicate slots once",()=>{
  const plan=(key:string,fingerprint:string,confirmed=false):FilePlan=>({key,fingerprint,confirmed,kind:"photo",label:"after",mimeType:"image/jpeg",bytes:100,width:10,height:10,durationS:null,name:"after-01.jpg"});
  const plans=[plan("saved-a","same",true),plan("saved-b","same")];
  const selected=[{plan:{key:"saved-a",fingerprint:"same"},progress:20},{plan:{key:"new-key",fingerprint:"same"},progress:80},{plan:{key:"extra",fingerprint:"same"},progress:0},{plan:{key:"unrelated",fingerprint:"different"},progress:0}];
  const result=reconcileSelection(selected,plans);
  assert.deepEqual(result.kept.map(f=>[f.plan.key,f.plan.label,f.progress]),[["saved-a","after",100],["saved-b","after",0]]);
  assert.deepEqual(result.discarded.map(f=>f.plan.key),["extra","unrelated"]);
  assert.equal(plans.length,2);assert.equal(selected.length,4);
});

test("browser errors retain safe recovery codes without exposing upstream messages",async()=>{
  const original=globalThis.fetch;
  try{
    globalThis.fetch=async()=>Response.json({error:"UPLOAD_NOT_FOUND",message:"sensitive upstream detail"},{status:404});
    await assert.rejects(api("/api/uploads/synthetic/status"),(error:unknown)=>error instanceof UploadRequestError&&unavailableResume(error)&&!error.message.includes("sensitive")&&!error.message.includes("unavailable for your account"));
    globalThis.fetch=async()=>{throw new Error("sensitive connection detail");};
    await assert.rejects(api("/api/uploads/start",{}),(error:unknown)=>error instanceof UploadRequestError&&error.code==="NETWORK_ERROR"&&!canDiscardStart(error,true)&&!error.message.includes("sensitive"));
    globalThis.fetch=async()=>new Response("upstream details",{status:502});
    await assert.rejects(api("/api/uploads/start",{}),(error:unknown)=>error instanceof UploadRequestError&&error.code==="INVALID_RESPONSE"&&!canDiscardStart(error,true));
  }finally{globalThis.fetch=original;}
});
