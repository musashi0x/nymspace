# console-data-browsing Specification

## Purpose
TBD - created by archiving change polish-console-ui. Update Purpose after archive.
## Requirements
### Requirement: Row lists render in a bounded window

A console screen rendering a list of rows SHALL mount at most 40 rows at a time, regardless of how many rows the response carried. The window size SHALL be defined once and shared by every screen that windows rows.

#### Scenario: A response larger than the window

- **WHEN** a screen receives more than 40 rows
- **THEN** exactly 40 rows MUST be present in the rendered output, and the remainder MUST NOT be mounted

#### Scenario: A response smaller than the window

- **WHEN** a screen receives 40 or fewer rows
- **THEN** every row MUST be rendered and no extension affordance MUST appear

#### Scenario: One definition of the window size

- **WHEN** the console's source is inspected
- **THEN** the row count MUST come from a single exported constant, and no screen or table file MUST declare its own

### Requirement: The window extends on reaching the end of the list

The window SHALL grow by one further increment when the operator reaches the end of the rendered rows, appending to the existing rows rather than replacing them.

#### Scenario: Reaching the end extends the window

- **WHEN** the end of the rendered list enters the viewport and unshown rows remain
- **THEN** the next increment of rows MUST be appended below the existing rows, and the rows already on screen MUST keep their position

#### Scenario: The end of the data

- **WHEN** every fetched row is rendered
- **THEN** no further extension MUST occur and the extension affordance MUST be gone

#### Scenario: Extension is not motion

- **WHEN** the operator has requested reduced motion
- **THEN** extension MUST still occur; only the animation on the arriving rows is suppressed

### Requirement: The operator is told what the window is showing

A windowed list SHALL state how many rows are shown out of how many were loaded, and SHALL NOT state or imply a total the server did not send.

#### Scenario: The count is present and honest

- **WHEN** a windowed list is rendered with more rows loaded than shown
- **THEN** the screen MUST state the shown count and the loaded count, and MUST NOT present either as the number of records that exist

### Requirement: Structured evidence is rendered readably and can be copied

Structured evidence SHALL be rendered as indented, syntax-highlighted JSON with a copy control, through the design system's code-display component. It SHALL NOT be rendered as a single-line serialization.

#### Scenario: Evidence is legible

- **WHEN** an event carrying structured evidence is expanded
- **THEN** the evidence MUST render as indented JSON with syntax highlighting, and MUST NOT be a single unbroken line

#### Scenario: Evidence can be lifted out in one gesture

- **WHEN** evidence is rendered
- **THEN** a copy control MUST be present that places the full serialized evidence on the clipboard

#### Scenario: Long evidence bounds itself

- **WHEN** the evidence exceeds the available height
- **THEN** the code display MUST bound its own height and scroll internally, rather than being nested inside a separate scroll container

### Requirement: Absent evidence is absent, not empty

Evidence that is missing or cannot be serialized SHALL NOT render as an empty value.

#### Scenario: No evidence was carried

- **WHEN** an event's evidence is `undefined` or `null`
- **THEN** the console's documented absent-value presentation MUST be rendered, and no empty code block MUST appear

#### Scenario: Evidence that cannot be serialized

- **WHEN** serializing the evidence throws, or the value contains a type JSON cannot represent
- **THEN** the row MUST still render, showing the evidence in a fallback form together with a statement that it could not be serialized

