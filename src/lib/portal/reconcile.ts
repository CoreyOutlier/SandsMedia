import { database } from "@/lib/db";
import { drive } from "@/lib/upload/drive";
import { confirmFile } from "@/lib/upload/service";
import { retryPendingDeletions } from "./deletion";
import type { FilePlan } from "@/lib/upload/validation";
// Recover only preallocated files from a recorded upload manifest. Database
// deletion markers override Drive contents, including manually restored files.
export async function reconcile(clinicId:string){
 const deletionCleanup=await retryPendingDeletions(clinicId);
 const db=database();const clinic=await db.clinic.findUniqueOrThrow({where:{id:clinicId}});
 const root=(await drive().files.get({fileId:clinic.driveRootFolderId,supportsAllDrives:true,fields:"driveId"})).data;
 const sharedDriveId=root.driveId??clinic.driveRootFolderId;
 const remote=new Map<string,{parents?:string[]|null;size?:string|null}>();let pageToken:string|undefined;
 do{const page=await drive().files.list({corpora:"drive",driveId:sharedDriveId,includeItemsFromAllDrives:true,supportsAllDrives:true,q:"trashed=false",pageSize:1000,pageToken,fields:"files(id,parents,size),nextPageToken"});for(const f of page.data.files??[])if(f.id)remote.set(f.id,f);pageToken=page.data.nextPageToken??undefined;}while(pageToken);
 const batches=await db.uploadBatch.findMany({where:{clinicId,OR:[{session:{patient:{deletedAt:null}}},{generalUploadId:{not:null}}]},include:{session:{include:{media:true}},generalUpload:{include:{media:true}}}});
 let recovered=0,missing=0,mismatched=0,unfinished=0;
 for(const b of batches){const item=b.session??b.generalUpload!;if(!item.finishedAt)unfinished++;
  for(const plan of b.manifest as unknown as FilePlan[]){if(!plan.driveId||plan.deletedAt)continue;const actual=remote.get(plan.driveId);if(plan.confirmed&&!actual){missing++;continue;}if(actual&&!actual.parents?.includes((plan.kind==="photo"?b.photosFolderId:b.videosFolderId)??"")){mismatched++;continue;}
   if(!plan.confirmed&&actual){try{await confirmFile(b.id,plan.key,{clinic,principalHash:b.principalHash,email:null});recovered++;}catch{mismatched++;}}
  }
 }
 return {checked:batches.length,recovered,missing,mismatched,unfinished,deletionCleanupCompleted:deletionCleanup.completed,deletionCleanupPending:deletionCleanup.pending,checkedAt:new Date().toISOString()};
}
