import { notFound } from "next/navigation";
import { Brand } from "@/components/brand";
import { UploadForm } from "@/components/upload/upload-form";
import { UploadPasscode } from "@/components/upload/passcode";
import { uploadIdentity } from "@/lib/upload/http";
import { storageConfigured } from "@/lib/upload/drive";
export const dynamic="force-dynamic";
export default async function ClinicUpload({params}:{params:Promise<{slug:string}>}){const {slug}=await params;if(slug!==(process.env.CLINIC_SLUG??"dr-sands"))notFound();let allowed=false;try{await uploadIdentity();allowed=true;}catch{}return <main className="clinic-upload"><header className="clinic-upload-brand"><Brand compact/></header>{allowed?<UploadForm maxVideoMB={Number(process.env.MAX_VIDEO_MB??500)} ready={storageConfigured()} testMode={process.env.SYNTHETIC_TEST_MODE!=="false"}/>:<UploadPasscode/>}</main>;}
