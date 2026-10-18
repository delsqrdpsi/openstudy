# Figure library

Interactive models built for lessons land here, one folder per model: a
self-contained `index.html` and a `figure.json` with `name`, `title`,
`description`, `tags`, `source` and a display `height`. The tutor never
picks one of these on its own; it builds the object a lesson needs (see
`@build_figure`), and the tutor server serves the result from this folder.

Everything here except this README is ignored by git: models are built on
the machine that runs OpenStudy and stay there. To let the tutor build them,
install the Anatomy skill once:

    pnpm setup:anatomy

You can also build one by hand in Claude Code (`/anatomy <what to show>`) and
add the page with:

    pnpm figures:import path/to/figure-light.html my-figure "Title" "Description"
