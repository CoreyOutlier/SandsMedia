import { Library } from "@/components/portal/library";
export default async function Patients({searchParams}:{searchParams:Promise<{patient?:string}>}) { const q=await searchParams;return <Library initialId={q.patient??""}/>; }
