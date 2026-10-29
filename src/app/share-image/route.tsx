import { ImageResponse } from "@vercel/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { findShare } from "@/lib/portal/shares";
export const runtime="nodejs";
export async function GET(request:Request){
 let treatment="Cosmetic dentistry";try{const token=new URL(request.url).searchParams.get("token");const link=token?await findShare(token):null;const raw=link?.patient.sessions.find(s=>s.finishedAt&&s.consentEvents.some(e=>e.consented))?.treatment??"";
 // Only recognized treatment categories enter previews. Never include arbitrary
 // patient-entered text, identity, notes, or photos in link previews.
 treatment=["Porcelain veneers","Teeth whitening","Invisalign","Smile makeover","Dental bonding","Dental implants","Crowns","Gum contouring"].find(x=>raw.toLowerCase().includes(x.toLowerCase()))??treatment;
 }catch{/* Generic brand preview remains available without exposing errors. */}
 const logo=await readFile(join(process.cwd(),"public/brand/logo.svg"));const font=await readFile(join(process.cwd(),"public/brand/fonts/open-sans-400.ttf"));
 return new ImageResponse(<div style={{width:"100%",height:"100%",background:"#fff",display:"flex",flexDirection:"column",padding:"70px 85px",fontFamily:"OpenSans",color:"#303030"}}><img src={`data:image/svg+xml;base64,${logo.toString("base64")}`} width={340} height={95} alt="Dr. Sands"/><div style={{marginTop:75,fontSize:62,display:"flex"}}>Before and after</div><div style={{fontSize:32,color:"#777",marginTop:12,display:"flex"}}>{treatment}</div><div style={{display:"flex",marginTop:"auto",fontSize:20,letterSpacing:3,color:"#777"}}>PRIVATE MEDIA · BEVERLY HILLS</div></div>,{width:1200,height:630,fonts:[{name:"OpenSans",data:font,weight:400}],headers:{"Cache-Control":"private, no-store"}});
}
