# Card

The plain container. It has a surface fill, asymmetric corners (`radius-lg` and 8px) and the flat offset shadow `lift`.

- **Classes:** `.dr-card`, with `--flip` (mirrored corners, alternate on neighbouring cards) and `--raised` (nested, no shadow).
- **Interactive cards** are `<button>` or `<a>`: hover lifts 2px, focus shows the ring, and `is-selected` adds a 3px ink outline.
- **Not here:** the amoeba and kidney blob containers belong to the Stage only (see AtomicStage).
