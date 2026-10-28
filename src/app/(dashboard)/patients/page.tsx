import { Library } from "@/components/library";
import { dashboardClinic } from "@/lib/dashboard";
export default async function Patients() { const clinic = await dashboardClinic(); return <Library connected={Boolean(clinic)}/>; }
