## MODIFIED Requirements

### Requirement: One component system backs every console surface

The console SHALL be built from `@astryxdesign/core` components. No component source SHALL be copied in from the Markdown Graphs shadcn registry, which supplies the visual target only. Where the design system ships a component or hook for a behaviour the console needs — code display, clipboard copy, scroll-overflow detection, pagination — that component or hook SHALL be used rather than a hand-written equivalent.

#### Scenario: Interactive data uses Astryx

- **WHEN** a screen renders a table, list, or metric
- **THEN** it MUST use the corresponding Astryx component rather than a hand-written element or a registry copy

#### Scenario: The registry is not a dependency

- **WHEN** the dependency set is inspected
- **THEN** it MUST contain no package or copied source originating from the Markdown Graphs registry

#### Scenario: Code display and copy come from the design system

- **WHEN** the console renders a code or JSON payload, or offers a copy-to-clipboard affordance
- **THEN** it MUST use the design system's code-display component and clipboard hook, and MUST NOT hand-roll a `<pre>` block or a clipboard write

## ADDED Requirements

### Requirement: Scroll affordances are concealed without disabling scrolling

A console scroll container SHALL NOT paint a scrollbar on its right or bottom edge. Concealment SHALL remove the affordance only — scrolling by wheel, trackpad, keyboard, and programmatic scroll SHALL be unaffected.

#### Scenario: The bar is gone and the scrolling is not

- **WHEN** a console scroll container overflows
- **THEN** no scrollbar MUST be painted on its right or bottom edge, and the container MUST still scroll by wheel, trackpad, and keyboard

#### Scenario: Concealment is not truncation

- **WHEN** the console's styles are inspected
- **THEN** concealment MUST be achieved by suppressing the scrollbar affordance, and MUST NOT set `overflow: hidden` on a container whose content overflows

#### Scenario: Every engine is covered

- **WHEN** the concealment utility is inspected
- **THEN** it MUST cover both the standard scrollbar-width property and the vendor scrollbar pseudo-element, so no supported engine paints a bar

### Requirement: A concealed scroll container stays keyboard-reachable and signals its overflow

Removing the scrollbar removes both a keyboard target and the only indication that content continues. A container with concealed scrollbars that can scroll SHALL restore both.

#### Scenario: Keyboard access survives concealment

- **WHEN** a container with concealed scrollbars can scroll
- **THEN** it MUST be focusable and carry an accessible name, so it can be scrolled with the keyboard alone

#### Scenario: Overflow remains visible as a state

- **WHEN** content extends past a concealed container's edge
- **THEN** that edge MUST carry a token-backed visual signal that content continues, and that signal MUST clear when the edge is reached

### Requirement: State changes are animated with a readable resting state

Rows entering a list and transitions between console screens SHALL be animated. Every such animation SHALL have the readable state as its resting state, and SHALL be suppressed under `prefers-reduced-motion`.

#### Scenario: Rows entering a list animate

- **WHEN** rows are appended to a rendered list
- **THEN** the arriving rows MUST animate in, staggered, while the rows already on screen MUST NOT re-animate

#### Scenario: Screen transitions do not cut

- **WHEN** the operator navigates between console screens
- **THEN** the outgoing and incoming content MUST cross-fade rather than swap instantly

#### Scenario: Content is readable when no animation runs

- **WHEN** an animation never runs — the document is prerendered, JavaScript never executes, or the tab is backgrounded
- **THEN** the animated content MUST be fully visible and correctly positioned

#### Scenario: Reduced motion is honoured

- **WHEN** the operator has requested reduced motion
- **THEN** every animation added by this capability MUST be disabled, and the content MUST render in its resting state

#### Scenario: Stagger is bounded

- **WHEN** a full window of rows animates in
- **THEN** the total stagger MUST be bounded so the last row's entrance is not perceived as a wait, and each arriving batch MUST begin its stagger from the start rather than continuing the previous batch's offset

#### Scenario: Animations define no colour or literal value

- **WHEN** the animation and concealment utilities are inspected
- **THEN** every value MUST resolve to a theme token or a token-backed utility, with no literal colour, and no `style={{…}}` in a component
