# Bishnoi One home page: copy and paste

The whole home page is in two files, plus its images. Needs React 18.

| File | What it is |
| --- | --- |
| `HomePage.jsx` | Every section, the navbar, the footer and all their text and data |
| `HomePage.css` | All the styles, including colors, buttons and animations |
| `images/` | The 21 images the page uses |

## Steps

1. Put `HomePage.jsx` and `HomePage.css` in the same folder of the other site,
   for example `src/pages/`.
2. Copy everything in `images/` into the other site's `public/` folder, so each image
   loads from the site root (`/CRM.png`). Keep the exact filenames, capitals
   included (`image.JPG`).
3. Paste the fonts into the other site's `index.html` `<head>`:

   ```html
   <link rel="preconnect" href="https://fonts.googleapis.com" />
   <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
   <link
     href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800;900&family=Inter:wght@400;500;600;700&family=Poppins:wght@400;500;600&display=swap"
     rel="stylesheet"
   />
   ```

4. Show the page:

   ```jsx
   import HomePage, { Navbar, Footer } from './pages/HomePage.jsx'

   <Navbar />            {/* optional: skip if the site has its own */}
   <main id="main">
     <HomePage />
   </main>
   <Footer />            {/* optional */}
   ```

## Images used

| Image | Where |
| --- | --- |
| `bishnoi-logo.png` | Logo (navbar, footer) and several sections |
| `Inventory.png`, `People.png`, `CRM.png`, `Analytics.png`, `Books.png`, `Finance.png`, `WorkDrive.png`, `desk.png` | The eight system icons, used throughout |
| `MAMMALOU.png`, `MAMVAN.png`, `SIRJAVED.png`, `SIRSUBIR.png` | Team faces in the hero headline |
| `maamdebbie.png`, `sirsumit.png`, `office.jpg`, `office2.jpg` | People section |
| `howwework.jpg` | Quote band and approvals section |
| `tablelaptop.png` | Approvals section |
| `image.JPG` | Words split section |
| `addone-menu.jpg` | Promo image in the navbar Products menu |

## Things to check after the move

- **Global styles.** The top of `HomePage.css` sets page-wide rules (`body`,
  headings, links, `.btn`, `.shell`), which can change how the other site's pages look.
- **Links to other pages.** In-page links (`#cta`, `#systems`, `#how`, `#showcase`)
  keep working. Links to this site's other pages (`#/pricing`, `#/about`,
  `#/platform/...`, `#/systems/...`) need pointing at the other site's pages; search
  `HomePage.jsx` for `#/`.
- **Search bar.** The navbar search box is visual only; it is not connected to any
  search yet.
