# Custom address flow — handoff to Devs A / B / D

Dev C ships a Google Places autocomplete on the landing page. When the user
picks an address and clicks **"Design my system"**, the app navigates to
`/design/custom?address=…&lat=…&lng=…&placeId=…`.

This doc tells the other devs exactly what's already wired and what they
need to do.

---

## What Dev C did (already in `main`)

- `src/lib/store.ts`
  - `selectedHouse` type widened from `HouseId | null` to `HouseId | 'custom' | null`
  - New field `customAddress: CustomAddress | null` + setter `setCustomAddress`
  - `CustomAddress` type exported:
    ```ts
    {
      formatted: string;     // "12 Lindenstraße, 14467 Brandenburg, Germany"
      lat: number;
      lng: number;
      placeId?: string;
      countryCode?: string;  // ISO 3166-1 alpha-2 (e.g. "DE")
    }
    ```
- `src/components/AutoFillForm/AddressSearch.tsx`
  - Loads `https://maps.googleapis.com/maps/api/js?key={NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=places`
  - On place selection, calls `setCustomAddress(addr)` + `selectHouse('custom')` + routes to `/design/custom?…`
  - Falls back gracefully if `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is missing (shows banner, demo chips still work).
- `src/components/AutoFillForm/ProfileForm.tsx`
  - When `selectedHouse === 'custom'`, shows a 3-step waiting state ("Address geocoded → Fetching geometry → Inferring profile").
  - When `useStore.getState().profile` becomes non-null AND phase is still `autofilling`, ProfileForm advances to `ready-to-design` automatically and reveals the **Generate design** button.

---

## What Dev B (backend) needs to do

### 1. Set the API key

Add to `.env.local`:

```
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=AIza...
```

Required Google Cloud APIs (enable on the same project as the key):
- **Places API (New)** — for autocomplete
- **Geocoding API** — for sanity checks if needed
- **Solar API** *(recommended)* — for live roof analysis

### 2. Adapt `/api/design` to accept a custom address payload

Current signature (per `src/app/api/design/route.ts`): keyed on `houseId`.
Add a branch:

```ts
type DesignRequest =
  | { houseId: HouseId; profile?: undefined; address?: undefined }
  | {
      houseId: 'custom';
      address: { formatted: string; lat: number; lng: number; placeId?: string; countryCode?: string };
      // profile is OPTIONAL — if omitted, infer it from k-NN cluster
    };
```

When `houseId === 'custom'`:
1. Hit Google Solar API (or fallback geometry pipeline) using `lat/lng` — return roof geometry.
2. Run k-NN over 1 620 deliveries using inferred / heuristic profile from address → return `CustomerProfile`.
3. Run sizing engine + Pioneer classifier as usual.
4. Return the same `DesignResult` shape.

### 3. Push the inferred profile into the store from the cockpit

The cleanest place is `src/app/design/[houseId]/page.tsx` (shared file).
On mount with `houseId === 'custom'`, read `?address=&lat=&lng=` from
`searchParams` and call `/api/design` early — then `setProfile(profile)`
in the store. ProfileForm will auto-advance.

Pseudo-code (drop at top of `DesignPage` after `selectHouse`):

```ts
useEffect(() => {
  if (houseId !== 'custom') return;
  const search = new URLSearchParams(window.location.search);
  fetch('/api/design', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      houseId: 'custom',
      address: {
        formatted: search.get('address') ?? '',
        lat: parseFloat(search.get('lat') ?? '0'),
        lng: parseFloat(search.get('lng') ?? '0'),
        placeId: search.get('placeId') ?? undefined,
      },
    }),
  })
    .then((r) => r.json())
    .then((res: { profile: CustomerProfile; design: DesignResult }) => {
      useStore.getState().setProfile(res.profile);
      // design is set later when phase transitions to agent-running
      useStore.setState({ design: res.design });
    });
}, [houseId]);
```

---

## What Dev A (Scene3D) needs to do

`Scene3D` currently takes `houseId: HouseId` and loads
`/baked/{houseId}-stylized.glb` (per the offline pipeline).

For `houseId === 'custom'`, options in order of effort:
1. **Easy**: load a generic placeholder GLB (`/models/generic-house.glb`) and skin it from `useStore.getState().customAddress`.
2. **Medium**: Google Solar API returns a building footprint → extrude a simple low-poly box from it.
3. **Full**: live photogrammetry pipeline (Dev D's territory).

For the hackathon demo with a custom address, **option 1** is enough — the
agent trace + KPIs + evidence panel carry the credibility weight. The 3D
model just needs to *exist* and look reasonable.

`Scene3D.tsx` signature stays the same (just handle the new value):

```ts
if (houseId === 'custom') {
  return <PlaceholderHouse address={useStore.getState().customAddress} />;
}
```

---

## What Dev D (geometry) needs to do

If you want full live photogrammetry for custom addresses:
1. Add a `bake-from-address.ts` script that takes lat/lng and runs the
   existing pipeline (`fetch-3d-tiles → analyze-roof → generate-stylized`).
2. Expose it as `/api/geometry/bake?lat=…&lng=…` (Dev B route).
3. Cache results by `placeId` in Supabase / disk to avoid re-baking.

For the hackathon, **defer this to post-submission** — Dev A's option 1
placeholder is fine.

---

## Testing the flow today (without backend)

1. Set `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` in `.env.local`
2. Restart `pnpm dev`
3. Visit `/`
4. Type an address → pick from autocomplete → click "Design my system"
5. You'll land on `/design/custom?…`
6. The cockpit will mount, ProfileForm will show the 3-step waiting state, and stay there until backend wires up `setProfile`.
7. Demo houses (Brandenburg / Hamburg / Ruhr) still work end-to-end as before — no regression.
