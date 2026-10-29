import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { transfer } from "../src/lib/upload/browser.ts";

const GiB=1024**3;
const chunkBytes=8*1024**2;
const sampleChunk=new Blob([new Uint8Array(chunkBytes)]);
const session="https://example.invalid/synthetic-large-upload";
function virtualFile(size:number){
  const slices:{start:number;end:number}[]=[];
  const file={size,type:"video/mp4",slice(start:number,end:number){
    assert.ok(Number.isSafeInteger(start)&&Number.isSafeInteger(end));
    assert.ok(start>=0&&end>start&&end<=size);
    assert.ok(end-start<=chunkBytes,"transfer must not buffer the full video");
    slices.push({start,end});return sampleChunk.slice(0,end-start);
  }} as unknown as File;
  return {file,slices};
}
const response=(status:number,range?:string)=>new Response(null,{status,headers:range===undefined?{}:{Range:range}});
// Run retry timers without waiting in real time. setImmediate lets each fetch /
// body promise settle before advancing the next exponential backoff timer.
async function settleRetries(t:TestContext,promise:Promise<void>){
  let settled=false;
  const result=promise.then(()=>({error:null}),error=>({error})).finally(()=>{settled=true;});
  for(let i=0;i<20&&!settled;i++){await new Promise<void>(resolve=>setImmediate(resolve));t.mock.timers.tick(10000);}
  assert.ok(settled,"transfer must settle after bounded retries");
  return result;
}

test("large videos resume across 4 GiB and send bounded final chunks near 5 GiB",async()=>{
  const original=globalThis.fetch;
  try{
    for(const [size,start] of [[4*GiB+chunkBytes+19,4*GiB-4],[5*GiB,5*GiB-chunkBytes-23]]){
      const {file,slices}=virtualFile(size);const requests:RequestInit[]=[];const progress:number[]=[];
      globalThis.fetch=async (_url,options)=>{
        requests.push(options!);
        if(requests.length===1)return response(308,`bytes=0-${start-1}`);
        if(requests.length===2){assert.equal(progress[0],Math.floor(start/size*100));return response(308,`bytes=0-${start+chunkBytes-1}`);}
        assert.ok(!progress.includes(100),"incomplete chunks must not display completion");return response(201);
      };
      await transfer(file,session,value=>progress.push(value),new AbortController().signal);
      assert.deepEqual(slices,[{start,end:start+chunkBytes},{start:start+chunkBytes,end:size}]);
      assert.equal(new Headers(requests[0].headers).get("Content-Range"),`bytes */${size}`);
      assert.equal(new Headers(requests[1].headers).get("Content-Range"),`bytes ${start}-${start+chunkBytes-1}/${size}`);
      assert.equal(new Headers(requests[2].headers).get("Content-Range"),`bytes ${start+chunkBytes}-${size-1}/${size}`);
      assert.equal((requests[2].body as Blob).size,23);assert.equal(progress.at(-1),100);
    }
  }finally{globalThis.fetch=original;}
});

test("invalid large-video status ranges stop after bounded retries without sending bytes",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});const original=globalThis.fetch;
  try{
    const size=5*GiB;
    for(const range of ["bytes=1-12","bytes=0-nope","bytes=0-9007199254740992",`bytes=0-${size-1}`,`bytes=0-${size}`,"bytes=0-1,4-5"]){
      const {file,slices}=virtualFile(size);let calls=0;const progress:number[]=[];
      globalThis.fetch=async()=>{calls++;return response(308,range);};
      const {error}=await settleRetries(t,transfer(file,session,value=>progress.push(value),new AbortController().signal));
      assert.match(error?.message??"",/Connection interrupted/);assert.equal(calls,6);assert.equal(slices.length,0);assert.ok(!progress.includes(100));
    }
  }finally{globalThis.fetch=original;}
});

test("invalid chunk acknowledgements re-query Drive instead of skipping unconfirmed bytes",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});const original=globalThis.fetch;
  try{
    const size=5*GiB;const start=size-chunkBytes-23;
    for(const range of [undefined,"bytes=8-12",`bytes=0-${start-1}`,`bytes=0-${start+chunkBytes}`,`bytes=0-${size-1}`]){
      const {file,slices}=virtualFile(size);let calls=0;const progress:number[]=[];
      globalThis.fetch=async (_url,options)=>{
        calls++;const requested=new Headers(options!.headers).get("Content-Range");
        return requested===`bytes */${size}`?response(308,`bytes=0-${start-1}`):response(308,range);
      };
      const {error}=await settleRetries(t,transfer(file,session,value=>progress.push(value),new AbortController().signal));
      assert.match(error?.message??"",/Connection interrupted/);assert.equal(calls,12);assert.equal(slices.length,6);
      assert.ok(slices.every(slice=>slice.start===start&&slice.end===start+chunkBytes));assert.ok(!progress.includes(100));
    }
  }finally{globalThis.fetch=original;}
});

test("a completed large upload is acknowledged without slicing or retransmitting it",async()=>{
  const original=globalThis.fetch;const {file,slices}=virtualFile(5*GiB);const progress:number[]=[];let calls=0;
  globalThis.fetch=async()=>{calls++;return response(200);};
  try{await transfer(file,session,value=>progress.push(value),new AbortController().signal);assert.equal(calls,1);assert.equal(slices.length,0);assert.deepEqual(progress,[100]);}
  finally{globalThis.fetch=original;}
});

test("a full-length incomplete acknowledgement is rechecked before reporting success",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});const original=globalThis.fetch;const {file,slices}=virtualFile(5*GiB);const progress:number[]=[];let calls=0;
  globalThis.fetch=async()=>{calls++;return calls===1?response(308,`bytes=0-${file.size-1}`):response(200);};
  try{
    const {error}=await settleRetries(t,transfer(file,session,value=>progress.push(value),new AbortController().signal));
    assert.equal(error,null);assert.equal(calls,2);assert.equal(slices.length,0);assert.deepEqual(progress,[100]);
  }finally{globalThis.fetch=original;}
});

test("expired large upload sessions do not retry or report completion",async()=>{
  const original=globalThis.fetch;
  try{
    for(const status of [404,410])for(const expiredDuringChunk of [false,true]){
      const {file,slices}=virtualFile(5*GiB);let calls=0;const progress:number[]=[];
      globalThis.fetch=async()=>{calls++;return expiredDuringChunk&&calls===1?response(308,`bytes=0-${4*GiB-1}`):response(status);};
      await assert.rejects(transfer(file,session,value=>progress.push(value),new AbortController().signal),/SESSION_EXPIRED/);
      assert.equal(calls,expiredDuringChunk?2:1);assert.equal(slices.length,expiredDuringChunk?1:0);assert.ok(!progress.includes(100));
    }
  }finally{globalThis.fetch=original;}
});

test("pausing interrupts a large upload retry wait immediately",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});const original=globalThis.fetch;const {file,slices}=virtualFile(5*GiB);const controller=new AbortController();let calls=0;
  globalThis.fetch=async()=>{calls++;throw new TypeError("Synthetic offline connection");};
  try{
    const promise=transfer(file,session,()=>assert.fail("offline upload cannot report progress"),controller.signal);
    const rejection=assert.rejects(promise,/Upload paused/);
    await new Promise<void>(resolve=>setImmediate(resolve));controller.abort();await rejection;
    assert.equal(calls,1);assert.equal(slices.length,0);
    t.mock.timers.tick(60000);await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(calls,1);
  }finally{globalThis.fetch=original;}
});
