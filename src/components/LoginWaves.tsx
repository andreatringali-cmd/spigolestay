// Sfondo del login: onde morbide azzurro / pervinca / lavanda su bianco, centro libero per la leggibilità.
// Vettoriale e senza immagini: riempie qualsiasi schermo (preserveAspectRatio="none": le curve sono morbide e si adattano).
export default function LoginWaves() {
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1672 941" preserveAspectRatio="none">
      <defs>
        <linearGradient id="lwTL" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#CDE4FF" /><stop offset="1" stopColor="#EAF3FF" stopOpacity="0" /></linearGradient>
        <linearGradient id="lwBL" x1="0" y1="0.1" x2="1" y2="1"><stop offset="0" stopColor="#C6B4FB" /><stop offset="0.55" stopColor="#E3DDFC" /><stop offset="1" stopColor="#F1EFFD" stopOpacity="0.4" /></linearGradient>
        <linearGradient id="lwR" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8FA8FA" /><stop offset="0.6" stopColor="#C4D9FD" /><stop offset="1" stopColor="#E3EEFF" stopOpacity="0.2" /></linearGradient>
        <filter id="lwS1" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="22" /></filter>
        <filter id="lwS2" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="62" /></filter>
      </defs>
      <rect width="1672" height="941" fill="#FCFDFF" />
      {/* aloni sfumati */}
      <ellipse cx="200" cy="60" rx="300" ry="170" fill="#C9E2FE" opacity=".7" filter="url(#lwS2)" />
      <ellipse cx="210" cy="720" rx="290" ry="190" fill="#BFAEFA" opacity=".55" filter="url(#lwS2)" />
      <ellipse cx="1500" cy="570" rx="260" ry="160" fill="#9DC2FB" opacity=".8" filter="url(#lwS2)" />
      <ellipse cx="340" cy="560" rx="230" ry="80" fill="#C8D4FB" opacity=".4" filter="url(#lwS2)" />
      {/* onda in alto a sinistra */}
      <path d="M0 0 H165 C330 105 450 255 585 362 C380 345 170 285 0 175 Z" fill="url(#lwTL)" opacity=".85" />
      {/* fascia a sinistra, a metà altezza */}
      <path d="M0 383 C190 470 330 505 450 507 C330 560 150 575 0 565 Z" fill="#D6E2FD" opacity=".7" filter="url(#lwS1)" />
      {/* onde lavanda in basso a sinistra */}
      <path d="M0 565 C260 585 470 705 650 812 C770 870 880 895 1010 941 H0 Z" fill="url(#lwBL)" opacity=".85" />
      <path d="M0 592 C230 612 410 722 590 832 L650 941 H0 Z" fill="#C7B6FB" opacity=".4" filter="url(#lwS1)" />
      {/* onda blu a destra */}
      <path d="M1672 372 C1500 520 1320 700 1190 941 H1672 Z" fill="url(#lwR)" opacity="1" />
      <path d="M1672 490 C1450 590 1150 690 840 745 C1200 762 1500 705 1672 600 Z" fill="#C5DAFD" opacity=".55" filter="url(#lwS1)" />
      {/* arco lavanda tenue in alto a destra */}
      <path d="M1672 195 C1500 215 1340 330 1250 500 C1400 420 1560 380 1672 370 Z" fill="#E2DAFB" opacity=".55" filter="url(#lwS1)" />
    </svg>
  );
}
