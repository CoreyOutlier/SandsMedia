import test from "node:test";
import assert from "node:assert/strict";
import { withdrawPatient } from "../src/components/portal/types.ts";
test("withdrawal retries a transient failure once with the same idempotent action",async()=>{
 const original=globalThis.fetch;const calls:{path:string;body:unknown}[]=[];
 globalThis.fetch=async(path,init)=>{calls.push({path:String(path),body:JSON.parse(String(init?.body))});return calls.length===1?Response.json({error:"UPLOAD_UNAVAILABLE"},{status:503}):Response.json({id:"fixture",clearance:{status:"withdrawn"}});};
 try{assert.equal((await withdrawPatient("fixture")).clearance?.status,"withdrawn");assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert.deepEqual(calls[0].body,{action:"withdraw"});}finally{globalThis.fetch=original;}
});
test("withdrawal never retries an authorization failure or loops on server failures",async()=>{
 const original=globalThis.fetch;
 try{for(const status of [401,503]){let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({error:status===401?"SIGN_IN_REQUIRED":"UPLOAD_UNAVAILABLE"},{status});};await assert.rejects(()=>withdrawPatient("fixture"));assert.equal(calls,status===401?1:2);}}finally{globalThis.fetch=original;}
});
