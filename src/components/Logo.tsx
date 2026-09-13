import Image from "next/image";

export default function Logo({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    <Image
      src="/xenora-mark.png"
      alt="Xenora"
      width={size}
      height={size}
      priority
      className={`object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
