# Project structure

The project keeps the browser application, server implementation, operational scripts, tests, data, and design assets separate:

```text
public/       Browser pages, styles, client modules, and the generated music worker
server/       Node HTTP server and server-only services
scripts/      Data checks, admin launcher, and music-worker build entry
tests/        Node test suite
data/         Persistent navigation data and local music files
assets/       Images, icons, textures, and other design assets
docs/         Project documentation and screenshots
```

The server still exposes the same public URLs. Static browser files are resolved from `public/`, while `/assets/...` continues to resolve from the top-level `assets/` directory. Keep new browser-served files in `public/` and new server-only modules in `server/`.
