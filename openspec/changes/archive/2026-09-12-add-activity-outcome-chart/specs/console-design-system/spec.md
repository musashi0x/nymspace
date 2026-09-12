## ADDED Requirements

### Requirement: Charts use one library and theme tokens only

Where the console presents a chart, which Astryx ships no component for, it SHALL draw it with `recharts`, the library Astryx's own dashboard templates use, and every colour in it SHALL be a theme token.

#### Scenario: One charting library

- **WHEN** a chart is added to a console surface
- **THEN** it MUST be drawn with `recharts`, and MUST NOT introduce a second charting library or a hand-drawn SVG equivalent

#### Scenario: Status colours match the timeline's badges

- **WHEN** a chart encodes activity status
- **THEN** success, denied, and failed MUST use the same status tokens the timeline's badges use for those statuses, and MUST NOT use a categorical data palette or a literal colour

#### Scenario: The chart follows the theme mode

- **WHEN** the theme switches between light and dark
- **THEN** the chart's colours MUST follow without a reload, because they are token references rather than resolved values

#### Scenario: The chart honours reduced motion

- **WHEN** the operator has requested reduced motion
- **THEN** the chart MUST render at rest, with no entry or transition animation

#### Scenario: The chart's peer dependencies are declared

- **WHEN** the web application's dependencies are installed
- **THEN** every peer dependency `recharts` declares MUST be satisfied by a declared dependency, so the install reports no unmet peer
