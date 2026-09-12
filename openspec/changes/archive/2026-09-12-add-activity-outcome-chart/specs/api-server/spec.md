## ADDED Requirements

### Requirement: Activity is summarised over the whole log

The API SHALL serve the count of activity events grouped by source and status, computed over every event in the organization rather than over a page of events.

#### Scenario: Counts are grouped by source and status

- **WHEN** `GET /v1/activity/summary` is requested
- **THEN** the response MUST carry, for each source that has events, its count of pending, success, denied, and failed events, and a total equal to their sum

#### Scenario: The summary is not bounded by the timeline's page limit

- **WHEN** the log holds more events than the maximum `limit` `GET /v1/activity` accepts
- **THEN** the summary's overall total MUST still equal the number of events in the log

#### Scenario: Denied and failed counts are reported, not filtered

- **WHEN** a source has denied or failed events
- **THEN** those counts MUST appear in the summary alongside its successes

#### Scenario: The summary carries its read time

- **WHEN** the summary is served
- **THEN** it MUST include the time it was read

#### Scenario: The summary route is part of the typed client

- **WHEN** the web application calls the summary
- **THEN** it MUST do so through the client derived from `AppType`, so that removing or renaming the route fails `pnpm typecheck`
