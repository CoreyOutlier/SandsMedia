import Image from "next/image";

export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={compact ? "brand compact" : "brand"}>
    <Image src="/brand/logo.svg" alt="Kevin B. Sands, DDS" width={470} height={131} priority />
    <span>Cosmetic Dentistry, Beverly Hills</span>
  </div>;
}
