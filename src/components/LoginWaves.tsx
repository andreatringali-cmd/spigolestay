// Sfondo del login: onde morbide azzurro / pervinca / lavanda su bianco, centro libero per la leggibilità.
// Vettoriale e senza immagini. Due composizioni: orizzontale (schermi larghi) e verticale (telefoni), così le onde
// restano sui bordi e non vengono stirate né tagliate.
const GRADS = (id: string) => (
  <>
    <linearGradient id={`${id}TL`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#CDE4FF" /><stop offset="1" stopColor="#EAF3FF" stopOpacity="0" /></linearGradient>
    <linearGradient id={`${id}BL`} x1="0" y1="0.1" x2="1" y2="1"><stop offset="0" stopColor="#C6B4FB" /><stop offset="0.55" stopColor="#E3DDFC" /><stop offset="1" stopColor="#F1EFFD" stopOpacity="0.4" /></linearGradient>
    <linearGradient id={`${id}R`} x1="1" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8FA8FA" /><stop offset="0.6" stopColor="#C4D9FD" /><stop offset="1" stopColor="#E3EEFF" stopOpacity="0.2" /></linearGradient>
    <filter id={`${id}S1`} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="22" /></filter>
    <filter id={`${id}S2`} x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="62" /></filter>
  </>
);

export default function LoginWaves() {
  return (
    <>
      {/* Telefono (verticale) */}
      <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full sm:hidden" viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice">
        <defs>
          {GRADS("lp")}
          <filter id="lpB1" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="12" /></filter>
          <filter id="lpB2" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="38" /></filter>
        </defs>
        <rect width="390" height="844" fill="#FCFDFF" />
        <ellipse cx="40" cy="30" rx="230" ry="170" fill="#C9E2FE" opacity=".7" filter="url(#lpB2)" />
        <ellipse cx="30" cy="770" rx="210" ry="160" fill="#BFAEFA" opacity=".55" filter="url(#lpB2)" />
        <ellipse cx="385" cy="540" rx="170" ry="140" fill="#9DC2FB" opacity=".7" filter="url(#lpB2)" />
        <path d="M0 0 H150 C230 70 272 170 305 255 C185 235 70 192 0 140 Z" fill="url(#lpTL)" opacity=".85" />
        <path d="M0 262 C60 305 118 322 170 324 C112 360 50 372 0 362 Z" fill="#D6E2FD" opacity=".7" filter="url(#lpB1)" />
        <path d="M390 118 C340 134 292 190 264 262 C312 216 352 200 390 196 Z" fill="#E2DAFB" opacity=".55" filter="url(#lpB1)" />
        <path d="M0 610 C92 628 172 696 252 774 C282 804 312 824 342 844 H0 Z" fill="url(#lpBL)" opacity=".9" />
        <path d="M0 648 C82 666 152 734 222 802 L254 844 H0 Z" fill="#C7B6FB" opacity=".4" filter="url(#lpB1)" />
        <path d="M390 318 C322 410 262 528 218 668 C300 650 352 628 390 606 Z" fill="url(#lpR)" opacity="1" />
        <path d="M390 430 C320 490 240 540 150 580 C250 586 330 560 390 520 Z" fill="#C5DAFD" opacity=".55" filter="url(#lpB1)" />
      </svg>

      {/* Schermi larghi (orizzontale) */}
      <svg aria-hidden className="pointer-events-none absolute inset-0 hidden h-full w-full sm:block" viewBox="0 0 1672 941" preserveAspectRatio="xMidYMid slice">
        <defs>{GRADS("lw")}</defs>
        <rect width="1672" height="941" fill="#FCFDFF" />
        <ellipse cx="200" cy="60" rx="300" ry="170" fill="#C9E2FE" opacity=".7" filter="url(#lwS2)" />
        <ellipse cx="210" cy="720" rx="290" ry="190" fill="#BFAEFA" opacity=".55" filter="url(#lwS2)" />
        <ellipse cx="1500" cy="570" rx="260" ry="160" fill="#9DC2FB" opacity=".8" filter="url(#lwS2)" />
        <ellipse cx="340" cy="560" rx="230" ry="80" fill="#C8D4FB" opacity=".4" filter="url(#lwS2)" />
        <path d="M0 0 H165 C330 105 450 255 585 362 C380 345 170 285 0 175 Z" fill="url(#lwTL)" opacity=".85" />
        <path d="M0 383 C190 470 330 505 450 507 C330 560 150 575 0 565 Z" fill="#D6E2FD" opacity=".7" filter="url(#lwS1)" />
        <path d="M0 565 C260 585 470 705 650 812 C770 870 880 895 1010 941 H0 Z" fill="url(#lwBL)" opacity=".85" />
        <path d="M0 592 C230 612 410 722 590 832 L650 941 H0 Z" fill="#C7B6FB" opacity=".4" filter="url(#lwS1)" />
        <path d="M1672 372 C1500 520 1320 700 1190 941 H1672 Z" fill="url(#lwR)" opacity="1" />
        <path d="M1672 490 C1450 590 1150 690 840 745 C1200 762 1500 705 1672 600 Z" fill="#C5DAFD" opacity=".55" filter="url(#lwS1)" />
        <path d="M1672 195 C1500 215 1340 330 1250 500 C1400 420 1560 380 1672 370 Z" fill="#E2DAFB" opacity=".55" filter="url(#lwS1)" />
      </svg>
    </>
  );
}
