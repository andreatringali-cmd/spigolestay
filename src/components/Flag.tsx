// Bandiere SVG (le emoji-bandiera non vengono disegnate su Windows).
export default function Flag({ code, className = "h-3.5 w-5" }: { code: string; className?: string }) {
  const cls = `inline-block shrink-0 overflow-hidden rounded-[2px] ring-1 ring-black/10 ${className}`;
  switch (code) {
    case "it":
      return (
        <svg viewBox="0 0 3 2" preserveAspectRatio="none" className={cls}>
          <rect width="1" height="2" fill="#009246" /><rect x="1" width="1" height="2" fill="#fff" /><rect x="2" width="1" height="2" fill="#CE2B37" />
        </svg>
      );
    case "fr":
      return (
        <svg viewBox="0 0 3 2" preserveAspectRatio="none" className={cls}>
          <rect width="1" height="2" fill="#0055A4" /><rect x="1" width="1" height="2" fill="#fff" /><rect x="2" width="1" height="2" fill="#EF4135" />
        </svg>
      );
    case "de":
      return (
        <svg viewBox="0 0 3 3" preserveAspectRatio="none" className={cls}>
          <rect width="3" height="1" fill="#000" /><rect y="1" width="3" height="1" fill="#DD0000" /><rect y="2" width="3" height="1" fill="#FFCE00" />
        </svg>
      );
    case "es":
      return (
        <svg viewBox="0 0 3 2" preserveAspectRatio="none" className={cls}>
          <rect width="3" height="2" fill="#AA151B" /><rect y="0.5" width="3" height="1" fill="#F1BF00" />
        </svg>
      );
    case "en":
    case "gb":
      return (
        <svg viewBox="0 0 60 30" preserveAspectRatio="none" className={cls}>
          <clipPath id="uk-s"><path d="M0,0 v30 h60 v-30 z" /></clipPath>
          <clipPath id="uk-t"><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" /></clipPath>
          <g clipPath="url(#uk-s)">
            <path d="M0,0 v30 h60 v-30 z" fill="#012169" />
            <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
            <path d="M0,0 L60,30 M60,0 L0,30" clipPath="url(#uk-t)" stroke="#C8102E" strokeWidth="4" />
            <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
            <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
          </g>
        </svg>
      );
    default:
      return <span className={cls} />;
  }
}
