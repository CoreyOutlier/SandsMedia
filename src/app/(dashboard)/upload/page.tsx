import { UploadForm } from "@/components/upload/upload-form";
import { storageConfigured } from "@/lib/upload/config";
import { database } from "@/lib/db";
import { uuid } from "@/lib/upload/validation";
import { requireDashboard } from "@/lib/dashboard";
export default async function UploadPage({searchParams}:{searchParams:Promise<{type?:string;patient?:string}>}) {
  const {session}=await requireDashboard();const params=await searchParams;
  const initialPatient=params.patient&&uuid(params.patient)?await database().patient.findFirst({where:{id:params.patient,clinic:{slug:process.env.CLINIC_SLUG??"dr-sands"}},select:{id:true,firstName:true,lastName:true,displayId:true,consentWithdrawnAt:true}}):null;
  return <UploadForm initialPatient={initialPatient?{id:initialPatient.id,firstName:initialPatient.firstName,lastName:initialPatient.lastName,displayId:initialPatient.displayId,consentWithdrawn:!!initialPatient.consentWithdrawnAt}:null} initialGeneral={params.type==="general"} initialUploader={session?.user?.name??""} maxVideoMB={Number(process.env.MAX_VIDEO_MB??500)} ready={storageConfigured()} testMode={process.env.SYNTHETIC_TEST_MODE!=="false"}/>;
}
