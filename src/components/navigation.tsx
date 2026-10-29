"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";

export function Navigation() {
  const pathname = usePathname();
  return <nav aria-label="Libraries" className="navigation">{[
    { href: "/upload", label: "Upload", icon: "upload" as const },
    { href: "/patients", label: "Patients", icon: "patients" as const },
    { href: "/other-uploads", label: "Other uploads", icon: "media" as const },
    { href: "/admin", label: "Settings", icon: "lock" as const },
  ].map(item => <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined}>
    <Icon name={item.icon}/><span>{item.label}</span>
  </Link>)}</nav>;
}
