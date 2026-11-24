# Whiteboard

A small, dependency-free Miro-style whiteboard. Plain HTML, CSS and JavaScript with no build step.

## Features
- Four shapes: square, rectangle, circle and triangle. Each has a 2px black stroke.
- Eight fill colours. Pick one before adding a shape, or select a shape and click a colour to recolour it.
- Drag shapes from the palette onto the canvas, or click a shape to drop it in the middle of the view.
- Drag the corner handles to resize. Squares and circles keep their proportions.
- Double-click a shape, or select it and start typing, to add text.
- Drag one of the blue dots around a selected shape onto another shape to connect them with an arrow. The arrow follows the shapes when you move them.
- **Canvas ×2** doubles the canvas in every direction, from 3,000 × 2,000 up to 192,000 × 128,000.
- Zoom with Ctrl/⌘ + scroll or the toolbar buttons. Drag the background to pan.
- Undo and redo, an autosave in the browser (localStorage), and JSON export and import.

## Run locally
Open `index.html` in a browser, or serve the folder:

    npx serve .

## Deploy on Netlify
1. Push this folder to a GitHub repository.
2. In Netlify, go to **Add new site → Import an existing project → GitHub** and pick the repository.
3. Leave the build command empty and set the publish directory to `.`. `netlify.toml` already sets both.
4. Deploy. Every push to the main branch redeploys the site automatically.
