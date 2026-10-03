# Zarr SQL Views

An experiment in visualizing Zarr data close to its array model with geographic layers that stack over time to form a 3D cube and SQL queries that filter the loaded data directly in the browser.

## Run

Requires Node.js 22.13 or newer.

```sh
npm install
cp .env.example .env.local
npm run dev
```

Set the dataset URLs in `.env.local` before starting Vite.

Open the local URL printed in your terminal.

To build and preview:

```sh
npm run build
npm run preview
```
