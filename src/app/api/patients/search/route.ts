import { database } from "@/lib/db";
import { uploadIdentity,uploadResponse,uploadFailure } from "@/lib/upload/http";
export async function POST(request:Request) {
  try {
    // Search text is in a bounded POST body, never in Vercel's URL/request log.
    const {jsonBody}=await import("@/lib/upload/http");const body=await jsonBody(request);const {clinic}=await uploadIdentity();
    const q:string=typeof body.q==="string"?body.q.trim().slice(0,100):"";if(q.length<2)return uploadResponse({patients:[]});
    const patients=await database().patient.findMany({where:{clinicId:clinic.id,archivedAt:null,OR:[{AND:q.split(/\s+/).filter(Boolean).map(part=>({OR:[{firstName:{contains:part,mode:"insensitive" as const}},{lastName:{contains:part,mode:"insensitive" as const}}]}))},{displayId:{contains:q,mode:"insensitive"}}]},select:{id:true,firstName:true,lastName:true,displayId:true},take:12,orderBy:{lastName:"asc"}});
    return uploadResponse({patients});
  }catch(e){return uploadFailure(e);}
}
