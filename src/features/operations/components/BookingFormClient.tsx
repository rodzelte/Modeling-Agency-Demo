"use client";

import dynamic from "next/dynamic";

// Dates are shown in the viewer's time zone, which the server does not know, so
// the form renders in the browser only (no server/client mismatch).
export const BookingForm = dynamic(() => import("./BookingForm").then((module) => module.BookingForm), {
  ssr: false,
  loading: () => <div className="h-96 animate-pulse rounded-xl border border-[#e7e7e3] bg-white" aria-busy="true" aria-label="Loading booking form" />,
});
