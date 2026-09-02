# Mobile Financial Tables — Stage 1

This pass keeps the financial workstation model intact while giving phone portrait a compact comparison surface and giving phone landscape the same wide-table workflow used by desktop.

## Portrait surfaces

- Option Chain is a six-column table: Strike, Last Trade, OTM/ITM, AY Last, AY Bid, and AY Ask. Values remain canonical; the existing Option Detail Drawer contains Greeks, IV, OI, volume, nominal yield, and other secondary fields.
- Watchlist stars are independent controls and do not trigger row selection. A deliberate row tap opens the existing drawer.
- Active Portfolio positions are compact disclosure rows with Ticker, Expiry/DTE, Strike, Gain/Loss, % Captured, and a chevron. Mark, paired Delta/IV, distance, entry context, Open details, and Edit remain in the expanded row.
- History uses the same compact disclosure pattern with Ticker, Exp., Strike, Realized P&L, and Realized IRR as the primary row. History groups start collapsed and expand through their existing group controls.
- Fresh and Aging quote states are silent in normal rows. Stale and Unavailable states remain visibly called out; thresholds and decision gating are unchanged.

The portrait Option Chain keeps its real six-column header (`Strike`, `Last Trade`, `OTM/ITM`, `AY Last`, `AY Bid`, `AY Ask`) sticky while the route-owned chain scrolls. The sticky offset is measured from the live mobile ticker header, so expiration controls, safe-area padding, and rerenders do not require duplicated widths or a floating fake header. The header uses an opaque inset surface and a quiet divider; the shared grid definition keeps it aligned with body rows.

## Phone landscape

The responsive mode routes 667×375 and 844×390 through the wide Schedule, History, and Option Chain tables. The first Ticker column is the only frozen identity column. It uses `position: sticky`, `left: 0`, an opaque theme surface, and a divider so horizontal scrolling never duplicates a pane or lets data bleed underneath.

## Density measurements

The deterministic visual harness records row metrics alongside screenshots. The representative desktop fixture measured:

| Surface | Measured height |
| --- | ---: |
| Active Schedule child row | 34 px |
| Active Schedule group row | 27 px |
| History child row | 28 px |
| History group row | 28 px |
| Realized P&L chart | 162 px (unchanged) |

The portrait fixture measured 48 px Option Chain rows (30 px header) and approximately 55–56 px collapsed active-position rows. Chart value labels keep a 6 px bar/label gap in portrait and a 4 px equivalent gap in phone landscape without increasing chart height.

## Verification

`e2e/ui-overhaul-ui2.visual.spec.ts` covers the six-column Option Chain, stale Last Trade, drawer selection, and landscape wide-table path. `e2e/ui-overhaul-ui3.visual.spec.ts` covers portrait disclosure rows, hidden portrait priority rail, collapsed/expanded History, landscape sticky Ticker columns, overflow, themes, and desktop row parity.
