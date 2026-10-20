/** Three perspectives meeting in one mark. Custom vector geometry, shared by the app and sign-in. */
export function BrandMark({ className = "h-9 w-9" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 40 40" fill="none" aria-hidden="true">
    <rect width="40" height="40" rx="10" fill="currentColor" />
    <path d="M11 26V18M20 26V11M29 26V15" stroke="var(--mark-stroke, #fff)" strokeWidth="3" strokeLinecap="round" />
    <path d="M10 31H30" stroke="var(--mark-stroke, #fff)" strokeWidth="1.5" strokeLinecap="round" opacity=".5" />
  </svg>;
}

export default function Brand({ caption }: { caption?: string }) {
  return <div className="brand-lockup">
    <BrandMark />
    <div><div className="brand-wordmark" dir="ltr">EduSkills<span>AI</span></div>{caption && <div className="brand-caption">{caption}</div>}</div>
  </div>;
}
