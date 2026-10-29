"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/upload/browser";
export function UploadPasscode(){const [passcode,setPasscode]=useState("");const [busy,setBusy]=useState(false);const [error,setError]=useState("");const router=useRouter();return <section className="upload-page"><h1>Clinic uploads</h1><p className="lede">Enter the clinic passcode to add photos and videos.</p><form onSubmit={async e=>{e.preventDefault();setBusy(true);setError("");try{await api("/api/upload-access",{passcode});setPasscode("");router.refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><div className="upload-field"><label htmlFor="passcode">Clinic passcode</label><input id="passcode" type="password" value={passcode} onChange={e=>setPasscode(e.target.value)} maxLength={100} required autoComplete="current-password"/></div>{error&&<p className="upload-error" role="alert">{error}</p>}<button className="button primary" disabled={busy}>{busy?"Checking…":"Continue to upload"}</button><Link className="button quiet" href="/signin">Agency Google sign-in</Link></form></section>;}
