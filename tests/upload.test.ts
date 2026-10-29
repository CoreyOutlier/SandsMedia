import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { validateStart, UploadError, patientFolderName } from "../src/lib/upload/validation.ts";
import { seal, unseal, signCookie, readCookie, principalHash } from "../src/lib/upload/security.ts";
import { transfer } from "../src/lib/upload/browser.ts";

const photo=()=>({key:randomUUID(),fingerprint:"a".repeat(64),kind:"photo",label:"before",mimeType:"image/jpeg",bytes:200,width:2048,height:1000,durationS:null});
const video=()=>({...photo(),kind:"video",label:"testimonial",mimeType:"video/mp4",bytes:150*1024*1024,durationS:120});
const batch=()=>({uploadId:randomUUID(),kind:"patient",firstName:"Synthetic",lastName:"Fixture",treatment:"Test session",date:"2026-10-28",description:"",uploadedBy:"Test operator",consented:true,formOnFile:true,files:[photo(),photo(),video()]});
function rejects(value:unknown,code:string){assert.throws(()=>validateStart(value,500),(e:unknown)=>e instanceof UploadError&&e.code===code);}

test("mixed batches keep every file and generate names without device filenames",()=>{
  const input=batch();Object.assign(input.files[0],{name:"private-device-name.jpg",driveId:"untrusted",confirmed:true,encryptedUrl:"untrusted"});
  const result=validateStart(input,500);
  assert.deepEqual(result.files.map(f=>f.name),["before-01.jpg","before-02.jpg","testimonial-01.mp4"]);
  assert.equal(result.files.length,3);assert.equal(result.files[0].driveId,undefined);assert.equal(result.files[0].confirmed,undefined);
});
test("general batches require a title and cannot claim patient consent",()=>{
  const input={...batch(),kind:"general",title:"Team footage"};const result=validateStart(input,500);
  assert.equal(result.general,true);assert.equal(result.consented,false);assert.equal(result.firstName,"");assert.ok(result.files.every(f=>f.label==="other"));
  rejects({...input,title:""},"REQUIRED_FIELDS");
});
test("unticked consent remains a private hold intent",()=>{
  const result=validateStart({...batch(),consented:false,formOnFile:false},500);assert.equal(result.consented,false);
  rejects({...batch(),consented:false,formOnFile:true},"INVALID_CONSENT");
  rejects({...batch(),consented:"yes"},"INVALID_CONSENT");
});
test("long patient folder names retain the unique display ID",()=>{
  const name=patientFolderName("F".repeat(80),"L".repeat(80),"DS-12345");
  assert.ok(name.endsWith(" – DS-12345"));assert.ok(name.length<=160);
  assert.notEqual(name,patientFolderName("F".repeat(80),"L".repeat(80),"DS-12346"));
});
test("invalid dates, identifiers, empty and duplicate files are rejected",()=>{
  rejects({...batch(),date:"2026-02-30"},"INVALID_DATE");rejects({...batch(),patientId:"invalid"},"INVALID_PATIENT");
  rejects({...batch(),files:[]},"FILE_COUNT");const f=photo();rejects({...batch(),files:[f,f]},"INVALID_FILE");
  rejects({...batch(),firstName:"Name\nInjected"},"INVALID_FIELDS");
});
test("server validates image dimensions, MIME and video size/duration independently",()=>{
  rejects({...batch(),files:[{...photo(),width:3000}]},"INVALID_DIMENSIONS");
  rejects({...batch(),files:[{...photo(),mimeType:"text/html"}]},"UNSUPPORTED_FILE");
  rejects({...batch(),files:[{...video(),bytes:501*1024*1024}]},"FILE_TOO_LARGE");
  rejects({...batch(),files:[{...video(),durationS:181}]},"VIDEO_TOO_LONG");
  rejects({...batch(),files:[{...video(),durationS:NaN}]},"VIDEO_TOO_LONG");
  assert.throws(()=>validateStart(batch(),NaN),/UPLOAD_SETUP_REQUIRED/);
});
test("upload URLs are encrypted and tampering is rejected",()=>{
  process.env.COOKIE_SECRET="test-only-secret-never-used-in-any-deployment";
  const url="https://www.googleapis.com/test-upload-secret";const encrypted=seal(url);
  assert.equal(unseal(encrypted),url);assert.ok(!encrypted.includes(url));assert.notEqual(seal(url),encrypted);
  const bytes=Buffer.from(encrypted,"base64url");bytes[15]^=1;assert.throws(()=>unseal(bytes.toString("base64url")),/UPLOAD_SESSION_EXPIRED/);
});
test("passcode cookies reject expiry, payload changes and malformed suffixes",()=>{
  const data={clinicId:randomUUID(),id:randomUUID(),passcodeVersion:principalHash("test-hash"),expires:Date.now()+60000};
  const cookie=signCookie(data);assert.deepEqual(readCookie(cookie),data);
  assert.equal(readCookie(signCookie({...data,expires:1})),null);assert.equal(readCookie(cookie+".extra"),null);
  assert.equal(readCookie("invalid"),null);assert.equal(readCookie(signCookie({expires:Date.now()+60000})),null);
  assert.equal(readCookie(signCookie({...data,id:"different"}).split(".")[0]+"."+cookie.split(".")[1]),null);
});
test("resuming a video sends only the bytes Drive has not confirmed",async()=>{
  const original=globalThis.fetch;const requests:RequestInit[]=[];
  globalThis.fetch=async (_url,options)=>{requests.push(options!);return requests.length===1?new Response(null,{status:308,headers:{Range:"bytes=0-8388607"}}):new Response("{}",{status:200});};
  try{const file=new File([new Uint8Array(9*1024*1024)],"synthetic.mp4",{type:"video/mp4"});const progress:number[]=[];
    await transfer(file,"https://example.invalid/session",p=>progress.push(p),new AbortController().signal);
    assert.equal(requests.length,2);assert.equal((requests[1].headers as Record<string,string>)["Content-Range"],"bytes 8388608-9437183/9437184");assert.equal((requests[1].body as Blob).size,1024*1024);assert.equal(progress.at(-1),100);
  }finally{globalThis.fetch=original;}
});
test("an already completed Drive session does not upload a second file",async()=>{
  const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return new Response("{}",{status:200});};
  try{await transfer(new File(["test"],"synthetic.jpg"),"https://example.invalid/session",()=>{},new AbortController().signal);assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
test("expired resumable sessions and user pauses never report success",async()=>{
  const original=globalThis.fetch;let succeeded=false;globalThis.fetch=async()=>new Response(null,{status:410});
  try{await assert.rejects(transfer(new File(["test"],"synthetic.jpg"),"https://example.invalid/session",()=>{succeeded=true;},new AbortController().signal),/SESSION_EXPIRED/);assert.equal(succeeded,false);
    const controller=new AbortController();controller.abort();await assert.rejects(transfer(new File(["test"],"synthetic.jpg"),"https://example.invalid/session",()=>{},controller.signal),/paused/);
  }finally{globalThis.fetch=original;}
});
