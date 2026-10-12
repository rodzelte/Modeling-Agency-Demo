import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";

const variants: Record<Variant, string> = {
  primary: "bg-[#20211f] text-white hover:bg-[#a4502f] border border-[#20211f] hover:border-[#a4502f]",
  secondary: "bg-white text-[#20211f] border border-[#e7e7e3] hover:border-[#20211f]",
  ghost: "text-[#5f615b] border border-transparent hover:bg-[#efefeb]",
  danger: "bg-white text-[#a9593d] border border-[#e6c3b4] hover:bg-[#f8e8df]",
  success: "bg-white text-[#4f7a54] border border-[#b7cdb9] hover:bg-[#e4eee5]",
};

export function buttonClass(variant: Variant = "primary", size: "sm" | "md" = "md") {
  const sizing = size === "sm" ? "px-3 py-2 text-[10px]" : "px-4 py-3 text-[10px]";
  return `inline-flex items-center justify-center gap-2 rounded-md font-800 uppercase tracking-[.12em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a4502f] disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${variants[variant]}`;
}

type ButtonProps = ComponentProps<"button"> & { variant?: Variant; size?: "sm" | "md"; icon?: ReactNode };

export function Button({ variant = "primary", size = "md", icon, className = "", children, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={`${buttonClass(variant, size)} ${className}`} {...props}>{icon}{children}</button>;
}

export function ButtonLink({ href, variant = "primary", size = "md", icon, children, className = "", target }: { href: string; variant?: Variant; size?: "sm" | "md"; icon?: ReactNode; children: ReactNode; className?: string; target?: string }) {
  return <Link href={href} target={target} className={`${buttonClass(variant, size)} ${className}`}>{icon}{children}</Link>;
}
