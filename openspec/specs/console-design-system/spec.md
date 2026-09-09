# console-design-system Specification

## Purpose

How the console renders, as distinct from what it says — the component system every surface is built from, the owned theme that carries the visual register and its token roles, font loading, the `Frame` primitive and its background-punch requirement, the data-display rules for tables, lists, and metrics, and the boundary that keeps a design decision out of a screen file.

## Requirements

### Requirement: One component system backs every console surface

The console SHALL be built from `@astryxdesign/core` components. No component source SHALL be copied in from the Markdown Graphs shadcn registry, which supplies the visual target only.

#### Scenario: Interactive data uses Astryx

- **WHEN** a screen renders a table, list, or metric
- **THEN** it MUST use the corresponding Astryx component rather than a hand-written element or a registry copy

#### Scenario: The registry is not a dependency

- **WHEN** the dependency set is inspected
- **THEN** it MUST contain no package or copied source originating from the Markdown Graphs registry

### Requirement: An owned theme carries the visual register

The application SHALL apply a single owned Astryx theme, wrapped at the root, and SHALL NOT import a prebuilt theme stylesheet alongside it.

#### Scenario: The theme is applied, not merely configured

- **WHEN** the application renders
- **THEN** the owned theme module MUST be imported and provided through `<Theme>`, and the `@astryxdesign/theme-neutral` stylesheet import MUST be absent

#### Scenario: The register's typographic traits come from the theme

- **WHEN** theme tokens are resolved
- **THEN** the type scale, monospace family, and radius scale MUST come from the theme's `typography` and `radius` configuration rather than from a screen or a stylesheet

#### Scenario: No colour is redefined at the document root

- **WHEN** application stylesheets are inspected
- **THEN** no `--color-*` token SHALL be reassigned in `:root`; theme-local roles MUST be declared through the theme's own token mechanisms

### Requirement: A named font is loaded, not merely named

Any font family the theme names SHALL be loaded by the application and SHALL be paired with a fallback stack.

#### Scenario: The monospace family is served

- **WHEN** the theme names a monospace family that is not a system font
- **THEN** the application MUST declare that font in the document, and the theme MUST declare a metric-similar fallback stack

#### Scenario: Fallback is survivable

- **WHEN** the named font fails to load
- **THEN** the fallback stack MUST render monospace text at the same nominal size, so the layout degrades rather than reflowing

### Requirement: The Frame primitive presents titled content

The console SHALL provide a single `Frame` primitive rendering a dashed border, corner marks, and a bracketed title, and every framed surface SHALL use it.

#### Scenario: Frame wraps arbitrary content

- **WHEN** `Frame` is given children
- **THEN** it MUST render them unmodified, so an interactive Astryx component retains its sorting, selection, and pagination behaviour inside it

#### Scenario: The title is programmatically associated

- **WHEN** `Frame` renders a title
- **THEN** the title MUST be a caption associated with the framed region, and the corner marks MUST be hidden from assistive technology

#### Scenario: Frame defines no colour of its own

- **WHEN** `Frame`'s styles are inspected
- **THEN** every colour and spacing value MUST resolve to a theme token, with no literal colour or pixel value

### Requirement: Frame's background punch follows its surface

`Frame` SHALL paint its corner marks and title with the background of the surface it sits on, and that surface SHALL be caller-controlled.

#### Scenario: Frame on a non-default surface

- **WHEN** `Frame` is placed on a surface other than the page body
- **THEN** the caller MUST be able to declare that surface, and the border MUST NOT show through the title or the corner marks

#### Scenario: The default is the page body

- **WHEN** no surface is declared
- **THEN** `Frame` MUST paint against the page body background

### Requirement: Dense data renders as rows

Tabular and list data SHALL render as rows at compact density. A card per record SHALL NOT be used for uniform data.

#### Scenario: Tables are compact and ruled

- **WHEN** a table of uniform records renders
- **THEN** it MUST use compact density with row dividers and no per-record card

#### Scenario: Columns declare width

- **WHEN** a table column is defined
- **THEN** it MUST declare an explicit proportional or pixel width, so no column collapses on a narrow viewport

#### Scenario: Numeric columns align

- **WHEN** a column holds numbers, addresses, hashes, or timestamps
- **THEN** its figures MUST be tabular, so values align vertically across rows

### Requirement: Provenance survives the visual change

The restyle SHALL NOT weaken any display rule the console already enforces.

#### Scenario: Externally-read values stay labelled

- **WHEN** a value read from outside the process is displayed in a restyled component
- **THEN** its source and read time MUST still be required by the component's interface, not optional

#### Scenario: Absence stays distinct from zero

- **WHEN** a value is unavailable
- **THEN** it MUST render through the console's absent state and MUST NOT render as `0`, an empty string, or a blank cell

### Requirement: The wrapper exception is documented

The repository's agent guidance SHALL record the exception that permits `Frame`'s wrapper elements, scoped by name.

#### Scenario: The carve-out is discoverable

- **WHEN** the agent guidance for the web application is read
- **THEN** it MUST name `Frame` and its parts as the permitted exception to the layout-element prohibition, and MUST state the reason

#### Scenario: The exception does not generalise

- **WHEN** a component other than `Frame` introduces a raw layout element
- **THEN** the guidance MUST NOT be readable as permitting it
