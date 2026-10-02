---
compatibility_baseline: OpenCode v2.0.18
units: terminal cells (columns and rows)
dialog_widths_observed:
  medium: 60
  large: 88
  xlarge: 116
project_defaults:
  dialog_size: medium
  sibling_blank_rows: 0
  between_group_blank_rows: 1
  progress_bar_columns: [16, 20]
theme_roles:
  primary_text: text.base
  metadata: text.muted
  category: hue.accent.200
  focused_row_background: background.action.primary.focused
  focused_row_text: text.action.primary.focused
  current_item_text: text.formfield.selected
  success: text.feedback.success.base
  warning: text.feedback.warning.base
  error: text.feedback.error.base
  info: text.feedback.info.base
---

# TUI design language

## 1. Purpose and force

This document defines the mandatory visual and compositional language for every
project-owned TUI screen, dialog, modal, picker, settings view, status view,
debug view, quota view, route, panel, and plugin UI contribution.

**We are building an OpenCode-native TUI, not a dashboard that happens to render
in a terminal.**

Correct colors, a dark panel, and monospaced text are not sufficient. Native
identity also requires dense rows, meaningful proximity, a single hierarchy,
stable alignment, restrained visual weight, and host-owned presentation.

- **MUST / MUST NOT:** hard rule, subject only to the exception policy below.
- **SHOULD / SHOULD NOT:** expected default; deviation requires a reason.
- **MAY:** optional within the other rules.
- **OBSERVED OPENCODE BEHAVIOR:** directly verified in the pinned host source.
- **PROJECT DECISION:** a deliberate project convention, not a host constant.
- **DESIGN RATIONALE:** an explanation supported by the cited design research.

The front matter distinguishes observed widths from project defaults; theme
paths are resolved OpenCode API roles, not a new independent theme palette.

This document is the authority for project visual design. Implementation MUST
conform to it; existing code, component APIs, tests, and screenshots of project
UI MUST NOT redefine its rules. A mismatch is an implementation deviation, not
a reason to rewrite the standard to describe what already exists.

The rules are implementation-agnostic: they specify visible relationships,
semantic roles, and layout constraints, not component names, file structure,
rendering algorithms, or a required framework. Any implementation MAY satisfy
them through a different composition. OpenCode-specific tokens and geometry
define host compatibility, not a dependency on our current code.

Behavioral contracts continue to govern data correctness and safety. A visual
redesign MUST NOT change those contracts to make a layout easier.

## 2. Sources of truth

For deriving native visual patterns, use this authority order:

1. OpenCode **v2.0.18 source code**.
2. Native OpenCode screenshots and observed behavior for the same version.
3. Official OpenCode **V2** documentation.
4. Established HCI and visual-design research.
5. Explicit project decisions.

This hierarchy governs evidence used to derive and revise the standard; it
does not let implementation bypass an adopted rule. Source establishes what
the host does; project decisions establish what we require of our own UI.
Research explains the pattern, not permission to replace it with a generic web
convention. Screenshots MUST be interpreted with their theme, terminal size,
and state; they MUST NOT become hardcoded color samples.

Observed constants below are pinned to v2.0.18. Official web documentation is
rolling documentation, not a frozen v2.0.18 contract. A host upgrade SHOULD
trigger comparison of sizing, surface tokens, state treatment, and native
components before updating this standard. New host behavior MUST be cited and
version-scoped; it MUST NOT silently invalidate project rules.

## 3. Core laws

1. **Information before decoration.** Every added gap, color, heading, border,
   and container MUST encode a relationship, state, or interaction.
2. **Density without ambiguity.** Use the minimum spacing that makes semantic
   groups unambiguous. Related rows SHOULD be consecutive.
3. **Proximity encodes relationships.** Separation inside a group MUST be less
   than separation between comparable groups.
4. **One hierarchy.** There MUST be one dialog title. Sections and rows MUST NOT
   become competing titles.
5. **Alignment is shared.** Repeated data MUST share a column model, not
   row-by-row visual positioning.
6. **Color has meaning.** Components MUST use semantic host tokens. Accent and
   feedback colors MUST NOT fill otherwise unused space.
7. **Smallest sufficient surface.** Medium is the expected dialog size. Extra
   whitespace is not a reason to choose large.
8. **Terminal-native composition.** Prefer rows, columns, categories, gutters,
   muted metadata, selection backgrounds, and compact actions.
9. **Unused space is not a defect.** Do not enlarge content to fill the terminal
   or a panel. Empty space outside a content-sized dialog is normal.

**DESIGN RATIONALE:** NN/g's proximity principle explains why near elements read
as related and larger separation reads as a group boundary. Its similarity
principle explains why shared treatment implies shared roles. Equal spacing
everywhere erases boundaries; styling every label as a heading erases hierarchy.

## 4. Spatial system

### Units and native geometry

Layout MUST be reasoned about in terminal columns and rows, not pixels, font
sizes, rounded radii, or web spacing scales. Width measurement MUST account for
display-cell width, including Unicode, rather than assume string length always
equals columns.

**OBSERVED OPENCODE BEHAVIOR:**

| Component             | v2.0.18 geometry                                                                        | Meaning                                                    |
| --------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `Dialog`              | Panel top padding: 1 row                                                                | Host provides it; child must not duplicate it accidentally |
| `Dialog`              | Horizontally centered; max width: terminal width minus 2 columns                        | Widths are requests bounded by the terminal                |
| `Dialog`              | Default top offset: terminal height / 4                                                 | Not vertically centered by default                         |
| `DialogSelect`        | Root gap: 1 row; bottom padding: 1 row                                                  | Separates major regions, not each list item                |
| `DialogSelect`        | Title/search left and right padding: 4 columns; search top padding: 1 row               | Title-to-search separation                                 |
| `DialogSelect`        | Scroll left/right padding: 1 column                                                     | Separate from item layout                                  |
| `DialogSelect`        | Category left padding: 3 columns within scroll; later category top padding: 1 row       | Category starts at panel column offset 4                   |
| `DialogSelect`        | Row left padding: 3, or 1 with current-item/gutter; right padding: 3; horizontal gap: 1 | Reserves marker space                                      |
| `DialogSelect.Option` | Title adds 3 columns of left padding                                                    | Item titles are deliberately indented beyond categories    |
| `DialogSelect`        | Footer padding left: 4, right: 2                                                        | Native footer is not universally symmetric                 |
| `DialogDebug`         | Left/right padding: 2 columns; root gap: 1 row; bottom padding: 1 row                   | Denser information-dialog shell                            |
| `DialogDebug`         | Label field: 10 characters, horizontal gap: 1                                           | Local column choice, not a universal label width           |

`dialogSelectContentWidth()` subtracts **12 columns** for its scroll padding,
row padding, gutter, title padding, and separator. This is specific to native
select composition, not a generic padding subtraction for every dialog.

### Project spacing rules

**PROJECT DECISION:**

- Custom selector-like views SHOULD follow the native 4-column title/context
  inset and reserved item gutter. Information/table dialogs SHOULD use the
  native Debug-like 2-column inset. Choose by content type, not to create space.
- Header, context, categories, and footer SHOULD share their intended shell
  edge. Indented selectable items MAY differ through a consistent gutter.
  Custom data tables SHOULD start at the shell edge.
- Related sibling rows SHOULD have **0 blank rows** between them.
- A subsequent semantic group SHOULD have **1 blank row** before its category,
  and **0 blank rows** between category and first item.
- A short description or detail MUST remain adjacent to the item it explains.
  It MAY occupy a continuation row; it MUST NOT introduce decorative gaps.
- Major regions (header/context, body, footer) SHOULD use **1 row** of
  separation, following native shells. A root gap MUST NOT be applied blindly
  to every nested item.
- Additional separation requires a stated semantic or interaction reason.
  Equal gaps between siblings and categories are not an acceptable default.
- Inner bottom padding SHOULD be **1 row**, not a symmetric copy of the
  host's outer top offset. The panel MUST NOT contain a large empty tail.
- Indentation MUST indicate nesting or marker space. Do not accumulate nested
  padding merely because the content has multiple component wrappers.

These are defaults, not a claim that all native dialogs use identical insets.
Consistency means coherent geometry for the chosen pattern, not forcing every
component into one shell.

## 5. Dialog sizing and overflow

**OBSERVED OPENCODE BEHAVIOR:** `DialogSize` is `medium | large | xlarge`.
`dialogWidth()` returns exactly **60 / 88 / 116 columns** respectively.
Medium is the default in `Dialog` and dialog replacement state. Actual panel
width is capped at terminal width minus 2 columns.

| Size   | Project use                                                                       |
| ------ | --------------------------------------------------------------------------------- |
| Medium | Expected default for actions, pickers, settings, short status and quota tables    |
| Large  | Allowed when meaningful values or necessary columns do not fit medium comfortably |
| Xlarge | Allowed when required comparison/data structure still cannot fit large            |

Implementations MUST choose the smallest sufficient native size after accounting
for insets and required columns. They MUST NOT request arbitrary outer widths,
choose large for “breathing room,” or choose xlarge to avoid editing verbose copy.
Custom routes/panels MUST use their host-provided bounds rather than pretend to
be fixed-width dialogs.

**OBSERVED OPENCODE BEHAVIOR:** `DialogDebug` explicitly calls
`dialog.setSize("large")` and displays OS, terminal, session ID, and
provider/model values. **PROJECT DECISION:** those long values are a valid
content-based reason for large. The source does not explicitly state the
author's motivation; “large looks better” is not evidence.

Content MUST be height-sized to intrinsic rows, bounded by usable host space.
Sizing MUST include host placement, panel padding, shell gaps, wrapped context,
status, and footer rows. Terminal height alone is not the usable height.
The visible panel MUST NOT retain empty height simply because its content
region can expand. The sizing mechanism is an implementation choice; the
required outcome is a content-sized panel with bounded overflow.

Scrollable bodies MUST keep their controls reachable, keep categories with
their content in one flow, and update on resize without changing data. A scroll
hint MAY appear only when content actually overflows. Do not cap a roomy
dialog at a tiny arbitrary viewport.

**OBSERVED OPENCODE BEHAVIOR:** native `DialogSelect` caps list height at
`min(rows, floor(terminalHeight / 2) - 6)` and hides scrollbars. This is a
selector-specific budget, not a universal formula for plugin information views.
The host's quarter-height offset is likewise an observation, not permission to
copy an approximate height budget without verifying the mounted layout.

## 6. Typography and hierarchy

All levels use terminal typography. Hierarchy MUST come from role, weight,
color, alignment, and proximity, not oversized text or decorative casing.

| Level | Role               | Required/default treatment                                                   |
| ----- | ------------------ | ---------------------------------------------------------------------------- |
| 1     | Dialog title       | `text.base`, bold; one textual identity per dialog                           |
| 2     | Category/section   | `hue.accent[200]`, usually bold; short and subordinate                       |
| 3     | Item/primary value | `text.base`, normal; bold selectively for selection or a meaningful emphasis |
| 4     | Metadata/helper    | `text.muted`, normal; compact and adjacent                                   |
| 5     | Action/key hint    | Action base text, MAY be bold; binding muted                                 |

**OBSERVED OPENCODE BEHAVIOR:** `DialogSelect` uses bold base title, bold accent
categories, normal base items, and muted descriptions/footers; active items
use focused colors and bold. `DialogDebug` uses muted field labels and base
values. Therefore not every field label must be base-colored or bold.

**PROJECT DECISION:** categories SHOULD use sentence-style names (`Gemini
models`), not all-caps banners. Ordinary row labels such as `Weekly` and
`Five-hour` SHOULD NOT be bold. Categories MUST NOT repeat title-like weight,
extra spacing, and long paragraphs to create miniature pages.

## 7. Semantic color system

Components MUST consume the active OpenCode semantic theme tokens where
available. Components MUST NOT hardcode hex colors, ANSI palette numbers, or a
dark-theme approximation to imitate a screenshot. Custom themes and light mode
are part of the contract, not optional variants.

Theme roles MUST resolve through the host's public theme interface and the
appropriate surface context. Dialog content MUST use dialog-contextual roles
where those differ from the base surface. Theme access and propagation are
implementation choices, not prescribed component dependencies. Host-owned
dialogs provide their own panel and backdrop; plugin content MUST NOT repaint
a second panel by default.

**OBSERVED OPENCODE BEHAVIOR:** the public v2.0.18 context exposes a
`ResolvedTheme`; it has `surface(name)`. Native `Dialog` establishes a dialog
theme context and uses dialog `background.base`. Native selects use the dialog
surface explicitly. Contextual tokens can differ from top-level ones.

| Meaning                                                  | Token / treatment                                                             |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Primary readable text                                    | `text.base`                                                                   |
| Description, timestamp, helper, secondary value, binding | `text.muted`                                                                  |
| Category                                                 | `hue.accent[200]`                                                             |
| Focused selectable row                                   | `background.action.primary.focused` paired with `text.action.primary.focused` |
| Current item (not navigation focus)                      | `text.formfield.selected`, plus a marker where appropriate                    |
| Focused input                                            | `background.formfield.focused`, `text.formfield.focused`; placeholder muted   |
| Disabled action                                          | Matching `text.action.*.disabled`; not error by default                       |
| Success / warning / error / info                         | Corresponding `text.feedback.*.base`                                          |

Accent denotes category/emphasis, not a success state. Success denotes success
or a positive domain status, not categories. Warning/error/info MUST describe
actual states. A normal reset countdown is metadata, not a warning. Empty or
unknown is not automatically error. Being disabled is not automatically failure.

Color MUST NOT be the only way to convey state: preserve labels, values, or
markers. Focus/selection MUST use a coordinated foreground/background pair;
changing only the background can make text unreadable.

### v2.0.18 diagnostic reference values

**OBSERVED OPENCODE BEHAVIOR:** these are the built-in `opencode` dark-theme
values. They are diagnostic references, **not component constants**.

| Role             | Dark reference | Resolved role                                                     |
| ---------------- | -------------- | ----------------------------------------------------------------- |
| Base background  | `#0a0a0a`      | `background.base`                                                 |
| Panel background | `#141414`      | `background.raised.base`; dialog `background.base`                |
| Primary text     | `#eeeeee`      | `text.base`                                                       |
| Muted text       | `#808080`      | `text.muted`                                                      |
| Accent           | `#9d7cd8`      | `hue.accent[200]`                                                 |
| Success          | `#7fd88f`      | `text.feedback.success.base`                                      |
| Warning          | `#f5a742`      | `text.feedback.warning.base`                                      |
| Error            | `#e06c75`      | `text.feedback.error.base`                                        |
| Info             | `#56b6c2`      | `text.feedback.info.base`                                         |
| Interactive      | `#fab283`      | `hue.interactive[200]`; default focused primary-action background |

Important refinement: `packages/tui/src/theme/assets/opencode.json` contains
the legacy flat theme values. v2.0.18 `theme/index.ts` overrides the built-in
`opencode` entry with **`assets/v2/opencode.json`**, whose semantic roles and
dialog override are the runtime source. Both confirm the reference colors;
the flat names are not the plugin API. Accent is not interchangeable with
interactive color. Light/custom themes may resolve them differently.

## 8. Grouping, categories, and metadata

Grouping MUST first use proximity, alignment, semantic color, and typography,
in that order. An explicit enclosing region MAY be used when a distinct
interaction boundary requires it, not simply to make a group visible.

BAD: spacing gives each item its own island and weakens the category relation.

```text
Section A
description

item 1

item 2


Section B
description

item 1
```

GOOD: compact metadata supplements categories; sibling rows stay together.

```text
Section A                      short metadata
item 1                         value
item 2                         value

Section B                      short metadata
item 1                         value
```

The defect in the bad example is not merely quantity of whitespace: spacing
fails to encode the relationships. A heading MUST be closer to its own items
than to the preceding group's last item.

Short model/member metadata SHOULD share the category row, using muted text
and left/right alignment. Avoid repetitive prose such as `Models within this
group:` when context already establishes the meaning. Long explanations MAY
wrap immediately below their label when needed; compacting copy MUST NOT
misrepresent group membership or discard necessary meaning.

Categories SHOULD be compact accent labels, followed immediately by rows.
Category labels MUST NOT masquerade as additional page titles. A new category
SHOULD receive the single blank-row boundary established in the spatial system.

## 9. Data rows and lightweight tables

Repeated information MUST use stable columns across the comparison set.
Define widths from the common data/layout model, including unknown values and
longest expected labels. Do not pad or position each row until it looks right.

- Names and primary textual values SHOULD be left-aligned.
- Percentages and other comparable numbers SHOULD be right-aligned.
- Durations SHOULD share a right edge; textual states such as `available` MUST
  have a consistent column policy across all rows.
- Fixed-width labels MAY be used when the label set is bounded. Debug's
  10-character label field is an example, not a project-wide width.
- Groups comparing the same quantities SHOULD reuse the same columns and bar
  lengths, even when one group's values are shorter.
- Columns SHOULD have the minimum cell gap needed to avoid ambiguity. A
  one-column gap is a **PROJECT DECISION** starting point, consistent with
  native row gaps; it is not mandatory when content requires more separation.

```text
Weekly      ███████████░░░░░  66.03%  18h 51m
Five-hour   ███████████████░  96.78%      59m
```

Width MUST be measured inside the mounted host container, after padding,
gutters, and any scrollbar allocation. Do not assume terminal width is body
width. On resize, repeated rows MUST switch layout coherently.

When space is insufficient, first shorten redundant copy and subordinate
metadata, then adapt columns. Native size escalation is allowed for necessary
information, not decorative space. On narrow terminals, rows MAY stack into
adjacent continuation lines; they MUST retain row association and group
boundaries. Quantities, unknown state, and action bindings MUST NOT be clipped.
Nonessential metadata MAY truncate with an explicit ellipsis. Identifiers MAY
use middle/left truncation if the distinguishing portion remains useful and
the full value remains obtainable. Debug-style values MAY wrap.

**OBSERVED OPENCODE BEHAVIOR:** `DialogSelect.Option` uses nonwrapping,
overflow-hidden titles with truncation and supports right-side metadata;
details can wrap or truncate. Debug values use word wrapping. No single
wrapping policy applies to all content.

## 10. Progress and quantitative information

**PROJECT DECISION:** quota/progress bars SHOULD use **16–20 cells** in a normal
medium-width dialog as a starting range. This is not an OpenCode constant.
Bars MAY shorten on constrained terminals or differ for a genuinely different
task; they MUST NOT stretch merely to consume available width.

- Bars MUST remain subordinate to readable data. A row-height bar is the
  default; large graphical blocks and multi-row meters MUST NOT be decorative.
- Percentages MUST remain independently readable in text. Users must not have
  to estimate the bar or decode color to learn a value.
- Comparable bars MUST share length and scale. Quota display MUST distinguish
  remaining capacity from used capacity through labels/context.
- Filled portions SHOULD use semantic positive/status color where justified.
  Unfilled portions SHOULD use muted treatment. Simple unbracketed bars are
  the project default; frames MUST NOT be added merely for ornament.
- Unknown values MUST be labeled `unknown`, never drawn or labeled as zero.
  Actual zero and full values MUST remain distinguishable from unknown.
- Reset/refresh values SHOULD be short muted metadata in the row, aligned
  consistently. A duration needs surrounding context that identifies it as a
  reset time; compact copy MUST NOT become an ambiguous number.
- Warning/error bar treatment requires a domain-defined state or threshold.
  This document does not invent new quota thresholds or data semantics.

Distinct measurement windows MUST remain separately labeled. Rendering MUST
preserve unknown, saved/stale, partial-result, and fallback semantics defined
by the domain; reduced visual weight is not reduced truthfulness.

## 11. Headers

The default header MUST be a bold base-text title at the left and muted `esc`
at the right, following native dialog composition. The escape affordance MUST
perform the actual close/back behavior; it MUST NOT be decorative. Displayed
shortcut hints SHOULD reflect configured bindings wherever the public API
provides them.

```text
Antigravity quota                                    esc

account@example.com
```

Context/search/account SHOULD appear beneath the title when it qualifies the
entire view. Context MUST NOT be repeated in each section. This title/context
pattern is compatible with native title/search composition; it need not be
redesigned to compensate for an oversized body.

Native shell/backdrop ownership MUST be respected. Do not add fake borders,
banner headings, or independent panel chrome around host-mounted content.

## 12. Footers

**PROJECT DECISION:** utility metadata and actions SHOULD share one terminal
row when they fit, with metadata left and actions right.

```text
Updated 02/10/2026, 17:10:00                 refresh ctrl+r
```

Metadata MUST be muted. Action text MAY be bold/base; the binding SHOULD be
muted in the normal state. Focused/disabled actions MUST use their corresponding
state tokens. Related actions SHOULD remain compact; explanatory text MUST NOT
turn the footer into another section.

**OBSERVED OPENCODE BEHAVIOR:** Debug puts explanatory text and `copy enter`
on one left/right row. Select footers support left and right action clusters,
with 2-column gaps between actions. Below terminal width 60, their left cluster
switches to consecutive rows. Thus a one-row footer is an expected default,
not a claim that OpenCode never stacks utilities.

On narrow terminals, footer content MAY stack without blank rows. Important
failure text MAY use an adjacent status row when necessary. Actions MUST remain
reachable; timestamps SHOULD compact before forcing a wider dialog. Do not
duplicate `esc` in the footer when the header already supplies it. A scroll hint
MAY be included on actual overflow, not permanently advertised.

## 13. States

The following project rules use native token/state evidence where specified;
loading/status compositions are project decisions, not extracted universal
OpenCode widgets.

| State                      | Treatment                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normal                     | Base primary information, muted secondary information; no feedback color without meaning                                                          |
| Focused                    | Use the role's focused foreground/background pair; MUST visibly identify keyboard target                                                          |
| Selected/navigation-active | Native select uses focused primary-action background and focused bold text; MUST NOT rely on bold alone                                           |
| Current/committed item     | Native select distinguishes it from navigation focus with `●` and selected-formfield text; project MUST preserve this distinction when both exist |
| Disabled                   | Role's disabled text, concise reason when useful, no false active interaction; MUST NOT use error merely to mean disabled                         |
| Muted                      | Secondary information, not an unavailable state; MUST remain readable on the active surface                                                       |
| Success                    | Success feedback token plus explicit result/status; not category decoration                                                                       |
| Warning                    | Warning feedback token plus specific recoverable condition; not routine reset text                                                                |
| Error                      | Error feedback token plus actionable error text; MUST NOT recolor unrelated valid data as failure                                                 |
| Loading                    | Compact inline `Loading…` / `Refreshing…` or native indicator; retain meaningful saved data and identify it appropriately                         |
| Empty                      | Muted, concise statement and useful next action if applicable; no ornamental empty-state illustration                                             |

**OBSERVED OPENCODE BEHAVIOR:** native select filters disabled options out,
uses `No items available` / `No results found` in muted text, and changes row
treatment when an action owns focus. A project view MAY show disabled entries
when they must remain manageable, but MUST explain and enforce unavailable
actions. Do not conflate disabled items, disabled accounts, and failed requests.

States MUST preserve layout continuity where practical. Refreshing MUST NOT
replace a useful table with a full-page ornamental spinner. Color MUST be
supplemented by text/markers, and keyboard/mouse paths MUST expose the same
meaningful actions.

## 14. Web UI Leakage — patterns we do not use

Reject these unless the exception policy supplies a concrete requirement:

- Cards inside dialogs, cards inside cards, and rounded containers used solely
  to group static rows.
- A panel for every category, metric, or setting.
- Giant progress bars or visualizations stretched to fill the panel.
- Oversized, all-caps, or repeatedly bold headings competing with the title.
- Decorative horizontal rules between ordinary rows or every category.
- Large symmetric top/bottom padding or a viewport-sized blank tail.
- Equal spacing at every nesting level or blank rows between all siblings.
- Arbitrary outer dialog widths, automatic large sizing, or width justified by
  empty space.
- Centered dashboard content instead of scan-friendly left-aligned rows.
- Bright colors added because a block looks empty.
- Each component wrapper becoming a visibly separate island.

An invisible layout wrapper is not itself a prohibited “card.” The prohibition
concerns visible container treatment and spatial isolation, not a particular
element type or component abstraction.
Selection backgrounds and focused form fields are meaningful native regions,
not dashboard decoration.

**Enforcement:** for every extra gap/container/color, a reviewer MUST be able to
name its encoded relationship, interaction, or state. If it only makes empty
space look occupied, remove it. “Technically works” and “looks cleaner to me”
are not sufficient grounds to ship a conflicting design.

## 15. Canonical compositions

These diagrams define relationships, not exact character counts. They omit
color and background; apply the role hierarchy above. No fake borders are
implied. Native selector indentation MUST be preserved when using native
components; flat information tables need not inherit selector indentation.

### Simple dialog

```text
Reconnect account                                   esc

Sign in again to restore access.

                                          reconnect enter
```

### Selectable list

```text
Select agent                                        esc

Search

   build              implementation
   plan               investigation
   review             verification

choose enter
```

Navigation focus is a themed row background; a current-item marker is separate.

### Grouped list

```text
Select model                                        esc

Search

Favorites
   Model A                                      provider
   Model B                                      provider

Other models
   Model C                                      provider

favorite key                              connect key
```

`key` is a placeholder for the resolved binding, not a literal shortcut.

### Label/value information dialog

```text
Debug                                               esc

Version     2.0.18
OS          Windows
Terminal    terminal information
Model       provider/model-id

Share when reporting an issue.                copy enter
```

Field labels are muted; values are base. Long required values can justify large.

### Quota/status dialog

```text
Usage                                               esc

account@example.com

Model group                               member names
Weekly      ████████░░░░░░░░  50.00%   resets in 2d
Five-hour   ████████████░░░░  75.00%   resets in 1h

Updated …                                 refresh ctrl+r
```

### Settings-style dialog

```text
Settings                                            esc

Search

Appearance
   Theme                                        opencode
   Mode                                             dark

Behavior
   Notifications                                      on

change enter
```

This is a project composition using native category/item roles, not a claim of
an exact Settings implementation snapshot.

### Footer with action

```text
Saved values · stale                       refresh ctrl+r
```

The status is metadata; `refresh` is an action; `ctrl+r` is its binding.

## 16. Canonical Antigravity quota example

```text
Antigravity quota                                      esc

bearingme001@gmail.com

Gemini models                                  Flash, Pro
Weekly      ███████████░░░░░  66.03%                18h 51m
Five-hour   ███████████████░  96.78%                    59m

Claude + GPT                        Opus, Sonnet, GPT-OSS
Weekly      ████████████████  98.99%                 6d 23h
Five-hour   ████████████████  98.70%                 4h 57m

Updated 02/10/2026, 17:10:00                 refresh ctrl+r
```

**PROJECT DECISION:** the durations in this composition mean **time until
reset**, and bars/percentages mean **quota remaining**. Real copy MUST make
those meanings discoverable, for example in compact row labels or a shared
column label. The bar is approximate; the textual percentage is authoritative.
Names and numbers here are illustrative, not a data contract.

Required relationships:

- Medium SHOULD be used if actual required content fits; the diagram itself is
  not a guarantee of fitting 60 columns after insets and localization.
- Title base/bold; category accent; model members muted; row labels normal.
- Weekly and five-hour are adjacent siblings, not sub-pages.
- One blank row separates families; no nested panels or separator lines.
- Bars are compact, comparable, and aligned; numbers remain readable.
- Member metadata supplements the category instead of creating a paragraph.
- Timestamp and refresh action share a utility row when possible.

An equivalent composition MAY put necessary long member metadata immediately
under the category or stack constrained data columns. It MUST preserve
proximity, hierarchy, factual meaning, and a bounded footprint. Unknown/reset
unavailable states and explicitly labeled per-model fallback MUST remain
truthful. This example does not authorize changes to fetching or aggregation.

## 17. Mandatory review checklist

Agents and reviewers MUST apply this checklist before shipping any new or
changed project UI. A failed MUST rule blocks approval unless an eligible
exception is documented. Passing render tests alone does not prove conformity.

- [ ] Is the smallest sufficient native dialog size used, with a content-based
      reason for large/xlarge?
- [ ] Are bounds measured in the host container, including placement, padding,
      wrapping, status, and footer?
- [ ] Does the panel end after content/footer padding, without an expanded
      viewport or blank tail?
- [ ] Are siblings consecutive and closer than separate groups?
- [ ] Does every blank row encode a boundary rather than “breathing room”?
- [ ] Are categories adjacent to their rows and visually subordinate to the
      unique title?
- [ ] Is short metadata compact rather than heading + paragraph + sub-page?
- [ ] Do repeated rows share label, bar, value, and reset columns?
- [ ] Are bars compact and percentages readable without color or estimation?
- [ ] Does every color have a semantic role, using live OpenCode theme tokens?
- [ ] Are focused/current/disabled states distinct and meaningful?
- [ ] Do header/context/body/footer edges follow the chosen native pattern,
      with only intentional gutter indentation?
- [ ] Can footer metadata/actions share a row? If not, is stacking justified
      by actual width or necessary status content?
- [ ] Are actions reachable, actual bindings displayed, and overflow hints
      conditional on real overflow?
- [ ] Is each visible container necessary for interaction, not an empty-space
      filler?
- [ ] Have normal, loading, partial/error, disabled, empty, and unknown states
      been checked where applicable?
- [ ] Has the mounted UI been inspected at a roomy size, 80×24, and a narrow
      size, including resize, long values, and light/custom theme treatment?
- [ ] Does it read as an OpenCode list/table, or as a web dashboard in monospace?
      If the latter, reject the proposal even if it technically works.

The 80×24 review case is a **PROJECT DECISION** regression baseline, not a host
minimum terminal size. At smaller constraints, controls MUST remain reachable
through an appropriate adapted composition; an impossible fit is not permission
to silently clip actions.

## 18. Exceptions and maintenance

A deliberate exception is permitted only when:

1. Terminal constraints require it.
2. Accessibility requires it.
3. Interaction requirements require it.
4. A newer verified native OpenCode pattern supersedes the pinned pattern.

An exception MUST identify the rule, concrete constraint, alternative considered,
and affected scope. It SHOULD be documented close to the implementation with
the host version when relevant. SHOULD deviations likewise require a reason.
“Looks better,” “more modern,” and “there was unused space” are not sufficient.

A local exception MUST NOT become a new universal default accidentally.
Accessibility adjustments MUST preserve semantic distinctions and readable
state signals rather than merely increase padding or add bright colors.

Implementation changes MUST be evaluated against this standard regardless of
which components render them. A shared component does not confer compliance;
a bespoke composition does not imply a violation. Review the visible result
and its behavior under constraints.

Changes to the design language MUST have an independent design justification:
verified host evolution, user needs, accessibility, or interaction constraints.
They MUST NOT be made merely to accommodate an existing component, avoid a
refactor, or make current tests pass. Implementation examples illustrate the
rules; they do not define or exhaust them.

## 19. References

All sources below were inspected. Source observations are pinned; official
documentation is rolling. No exact native Settings source or independent
screenshot measurements are asserted by this document.

### OpenCode v2.0.18 source

Repository: [anomalyco/opencode](https://github.com/anomalyco/opencode).
Baseline: [v2.0.18 tag](https://github.com/anomalyco/opencode/tree/v2.0.18).

| Exact path and link                                                                                                                                   | Symbol/component                                                     | Evidence used                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [`packages/tui/src/ui/dialog.tsx`](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/tui/src/ui/dialog.tsx)                                 | `DialogSize`, `dialogWidth`, `Dialog`, dialog `init`                 | 60/88/116 widths, medium default, terminal-minus-2 cap, quarter-height offset, optional centering, backdrop, dialog surface, top padding |
| [`packages/tui/src/ui/dialog-select.tsx`](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/tui/src/ui/dialog-select.tsx)                   | `DialogSelect`, `Option`, `FooterAction`, `dialogSelectContentWidth` | Root/region gaps, categories, item gutters, state tokens, truncation, row counting, height bound, narrow footer stacking                 |
| [`packages/tui/src/component/dialog-debug.tsx`](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/tui/src/component/dialog-debug.tsx)       | `DialogDebug`                                                        | Explicit large size, 2-column insets, consecutive rows, 10-character labels, wrapped values, one-row metadata/action footer              |
| [`packages/tui/src/theme/assets/opencode.json`](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/tui/src/theme/assets/opencode.json)       | `defs`, `theme`                                                      | Legacy flat dark/light reference colors; not the resolved plugin token API                                                               |
| [`packages/tui/src/theme/assets/v2/opencode.json`](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/tui/src/theme/assets/v2/opencode.json) | `base`, `dark`, `light`, `@dialog`                                   | Actual built-in semantic tree, accent/interactive distinction, feedback colors, contextual panel treatment                               |
| [`packages/tui/src/theme/index.ts`](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/tui/src/theme/index.ts)                               | `getOpenCodeTheme`, `listThemes`, `parseTheme`                       | V2 asset overrides legacy default; supports migrated legacy themes                                                                       |
| [`packages/tui/src/context/theme.tsx`](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/tui/src/context/theme.tsx)                         | `ThemeContextProvider`, `useTheme`                                   | Surface-context resolution and live theme handling                                                                                       |
| [`packages/theme/src/tui/types.ts`](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/theme/src/tui/types.ts)                               | `ResolvedTheme`, `ResolvedThemeTokens`                               | Public semantic paths, interaction states, `surface(name)`                                                                               |
| [`packages/theme/src/tui/v1-migrate.ts`](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/theme/src/tui/v1-migrate.ts)                     | `migrateV1`, `migrateMode`                                           | Legacy colors become semantic roles; focused/action/dialog mappings                                                                      |
| [`packages/plugin/src/tui/context.ts`](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/plugin/src/tui/context.ts)                         | `Context`, `Dialog`, `Keymap`                                        | Public theme, native size options, dialogs, resolved shortcut access                                                                     |
| [`packages/tui/src/component/dialog-agent.tsx`](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/tui/src/component/dialog-agent.tsx)       | `DialogAgent`                                                        | Native Select agent delegates to `DialogSelect`, with title/description/current item                                                     |
| [`packages/tui/src/component/dialog-model.tsx`](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/tui/src/component/dialog-model.tsx)       | `DialogModel`                                                        | Native model categories, metadata, and actions delegate to `DialogSelect`                                                                |

### Official OpenCode V2 documentation

- [Plugin overview](https://opencode.ai/v2/docs/build/plugins) — server/plugin
  boundary and separate CLI plugin surface; not a visual spacing specification.
- [CLI plugin guide](https://opencode.ai/v2/docs/build/plugins/cli) — semantic
  `context.theme`, `usePlugin`, host dialogs, presentation options, keymaps,
  slots, and host-owned panel sizing.
- [CLI Theme](https://opencode.ai/v2/docs/cli/theme) — semantic tokens,
  light/dark/system modes, interaction states, and `@dialog` surface overrides.

### Design research

- Nielsen Norman Group, Aurora Harley,
  [“Proximity Principle in Visual Design”](https://www.nngroup.com/articles/gestalt-proximity/)
  (August 2, 2020) — near elements read as related; varied separation encodes
  meaningful groups; responsive changes must preserve those relationships.
- Nielsen Norman Group, Aurora Harley,
  [“Similarity Principle in Visual Design”](https://www.nngroup.com/articles/gestalt-similarity/)
  (September 6, 2020) — repeated color/shape/size/typography signals common roles;
  consistent treatment supports expectations. We use this to justify role
  hierarchy, not to import web button/card styling.
