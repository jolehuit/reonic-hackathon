// Compass widget displayed top-right above the viewer.
// `heading` is camera azimuth in degrees (0 = North).

interface CompassProps {
  heading: number;
}

export function Compass({ heading }: CompassProps) {
  return (
    <div
      className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full border border-gray-200 bg-white/95 shadow-sm backdrop-blur"
      aria-label={`Compass, heading ${Math.round(heading)} degrees`}
    >
      <div
        className="relative h-9 w-9"
        style={{ transform: `rotate(${-heading}deg)` }}
      >
        <span className="absolute left-1/2 top-0 -translate-x-1/2 text-[9px] font-bold text-[#0066ff]">
          N
        </span>
        <span className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[9px] font-medium text-gray-500">
          S
        </span>
        <svg viewBox="0 0 36 36" className="absolute inset-0 h-full w-full">
          <polygon
            points="18,7 15,18 21,18"
            fill="#0066ff"
          />
          <polygon
            points="18,29 15,18 21,18"
            fill="#cbd5e1"
          />
        </svg>
      </div>
    </div>
  );
}
