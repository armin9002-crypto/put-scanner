# Put Scanner visual system

## Visual philosophy

Put Scanner is a dense financial workstation with consumer-fintech discipline. The system is:

- **Dense but calm:** preserve decision-useful data, remove ornamental weight, and keep related information close.
- **Crisp, not decorative:** borders, alignment, and surface contrast do the structural work. Shadow is reserved for overlays.
- **Data first:** financial values dominate labels and chrome; color communicates meaning without becoming the layout.
- **Subtle chrome:** navigation, filters, status, and controls remain obvious without competing with instruments and positions.
- **Precisely aligned:** financial numerals use tabular lining figures, numeric columns align right, and repeated headers share a rhythm.
- **One system in four themes:** Light, Dark, Sepia, and Dark Blue keep identical semantic hierarchy and component behavior.
- **Purpose-built mobile:** touch targets, safe areas, bottom navigation, compact rows, and full-screen workflows are deliberate mobile presentations.

## Semantic tokens

Tokens live in `src/index.css`. New work should use semantic roles rather than raw color values.

| Role | Tokens | Purpose |
| --- | --- | --- |
| Background | `--bg-primary`, `--bg-secondary`, `--bg-elevated`, `--bg-inset` | App canvas, section surface, raised surface, recessed controls/data |
| Text | `--text-primary`, `--text-secondary`, `--text-tertiary` | Primary content, supporting copy, labels/metadata |
| Border | `--border-subtle`, `--border-default`, `--border-emphasis` | Dividers, controls/cards, focus/selected emphasis |
| Interaction | `--accent`, `--accent-hover`, `--accent-contrast`, `--accent-bg`, `--accent-border` | Primary action and selected states |
| Meaning | `--positive`, `--negative`, `--warning`, `--info` | Financial/status semantics |
| Elevation | `--shadow`, `--shadow-overlay` | Flat contained objects and floating overlays |

The legacy aliases (`--bg`, `--surface`, `--surface-alt`, `--border`, `--text`, `--green`, and related names) resolve to semantic tokens. They remain for safe staged migration through UI-2–UI-5; new styles should prefer the semantic layer.

## Spacing and page geometry

Use the working scale `2, 4, 6, 8, 12, 16, 20, 24, 32` pixels. Avoid adjacent one-off values unless required by an existing chart or table calculation.

- `page-frame` owns common responsive gutters and a 1600px data-page maximum.
- `page-frame--standard` uses a 1360px maximum for Scanner-like compositions.
- `page-frame--wide` uses an 1840px maximum for Portfolio, Watchlist, and other wide tables.
- Default section separation is 12–16px. Related control groups use 6–8px.
- Desktop control height is normally 36–40px. Phone controls remain at least 44px.
- Dense desktop table headers are 34px; row content remains compact without becoming spreadsheet-small.

## Radius and elevation

The radius scale is intentionally small:

- `--radius-sm: 6px` for compact chips and internal controls.
- `--radius-md: 8px` for controls, buttons, and small contained surfaces.
- `--radius-lg: 12px` for meaningful cards and section surfaces.
- `--radius-overlay: 14px` for modals, drawers, and sheets.

Pills are reserved for status and compact categorical labels. Ordinary cards and buttons are not pills. Regular surfaces use a minimal one-pixel shadow; modal, drawer, tooltip, and sheet surfaces use `--shadow-overlay`.

## Typography and financial numbers

The application uses a native system sans stack on desktop and mobile. This eliminates the previous split between condensed desktop typography and native mobile typography.

| Role | Treatment |
| --- | --- |
| Page title | 20–24px, 680 weight, tight tracking |
| Section title | 11px uppercase label for workstation sections or 16px sentence case for mobile sections |
| Card title | 13–16px, 600–680 weight |
| Body | 14px, normal weight |
| Secondary body | 12px, secondary color |
| Label/table header | 10–11px, 600–650 weight, restrained tracking |
| Caption/status | 10–11px, tertiary color |
| Hero financial number | 24–30px, 680–700 weight |

`.font-mono` remains as a compatibility class but now uses the system data face with `tabular-nums lining-nums`. This preserves column stability without making every value look like source code. Do not use bold as the only hierarchy signal.

## Shared primitives

- `PageHeader` and `SectionHeader` in `src/components/ui/PageHeader.tsx` define compact title, context, meta, and action alignment.
- `page-frame` variants define global widths and gutters.
- `surface-card` and `surface-inset` define contained and recessed surfaces.
- `button-primary`, `button-secondary`, `button-ghost`, and `icon-button` define the shared interaction hierarchy.
- `status-badge` defines freshness and state presentation.
- `financial-table` defines shared header, hover, numeric, and divider behavior.
- `overlay-panel` defines modal, drawer, tooltip, and sheet elevation.

These primitives are deliberately small. Page-specific composition remains in page components.

## Controls

- Inputs and selects share radius, border transition, and a three-pixel low-opacity focus halo.
- Primary actions use the accent and its hover token.
- Secondary actions use the secondary surface and default border.
- Ghost/icon actions gain subtle elevated background on hover.
- Disabled controls keep their geometry and reduce opacity; they do not disappear.
- Mobile segmented controls use an inset track and an accent-tinted selected segment.
- Keyboard focus is always visible and independent of hover.

## Cards and surfaces

Use a card only for a meaningful contained object:

- **Instrument card:** ticker identity, primary price, supporting performance and status.
- **Metric card:** label, dominant value, optional context/change.
- **Analytics card:** one bounded visualization or decision unit.
- **Attention card:** an item requiring action, with restrained semantic color.

Do not add cards solely to wrap another heading. Prefer section spacing, background changes, and subtle dividers. Avoid cards inside cards unless the inner object is independently actionable.

## Financial tables

- Text columns are left aligned; comparison-friendly numeric columns are right aligned.
- All numeric content uses tabular lining figures.
- Headers use a consistent quiet uppercase role and 34px height.
- Row hover is a four-percent accent tint without movement.
- Sticky headers use the elevated/secondary theme surface.
- Selected rows use accent tint plus a narrow accent edge where the selection needs to survive horizontal scanning.
- Two-line cells use a stronger primary line and smaller tertiary supporting line.
- Horizontal scrolling belongs to the table wrapper, never the page root.

## Charts

Charts retain their existing calculations and SVG/canvas behavior. Chart chrome should use:

- `surface-card` for the chart object and `surface-inset` for bounded metric strips.
- Tertiary axis/grid text and subtle border/grid contrast.
- The same segmented-control and button language as the rest of the product.
- `overlay-panel` for the interactive chart modal.

## Overlays

Modal, drawer, and sheet surfaces share the overlay shadow, border hierarchy, 14px desktop radius, close-button language, and short transitions. Mobile bottom sheets keep their safe-area padding and purpose-built Account behavior. Drawers do not animate or translate gratuitously, and reduced-motion preferences are respected.

## Theme rules

All four themes map the same roles:

- **Dark:** neutral charcoal; clearest general-purpose workstation theme.
- **Dark Blue:** deep navy canvas with the same surface and border steps as Dark.
- **Light:** cool gray canvas and white contained objects; borders remain visible without looking outlined.
- **Sepia:** warm paper-like canvas with moderated brown accent and financial semantic colors that remain distinct.

Theme-specific CSS may change token values, not component hierarchy, geometry, or interaction semantics. Stronger borders or shadows in one theme require a contrast reason, not aesthetic preference.

## Mobile and landscape rules

- Preserve five existing navigation destinations; do not add an Account tab.
- Portrait bottom navigation uses a subtle selected container, 52px target height, and safe-area padding.
- Landscape navigation remains 42px high and combines icon with label.
- Phone inputs remain at least 16px text to prevent iOS zoom.
- Interactive targets remain at least 44px on phones.
- Full-screen option detail, chart, and Account workflows retain body locking, focus restoration, and safe-area treatment.
- Dense rows remain list surfaces with dividers; do not turn every row into a floating card.
- Route roots clip accidental horizontal overflow; any intentional wide data surface keeps scrolling inside its own bounded wrapper.

## Accessibility and motion

- Use primary/secondary/tertiary text roles in that order; do not place tertiary text on inset backgrounds when it carries required meaning.
- Positive/negative color is supplementary to a numeric sign or text label.
- Every interactive element receives a visible `:focus-visible` outline.
- Hover does not move cards or rows.
- UI transitions use `--transition-ui` (140ms) and `prefers-reduced-motion` collapses them.
- Modal and sheet focus traps, Escape behavior, labels, and dialog roles remain required.
