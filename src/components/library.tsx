import { Icon } from "./icons";

export function Library({ general = false, connected }: { general?: boolean; connected: boolean }) {
  return <section className="library">
    <div className="page-heading"><div><p className="eyebrow">Posting Center / Media library</p>
      <h1>{general ? "Other uploads" : "Patients"}</h1>
      <p className="lede">{general ? "A place for everything beyond patient before and afters." : "Every patient. Every session. Consent always in view."}</p>
    </div><span className="private-label"><Icon name="lock"/>Private library</span></div>
    <div className="library-grid"><div className="library-list">
      <div className="list-heading"><span>{general ? "Your uploads" : "Patient directory"}</span><span>—</span></div>
      <div className="list-empty"><Icon name={general ? "media" : "patients"}/><p>{general ? "Your footage will live here." : "Your patients will appear here."}</p></div>
      <div className="library-note">{general ? "Clinic moments, team content, educational videos, and raw footage." : "Patient media stays organized by patient and treatment session."}</div>
    </div><div className="empty-detail">
      <span className="empty-icon"><Icon name={general ? "media" : "patients"}/></span>
      <p className="eyebrow">{general ? "Room for the whole story" : "Designed around each patient"}</p>
      <h2>{general ? "More than before and afters." : "A clear view of every smile."}</h2>
      <p>{general ? "Keep general photos and videos together, without adding a patient. Original footage will be stored in the clinic’s Google Drive." : "Before and after photos, videos, and testimonials will come together here, with each patient’s consent status at the top."}</p>
      <div className="setup-note"><span className="status-dot"/><div><strong>{connected ? "Your library is connected" : "Your library is being connected"}</strong><span>Uploads and browsing are coming in the next build steps.</span></div></div>
      <div className="detail-footer"><Icon name="lock"/><span>Only your authorized clinic and agency team can access this library.</span></div>
    </div></div>
  </section>;
}
