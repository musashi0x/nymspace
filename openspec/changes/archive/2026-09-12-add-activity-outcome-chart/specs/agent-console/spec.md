## ADDED Requirements

### Requirement: The activity timeline opens on an outcome summary

The console SHALL present, above the activity timeline, the number of events by source and by outcome, counted over the whole activity log.

#### Scenario: Counts cover the whole log, not the loaded page

- **WHEN** the log holds more events than the timeline has loaded
- **THEN** the summary's counts MUST come from the server over every event, and MUST NOT be derived from the rows the timeline loaded

#### Scenario: Denials and failures are distinct segments

- **WHEN** a source has denied or failed events
- **THEN** its bar MUST show them as segments distinct from its successes, and MUST NOT fold them into a single total

#### Scenario: Every bar states its count

- **WHEN** the summary is rendered
- **THEN** each source's total MUST be stated as text, so a small source remains readable beside a large one

#### Scenario: An empty log shows no chart

- **WHEN** the log holds no events
- **THEN** the summary MUST NOT render an empty chart, and the timeline's existing empty state explains the absence

#### Scenario: A failed summary does not take the timeline with it

- **WHEN** the summary request fails and the timeline request succeeds
- **THEN** the summary panel MUST state the error and the timeline MUST still render

### Requirement: The outcome summary filters the timeline

Selecting a source and outcome in the summary SHALL filter the timeline to those events, with the filter held in the URL and applied by the server.

#### Scenario: Selecting a segment filters on the server

- **WHEN** the operator selects the denied segment of the `privy` bar
- **THEN** the URL MUST carry `source=privy` and `status=denied`, and the timeline MUST be re-read from the server with that filter rather than filtered from rows already loaded

#### Scenario: A filtered URL reproduces the view

- **WHEN** a URL carrying a source and status filter is opened in a fresh session
- **THEN** the page MUST render the same filtered timeline

#### Scenario: The summary keeps its context under a filter

- **WHEN** a filter is active
- **THEN** the summary MUST still show every source with events, with the selected segment distinguished and the others de-emphasised

#### Scenario: Every filter is reachable from the keyboard

- **WHEN** the operator uses only the keyboard
- **THEN** every source and status filter the chart can set MUST also be settable through focusable controls outside the chart

#### Scenario: The filter can be cleared

- **WHEN** the operator clears the filter, or selects the already-selected segment
- **THEN** the filter parameters MUST be removed from the URL and the unfiltered timeline MUST render

#### Scenario: The active filter is stated

- **WHEN** a filter is active
- **THEN** the timeline MUST name the filter, and its loaded count MUST be described as a count of filtered events, not of the whole log

#### Scenario: A filter that matches nothing explains itself

- **WHEN** a filter matches no events
- **THEN** the timeline MUST state that no events match that filter, distinct from the state in which the log is empty

#### Scenario: An unrecognised filter value is not claimed

- **WHEN** the URL carries a source or status outside the permitted sets
- **THEN** the page MUST render the unfiltered timeline and MUST NOT present the unrecognised value as an active filter
