import { UploadForm } from "@/components/upload/upload-form";
import { storageConfigured } from "@/lib/upload/drive";
import { requireDashboard } from "@/lib/dashboard";
export default async function UploadPage({searchParams}:{searchParams:Promise<{type?:string}>}) {
  const {session}=await requireDashboard();const params=await searchParams;
  return <UploadForm initialGeneral={params.type==="general"} initialUploader={session?.user?.name??""} maxVideoMB={Number(process.env.MAX_VIDEO_MB??500)} ready={storageConfigured()} testMode={process.env.SYNTHETIC_TEST_MODE!=="false"}/>;
}
