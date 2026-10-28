import { Library } from "@/components/library";
import { dashboardClinic } from "@/lib/dashboard";
export default async function OtherUploads() { const clinic = await dashboardClinic(); return <Library general connected={Boolean(clinic)}/>; }
