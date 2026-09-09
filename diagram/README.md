# diagram/

Each diagram is a committed pair: `<name>.excalidraw` (editable source) and
`<name>.png` (the render that READMEs and docs embed).

Generated with the `excalidraw-diagram` skill. Install steps, the render
command, and the two upstream fixes the skill needs are in the repo-root
`AGENTS.md` under "Diagrams".

## What is here

| Diagram | Argues |
|---|---|
| `architecture` | One name resolves, three authorities answer, and the store sits past a dashed boundary because it owns nothing anyone must trust. |
| `workflow` | Which service answers each endpoint, the fixed order of a write, and what each of the two signing keys may do. |
| `services` | All nine roles, method by method, read off the classes rather than the spec. |

Figures inside `docs/*.md` stay mermaid.
