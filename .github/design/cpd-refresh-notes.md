# Cypherpunk Policy Dinner: PGPZ staging refresh

Prepared September 11, 2026. Scope: `cpd.html`, its own stylesheet, and related assets. Production promotion remains a separate, user-reviewed action through the existing workflow.

## Positioning

PGPZ leads and convenes the event; Project Glitch remains a programming collaborator and source of cypherpunk perspective. The user supplied the keynote lineup and fireside format. The page presents privacy, self-custody, permissionless decentralized finance, and freedom to build as the event's themes; it does not attribute policy positions or endorsements to individual speakers.

Existing date, venue, times, $200 price, ZEC-only payment, ZCG anchor sponsorship, ZecTix event URL, and origin/source-checked iframe resize behavior are retained. No program end time, seat availability, or exact keynote/fireside start times were invented.

## PGPZ brand source

Board app's current released package: `pgpz-sites/output/pgpz-brand-package-symbol-as-z-v4/`, mapped by `pgpz-sites/apps/board/scripts/import-brand-library.ts`. Guidelines: `guidelines/PGPZ-Brand-Guidelines-Symbol-as-Z-v4.md`, Version 4, August 12, 2026.

- Exact supplied `logos/svg/master/pgpz-primary-on-dark.svg` and `graphics/svg/pgpz-circle-motif-on-dark.svg` copied into `images/cpd/brand/`.
- Inter Regular, Medium, Semibold, and Extrabold copied with the supplied OFL license into `fonts/cpd/`. Fonts are self-hosted.
- Evergreen #0D1F20 / paper #F6FAF2 dominate; ink #102827, slate #475569, teal #2F6F68; operating gold #F5A800 is used for accents and button backgrounds.
- Supplied logo composition/colors remain unmodified, with 256px display width. Official roundel is never detached or repeated. Composite logo links to https://z.cash/ as specified by the package; adjacent PGPZ text links to https://pgpz.org/.
- Footer preserves the package's independence statement.
- Current trademark reference checked: https://zfnd.org/zcash-trademark-policy/.

## Speaker photographs and titles

### Josh Swihart — CEO, ZODL

Current title source: https://zodl.com/zodl-raises-25m-in-seed-funding/.
Photo/source biography: https://consensus2026.coindesk.com/agenda/speaker/-josh-swihart.
Asset: https://d2pasa6bkzkrjd.cloudfront.net/site/consensus2026/images/userfiles/speakers/663f6f6df06508bba1b397a2b615dabf.jpg.
Saved as `images/cpd/josh-swihart.jpg`, 600×600. Conference speaker portrait; no explicit reusable license or required attribution found. The repository also had a lower-resolution 2026 portrait.

### Senator Bernie Moreno — U.S. Senator for Ohio

Title source: https://www.moreno.senate.gov/.
Photo source: https://commons.wikimedia.org/wiki/File:Sen._Bernie_Moreno_official_photo,_119th_Congress_(HR).jpg.
Asset: https://upload.wikimedia.org/wikipedia/commons/e/e0/Sen._Bernie_Moreno_official_photo%2C_119th_Congress_%28HR%29.jpg.
Saved as `images/cpd/bernie-moreno.jpg`, 2400×3000. Public-domain official U.S. Senate photograph by Rebecca Hammel / U.S. Senate Photographic Services.

### Julie Stitzel — Chief Policy Officer, DCG

Current title and photo: https://consensus2026.coindesk.com/agenda/speaker/-julie-stitzel.
Current title corroboration: https://www.salt.org/event-agendas/wyoming-2026?b1eff94b_page=2.
Asset: https://d2pasa6bkzkrjd.cloudfront.net/site/consensus2026/images/userfiles/speakers/ec96c2cb2812dc6629d0d0287f2ca0a9.jpg.
Saved as `images/cpd/julie-stitzel.jpg`, 600×600. Conference speaker portrait; no explicit reusable license or required attribution found. DCG's current website no longer exposes staff biographies; older VP/SVP titles found elsewhere are superseded by the 2026 biographies.

## Review notes

The original ZecTix embed returns 404 for localhost/unapproved or missing referrers; it returns 200 with the staging/production referrer. Keep the original event URL and verify checkout on the authorized staging hostname. Do not test by submitting a purchase.

Social preview is a browser-rendered HTML composition using the actual brand artwork and photographs. Its production-host Open Graph URL becomes available on production only when this reviewed release is promoted.

Local browser checks passed at 320, 375, 390, 640, 768, 900, 1024, and 1440px: no horizontal overflow, loaded speaker images, valid section anchors. Mobile menu, Escape dismissal, automatic close after navigation, speaker link, and ticket CTA passed. Desktop/mobile screenshots inspected. Supplied brand SVGs verified byte-for-byte; original checkout handler verified unchanged apart from whitespace. HTML/CSS formatting and JavaScript syntax passed.
