# Made Clear Studios – User Journey Builder

A lightweight, password-protected board for mapping user journeys. It's plain HTML, CSS and JavaScript, hosted on Netlify. It has no build step and no front-end dependencies.

## Features
- Four shapes: square, rectangle, circle and triangle. Each has a 2px black stroke and one of eight fill colours.
- Drag shapes from the palette onto the board, or click a shape to drop it in the middle of the view.
- Shapes snap to the edges and centres of nearby shapes, with pink guide lines, and to the dot grid. This applies when adding, moving and resizing. Hold **Alt** to place a shape freely.
- Resize from the corners. Squares and circles keep their proportions.
- Double-click a shape, or select it and start typing, to add text.
- Drag a blue dot from a selected shape onto another shape to connect them with an arrow.
- **Canvas ×2** doubles the board in every direction, up to 192,000 × 128,000.
- **Boards menu** on the left: create, open, rename (✎ or double-click) and delete boards.
- Boards autosave to Netlify Blobs, so everyone with the password sees the same boards.
- Undo and redo, and JSON export and import. An imported file becomes a new board.

## Password
The whole site, including the API, sits behind a password gate. The gate is a Netlify Edge Function: `netlify/edge-functions/auth.js`.

**The password is not stored in this repository.** Set it in Netlify:

1. Go to **Site configuration → Environment variables → Add a variable**.
2. Set the key to `SITE_PASSWORD` and the value to the password.
3. Go to **Deploys → Trigger deploy → Deploy site**. The gate reads the new value after a redeploy.

If `SITE_PASSWORD` isn't set, the site stays locked. Changing it signs everyone out. Sign-ins last 30 days. To sign out, use **Log out** in the top bar.

## Storage
Boards are saved through `netlify/functions/boards.mjs` into a Netlify Blobs store called `boards`. Saves are last-write-wins: if two people edit the same board at once, the most recent save overwrites the earlier one.

If you open `public/index.html` straight from disk, where there's no API, boards are saved only in that browser's localStorage.

## Deploy
Netlify deploys automatically from `main`. `netlify.toml` publishes the `public/` folder. Netlify installs `@netlify/blobs` from `package.json` for the boards function.
