# Figure library

Interactive models the tutor can put on the board with `@figure name=<folder>`.
Each folder holds a self-contained `index.html` and a `figure.json` with
`name`, `title`, `description` (the tutor reads this to decide when to use
it), `tags`, `source` and a display `height`.

Figures are built with the Anatomy skill (https://github.com/wheresryan22/anatomy)
in Claude Code: `/anatomy <what to show>`, then import the built page:

    pnpm figures:import path/to/figure-light.html my-figure "Title" "Description"

Copy the rest of the shipped Anatomy examples in with:

    npx skills add wheresryan22/anatomy -g -a claude-code
    pnpm figures:seed

The two figures here are Anatomy examples (MIT) so the library is never empty.
