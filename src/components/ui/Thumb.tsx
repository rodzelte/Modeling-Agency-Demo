import { ImageIcon } from "lucide-react";

// Dashboard thumbnails use short-lived signed URLs for private media; they are
// rendered with a plain <img> so they never pass through (and get cached by) the
// shared image optimizer.
export function Thumb({ src, alt, className = "h-12 w-10" }: { src: string | null; alt: string; className?: string }) {
  if (!src) return <span className={`flex items-center justify-center rounded bg-[#efefeb] text-[#717369] ${className}`} aria-hidden><ImageIcon size={14} /></span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" className={`rounded object-cover ${className}`} />;
}
