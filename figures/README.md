# Figure library

Interactive models built for lessons land here, one folder per model: a
self-contained `index.html` and a `figure.json` with `name`, `title`,
`description`, `tags`, `source` and a display `height`. The tutor never
picks one of these on its own; it builds the object a lesson needs (see
`@build_figure`), and the tutor server serves the result from this folder.

Figures are built with the Anatomy skill (https://github.com/wheresryan22/anatomy)
in Claude Code: `/anatomy <what to show>`, then import the built page:

    pnpm figures:import path/to/figure-light.html my-figure "Title" "Description"

Copy the rest of the shipped Anatomy examples in with:

    npx skills add wheresryan22/anatomy -g -a claude-code
    pnpm figures:seed

The two figures here are Anatomy examples (MIT) so the library is never empty.
