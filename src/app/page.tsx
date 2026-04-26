'use client';

import { useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import type { HouseId } from '@/lib/types';
import { AddressSearch } from '@/components/AutoFillForm/AddressSearch';

const HOUSES: {
  id: HouseId;
  label: string;
  size: string;
  heating: string;
  highlight: string;
  highlightTone: 'blue' | 'emerald';
}[] = [
  {
    id: 'brandenburg',
    label: 'Thielallee 36, Berlin',
    size: '140 m²',
    heating: 'Gas heating · 3 inhabitants',
    highlight: 'Medium roof',
    highlightTone: 'blue',
  },
  {
    id: 'hamburg',
    label: 'Test addr 2, Potsdam-Golm',
    size: '165 m²',
    heating: 'Oil heating · 4 inhabitants',
    highlight: 'Heat-pump candidate',
    highlightTone: 'emerald',
  },
  {
    id: 'ruhr',
    label: 'Schönerlinder Weg 83, Berlin Karow',
    size: '190 m²',
    heating: 'Oil heating · 5 inhabitants',
    highlight: 'Large roof',
    highlightTone: 'emerald',
  },
];

const FEATURES = [
  'Photovoltaic system, energy storage and electric car',
  'Profitability analysis on 1 620 real Iconic deliveries',
  'CO₂ savings + 1-page PDF quick-offer',
];

export default function Home() {
  const [addressOpen, setAddressOpen] = useState(false);
  return (
    <main className="min-h-screen bg-white text-zinc-900 antialiased">
      <div className="mx-auto flex max-w-[1240px] flex-col px-10 pb-16 pt-8">
        {/* Header — logo top-left, like Reonic. Big enough that the wordmark
            reads from the back row. No "AI Designer" sublabel: the hero
            headline below carries the positioning. */}
        <header className="mb-12 flex items-center justify-between">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/iconic-logo.png" alt="Iconic" className="h-14 w-auto" />
          <button
            type="button"
            onClick={() => setAddressOpen(true)}
            className="rounded-full bg-zinc-900 px-5 py-2.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-zinc-800"
          >
            Try it now
          </button>
        </header>

        {/* Hero — copy left + visual right (Reonic-style split). */}
        <section className="mb-16 grid grid-cols-1 items-center gap-10 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <h1 className="mb-5 text-[56px] font-bold leading-[1.04] tracking-[-0.025em] text-zinc-900">
              From an address to a complete solar design in 30&nbsp;seconds.
            </h1>
            <p className="mb-7 text-[17px] leading-relaxed text-zinc-500">
              Type any address. Iconic captures the building from Google Photorealistic 3D Tiles,
              isolates it with GPT Image&nbsp;2, reconstructs a textured mesh with Hunyuan&nbsp;3D&nbsp;Pro,
              then sizes the PV&nbsp;/ storage&nbsp;/ heat-pump bundle against 1,620 real Iconic deliveries
              and exports a quick-offer PDF.
            </p>
            <ul className="mb-8 space-y-2.5">
              {FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-3 text-[14.5px] leading-snug text-zinc-700">
                  <span className="mt-0.5 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full bg-blue-500 text-white">
                    <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                  {f}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setAddressOpen(true)}
              className="group inline-flex items-center gap-2 rounded-full bg-emerald-600 px-6 py-3 text-[14.5px] font-semibold text-white shadow-sm transition hover:bg-emerald-700"
            >
              Type your address
              <svg className="h-4 w-4 transition group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </div>

          <div className="rounded-3xl border border-zinc-200/70 bg-zinc-50/60 p-10">
            <div className="flex h-full items-center justify-center">
              <HouseIllustration />
            </div>
          </div>
        </section>

        {/* House chips — Reonic-style "Live demo" section: dotted eyebrow,
            big bold heading, supporting paragraph wider than the chips. */}
        <section id="houses" className="mb-12 scroll-mt-10">
          <div className="mb-7">
            <div className="mb-3 inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-emerald-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Live demo
            </div>
            <h3 className="mb-2 text-[34px] font-bold leading-[1.1] tracking-[-0.02em] text-zinc-900">
              Try Iconic on a real building.
            </h3>
            <p className="max-w-[640px] text-[15px] leading-relaxed text-zinc-500">
              Three pre-validated houses from the 1,620-project Iconic dataset.
              Auto-fills the customer profile, runs the AI agent, and exports a
              quick-offer PDF — end to end in about 30 seconds.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {HOUSES.map((h, i) => (
              <motion.div
                key={h.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.08, duration: 0.3 }}
              >
                <Link
                  href={`/design/${h.id}`}
                  className="group relative flex h-full flex-col rounded-2xl border border-zinc-200/70 bg-white p-6 transition hover:border-blue-300 hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.08)]"
                >
                  <div className="mb-5 flex items-start justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50">
                      <svg className="h-5 w-5 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 10.5L12 3l9 7.5" />
                        <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
                      </svg>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                        h.highlightTone === 'blue'
                          ? 'bg-blue-50 text-blue-700'
                          : 'bg-emerald-50 text-emerald-700'
                      }`}
                    >
                      {h.highlight}
                    </span>
                  </div>
                  <div className="mb-1.5 flex items-baseline gap-2">
                    <span className="text-[20px] font-bold text-zinc-900">{h.label}</span>
                    <span className="text-[13px] text-zinc-400">{h.size}</span>
                  </div>
                  <div className="mb-6 text-[13px] text-zinc-500">{h.heating}</div>
                  <div className="mt-auto flex items-center justify-between border-t border-zinc-100 pt-4">
                    <span className="text-[12px] font-medium text-zinc-400">Demo · validated</span>
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold text-emerald-600 transition group-hover:gap-2.5">
                      Start now
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="5" y1="12" x2="19" y2="12" />
                        <polyline points="12 5 19 12 12 19" />
                      </svg>
                    </span>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-auto flex items-center justify-between border-t border-zinc-100 pt-6 text-[12px] text-zinc-400">
          <div className="flex items-center gap-5">
            <span className="cursor-pointer hover:text-zinc-600">Imprint</span>
            <span className="cursor-pointer hover:text-zinc-600">Data protection</span>
          </div>
          <div className="font-medium text-zinc-500">
            Built on <span className="text-blue-600">1 620</span> real Iconic deliveries
          </div>
        </footer>
      </div>

      <AnimatePresence>
        {addressOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setAddressOpen(false)}
            className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-zinc-900/50 p-4 backdrop-blur-sm sm:p-8"
          >
            <motion.div
              initial={{ y: 30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 30, opacity: 0 }}
              transition={{ duration: 0.25 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-2xl"
            >
              <button
                type="button"
                onClick={() => setAddressOpen(false)}
                aria-label="Close"
                className="absolute -top-2 right-0 flex h-9 w-9 items-center justify-center rounded-full bg-white text-zinc-500 shadow-md transition hover:text-zinc-900"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
              <AddressSearch />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

function HouseIllustration() {
  // Reonic-faithful: 2 connected houses, gray walls/floors, blue panels,
  // green pills with blue label text, tree, heat pump with orange fan,
  // EV charger pole + dark sedan, basement battery (green box, yellow cells).
  return (
    <svg
      viewBox="0 0 640 480"
      className="w-full max-w-[540px]"
      fontFamily="system-ui"
    >
      {/* Ground line */}
      <line x1="20" y1="378" x2="620" y2="378" stroke="#D1D5DB" strokeWidth="1.5" />

      {/* === Tree (far left, balloon-shape silhouette) === */}
      <g fill="#D1D5DB">
        <ellipse cx="86" cy="280" rx="22" ry="34" />
        <rect x="83" y="310" width="6" height="68" />
      </g>

      {/* === LEFT HOUSE (taller, 3 levels, with chimney) === */}
      <g
        fill="none"
        stroke="#B8BCC4"
        strokeWidth="6"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {/* Outer silhouette */}
        <path d="M170 378 L170 222 L260 138 L350 222 L350 378 Z" />
        {/* Floor dividers (interior) */}
        <line x1="170" y1="282" x2="350" y2="282" />
        <line x1="170" y1="338" x2="350" y2="338" />
        {/* Chimney */}
        <rect x="298" y="148" width="20" height="42" />
      </g>

      {/* Roof slopes (left house) — solid gray fill on top edges */}
      <path d="M170 222 L260 138 L350 222 L344 222 L260 146 L176 222 Z" fill="#B8BCC4" />

      {/* Solar panels on left house roof (right slope) */}
      <g fill="#2563EB">
        <polygon points="276,150 340,210 332,218 268,158" />
      </g>

      {/* === RIGHT HOUSE (shorter, with awning roof on left side) === */}
      <g
        fill="none"
        stroke="#B8BCC4"
        strokeWidth="6"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {/* Outer silhouette */}
        <path d="M350 378 L350 268 L420 198 L490 268 L490 378 Z" />
        {/* Floor divider */}
        <line x1="350" y1="324" x2="490" y2="324" />
      </g>
      {/* Roof solid */}
      <path d="M350 268 L420 198 L490 268 L484 268 L420 206 L356 268 Z" fill="#B8BCC4" />

      {/* Awning extension between left and right houses */}
      <g
        fill="none"
        stroke="#B8BCC4"
        strokeWidth="5"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <path d="M350 268 L260 268 L260 282" />
      </g>

      {/* Solar panels on right house roof */}
      <g fill="#2563EB">
        <polygon points="430,210 486,258 478,266 422,218" />
      </g>

      {/* === Interior items (light gray) === */}
      <g fill="#D8DCE2" stroke="none">
        {/* Left house — top floor: bed */}
        <rect x="195" y="252" width="50" height="14" rx="2" />
        <rect x="190" y="248" width="10" height="18" rx="2" />
        {/* Left house — top floor: radiator (vertical bars) */}
        <rect x="265" y="248" width="22" height="22" rx="1" />
      </g>
      <g stroke="#B8BCC4" strokeWidth="1.5" strokeLinecap="round">
        <line x1="269" y1="251" x2="269" y2="267" />
        <line x1="273" y1="251" x2="273" y2="267" />
        <line x1="277" y1="251" x2="277" y2="267" />
        <line x1="281" y1="251" x2="281" y2="267" />
      </g>

      {/* Light pendants (line + circle) — left house */}
      <g stroke="#D8DCE2" strokeWidth="1.5" fill="#D8DCE2">
        <line x1="220" y1="282" x2="220" y2="298" />
        <circle cx="220" cy="302" r="4" />
        <line x1="300" y1="282" x2="300" y2="298" />
        <circle cx="300" cy="302" r="4" />
        <line x1="220" y1="338" x2="220" y2="354" />
        <circle cx="220" cy="358" r="4" />
        <line x1="300" y1="338" x2="300" y2="354" />
        <circle cx="300" cy="358" r="4" />
      </g>

      {/* Left house — middle floor: sofa */}
      <g fill="#D8DCE2">
        <rect x="195" y="356" width="60" height="20" rx="3" />
        <rect x="190" y="352" width="10" height="24" rx="2" />
        <rect x="248" y="352" width="10" height="24" rx="2" />
      </g>
      {/* Left house — middle floor: door (with two window panes) */}
      <g fill="none" stroke="#B8BCC4" strokeWidth="3" strokeLinejoin="round">
        <rect x="285" y="340" width="38" height="38" />
        <line x1="285" y1="358" x2="323" y2="358" />
        <line x1="304" y1="340" x2="304" y2="378" />
      </g>

      {/* Right house — top floor: shower */}
      <g fill="none" stroke="#B8BCC4" strokeWidth="2" strokeLinecap="round">
        <path d="M400 282 L400 305" />
        <path d="M390 282 Q395 285 400 282" />
        <line x1="395" y1="288" x2="392" y2="294" />
        <line x1="400" y1="290" x2="400" y2="296" />
        <line x1="405" y1="288" x2="408" y2="294" />
      </g>
      {/* Right house — top floor: table */}
      <g fill="#D8DCE2">
        <rect x="430" y="298" width="40" height="6" rx="1" />
        <rect x="432" y="304" width="3" height="18" />
        <rect x="465" y="304" width="3" height="18" />
      </g>

      {/* Light pendants — right house */}
      <g stroke="#D8DCE2" strokeWidth="1.5" fill="#D8DCE2">
        <line x1="420" y1="268" x2="420" y2="284" />
        <circle cx="420" cy="288" r="4" />
        <line x1="420" y1="324" x2="420" y2="340" />
        <circle cx="420" cy="344" r="4" />
      </g>

      {/* Right house — bottom floor: sofa */}
      <g fill="#D8DCE2">
        <rect x="438" y="356" width="44" height="18" rx="3" />
        <rect x="433" y="352" width="9" height="22" rx="2" />
        <rect x="478" y="352" width="9" height="22" rx="2" />
      </g>

      {/* === Power storage (basement under right house, going below ground line) === */}
      <g>
        <rect x="378" y="378" width="56" height="64" rx="6" fill="#86EFAC" stroke="#22C55E" strokeWidth="2" />
        {/* Yellow battery cells */}
        <rect x="392" y="392" width="14" height="22" rx="1.5" fill="#FBBF24" />
        <rect x="408" y="392" width="14" height="22" rx="1.5" fill="#FBBF24" />
        {/* Plug socket / circle on side */}
        <circle cx="386" cy="426" r="3" fill="#16A34A" opacity="0.7" />
      </g>

      {/* === HEAT PUMP (left of left house) === */}
      <g>
        {/* Black box */}
        <rect x="118" y="318" width="58" height="58" rx="3" fill="#1F2937" />
        {/* Fan circle */}
        <circle cx="147" cy="347" r="20" fill="#1F2937" stroke="#374151" strokeWidth="1.5" />
        {/* Fan blades — orange/red */}
        <g transform="translate(147, 347)">
          <path d="M0 -16 Q5 -10 0 0 Q-5 -10 0 -16Z" fill="#EF4444" />
          <path d="M14 8 Q6 8 0 0 Q6 -2 14 8Z" fill="#EF4444" />
          <path d="M-14 8 Q0 0 -6 -2 Q-6 8 -14 8Z" fill="#EF4444" />
          <circle cx="0" cy="0" r="3" fill="#FCA5A5" />
        </g>
        {/* Stand legs */}
        <line x1="125" y1="376" x2="120" y2="384" stroke="#1F2937" strokeWidth="3" />
        <line x1="170" y1="376" x2="174" y2="384" stroke="#1F2937" strokeWidth="3" />
        {/* Red pipes connecting to house */}
        <path d="M176 332 Q190 332 190 348" stroke="#EF4444" strokeWidth="2.5" fill="none" />
        <path d="M176 360 Q190 360 190 348" stroke="#EF4444" strokeWidth="2.5" fill="none" />
      </g>

      {/* === EV CHARGER (right of right house) === */}
      <g>
        {/* Pole */}
        <rect x="500" y="298" width="20" height="62" rx="4" fill="#3B82F6" />
        {/* Lightning bolt */}
        <path d="M512 308 L506 320 L510 320 L508 332 L516 318 L512 318 Z" fill="#FBBF24" />
        {/* Display dots */}
        <circle cx="510" cy="340" r="1.5" fill="white" opacity="0.7" />
        <circle cx="514" cy="340" r="1.5" fill="white" opacity="0.7" />
        {/* Cable to car */}
        <path
          d="M520 332 Q540 348 552 366"
          stroke="#3B82F6"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
      </g>

      {/* === ELECTRIC CAR === */}
      <g>
        {/* Car body — sleek sedan profile */}
        <path
          d="M540 374 L552 348 L582 340 L606 348 L618 374 L618 390 L540 390 Z"
          fill="#1E40AF"
        />
        {/* Windows */}
        <path
          d="M558 350 L580 344 L600 350 L606 366 L552 366 Z"
          fill="#60A5FA"
          opacity="0.85"
        />
        {/* Door line */}
        <line x1="580" y1="366" x2="580" y2="386" stroke="#1E3A8A" strokeWidth="1.5" />
        {/* Wheel arches */}
        <ellipse cx="558" cy="390" rx="11" ry="3" fill="#0F172A" />
        <ellipse cx="600" cy="390" rx="11" ry="3" fill="#0F172A" />
        {/* Wheels */}
        <circle cx="558" cy="392" r="9" fill="#0F172A" />
        <circle cx="600" cy="392" r="9" fill="#0F172A" />
        <circle cx="558" cy="392" r="3" fill="#475569" />
        <circle cx="600" cy="392" r="3" fill="#475569" />
        {/* Plug indicator */}
        <rect x="544" y="362" width="3" height="3" fill="#FBBF24" />
      </g>

      {/* === TAGS (green pill, white check circle, BLUE label) === */}
      {/* Solar system — top center (above left house roof) */}
      <Tag x={240} y={108} label="Solar system" width={132} />
      {/* EV Charger — top right (next to charger pole) */}
      <Tag x={510} y={266} label="EV Charger" width={124} />
      {/* Heat pump — bottom left (below heat pump unit) */}
      <Tag x={104} y={392} label="Heat pump" width={112} />
      {/* Power storage — center, above battery */}
      <Tag x={350} y={418} label="Power storage" width={132} />
      {/* Electric car — bottom right (below car) */}
      <Tag x={530} y={418} label="Electric car" width={120} />
    </svg>
  );
}

function Tag({
  x,
  y,
  label,
  width,
}: {
  x: number;
  y: number;
  label: string;
  width: number;
}) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect width={width} height="30" rx="15" fill="#DCFCE7" />
      <circle cx="18" cy="15" r="9" fill="white" />
      <circle cx="18" cy="15" r="7.5" fill="none" stroke="#22C55E" strokeWidth="1.5" />
      <path
        d="M14 15 L17 18 L22 12.5"
        stroke="#22C55E"
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text
        x="32"
        y="19.5"
        fontSize="12.5"
        fontWeight="700"
        fill="#1D4ED8"
        fontFamily="system-ui"
      >
        {label}
      </text>
    </g>
  );
}
