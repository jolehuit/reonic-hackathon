// Shared types for the Plan Solar chrome UI.
// These shapes drive controlled components in src/app/design/[houseId]/page.tsx
// and are exposed to the future Cesium viewer via <ViewerSlot /> props.

export type ToolId =
  | 'select'
  | 'pan'
  | 'ruler'
  | 'marquee'
  | 'pencil'
  | 'fill'
  | 'rectangle'
  | 'grid'
  | 'tree';

export type SourceId = 'mapbox' | 'google' | 'apple';

export type ViewMode = '2D' | '3D';

export type DesignMode = 'building' | 'modules' | 'strings';

export type MainTabId = '3d-planning' | 'add-components' | 'payment' | 'parts-list';

export interface SourceOption {
  id: SourceId;
  label: string;
}

export const SOURCE_OPTIONS: readonly SourceOption[] = [
  { id: 'mapbox', label: 'Mapbox' },
  { id: 'google', label: 'Google Maps' },
  { id: 'apple', label: 'Apple Maps' },
] as const;
