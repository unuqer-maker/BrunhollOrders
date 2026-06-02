# Brunholl Orders

Browser-based order app for bar, kitchen, and reception tablets at Brunholl guesthouse.

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

## Device views

Use query params so each tablet opens the right screen:

| Device | URL |
|--------|-----|
| Bar / waiters | `/?view=bar` |
| Kitchen | `/?view=kitchen` |
| Reception | `/?view=reception` |

## Spec

See `BRUNHOLL_SPEC.md` in Downloads or project docs for layout, menu zones, and UX rules.

## Menu data

The source of truth is the Excel database:

- `src/menu.database.xlsx` (copy of `src/menu.json` if you exported from Excel)
- Run `npm run sync-menu` to regenerate `src/data/menu.json`
- `npm run build` runs sync automatically (`prebuild`)

The app loads **only** items from the generated JSON (no hardcoded Coffee/Tea/etc.). Structure:

**Category** (Food, Drink Menu, Dessert) → **Subcategory** (Pinsa, Draft Beer, …) → **Items**

Burger extras come from database rows with `applies_to: burger`.

## Stack

- React + Vite (single-page app)
- In-memory state for now; structured for future Firebase sync
