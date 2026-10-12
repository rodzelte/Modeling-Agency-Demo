import Image from "next/image";
import Link from "next/link";
import { PHOTO_QUALITY, type TalentCardData } from "@/features/public/types";

export function TalentCard({ talent, index = 0 }: { talent: TalentCardData; index?: number }) {
  return (
    <Link href={`/models/${talent.slug}`} className="group block fade-up focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ink)]" style={{ animationDelay: `${Math.min(index, 12) * 60}ms` }}>
      <div className="image-hover relative aspect-[3/4] bg-[#e4e1db]">
        <Image src={talent.image} alt={talent.imageAlt} fill quality={PHOTO_QUALITY} loading={index < 4 ? "eager" : "lazy"} sizes="(max-width: 700px) 50vw, (max-width: 1100px) 33vw, 25vw" className="object-cover grayscale-[15%] transition-[filter] duration-700 group-hover:grayscale-0" />
        {talent.boardLabel && <span className="label-sm absolute left-3 top-3 bg-[var(--paper)]/90 px-2 py-1 !text-[8.5px] text-[var(--ink)]">{talent.boardLabel}</span>}
      </div>
      <div className="flex items-baseline justify-between gap-3 pt-4">
        <div className="min-w-0">
          <h3 className="display truncate text-[19px] uppercase leading-tight tracking-[.04em] sm:text-[21px]">{talent.name}</h3>
          {talent.location && <p className="label-sm mt-1.5 truncate !text-[9px] text-[var(--muted)]">{talent.location}</p>}
        </div>
        {talent.height && <span className="serif shrink-0 text-[15px] italic text-[var(--muted)]">{talent.height}</span>}
      </div>
    </Link>
  );
}
