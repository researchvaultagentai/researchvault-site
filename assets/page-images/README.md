# Initial-page artwork

These WebP assets encode the existing `assets/*.png` artwork at its original
dimensions, with quality 82. They change delivery format, not composition.
Original PNG files remain available.

`scripts/render-static-pages.mjs` embeds the critical logo/banner/hero as data
URLs. They render even if separate image downloads fail, without JavaScript.
The manifest checks both source and encoded hashes and rejects truncated WebP.
Only complete public pages are generated; agreement fragments are excluded.

To update after changing an original PNG:

```sh
npm install --no-save --package-lock=false sharp@0.35.5
node scripts/encode-page-images.cjs
node scripts/render-static-pages.mjs
node scripts/render-static-pages.mjs --check
```

Browser CI blocks all network image requests and verifies that the embedded
artwork decodes on mobile and desktop in Persian and Iranian English pages,
with JavaScript both enabled and disabled.
