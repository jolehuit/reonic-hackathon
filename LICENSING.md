# Licensing notes

Aikido's license-management scan flagged four dependencies as
non-compliant. Each one is reviewed below — none requires a code
change for this SaaS-only product.

## Accepted licenses

### `@img/sharp-libvips-darwin-arm64` — LGPL-3.0-or-later

Transitive dependency of `sharp`, which Next.js uses for built-in
Image optimisation:

```
next 16.2.4
└─ sharp 0.34.5
   └─ @img/sharp-darwin-arm64 0.34.5
      └─ @img/sharp-libvips-darwin-arm64 1.2.4
```

LGPL's copyleft clause is triggered on **distribution** of derivative
work. Because we run as a hosted service on Cloud Run and never ship
the binary, the obligation reduces to keeping the libvips source
available (the upstream tarball already does this). No proprietary
linking concern.

### `axe-core` — MPL-2.0

`devDependencies`. Pulled in by Playwright for accessibility assertions
in tests. Never bundled into the production runtime. MPL-2.0's reach
stops at modified files; we don't modify axe-core.

### `lightningcss` — MPL-2.0

`devDependencies`. Tailwind v4's bundler. Build-time only. Same
analysis as axe-core.

### `dompurify` — MPL-2.0 OR Apache-2.0

Dual-licensed. We use it under the Apache-2.0 branch (no source-
disclosure obligation). Pulled in by `jspdf` for HTML sanitisation in
the PDF export path.

## Aikido configuration

To clear these from the dashboard, add MPL-2.0 + LGPL-3.0-or-later
to the project's accepted-licenses list in Aikido (or mark the four
findings above as "ignored — license review accepted").
