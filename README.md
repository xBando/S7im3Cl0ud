# $7im3Cl0ud — website prototype

## Run it
Open `index.html` in a modern desktop or mobile browser. For best results, serve this folder with any static web server.

## Included
- Responsive SoundCloud-inspired dark interface and lime identity
- Custom vector snake/equalizer logo
- Track list, search, player controls, seek and volume
- Heart/like and repost interactions
- Upload local audio files and opt into downloads
- Download button appears only when the uploader enabled it

## Important prototype limits
This is a front-end prototype. Uploads use browser-local object URLs and are not sent to a server or shared across devices. Demo sample URLs may be unavailable depending on network access. The app does not yet provide accounts, a global public catalog, persistent cloud storage, moderation, copyright/DMCA handling, transcoding, CDN delivery, or production analytics.

To launch worldwide, connect this UI to a backend (for example: authentication + database + object storage + transcoding/CDN), implement creator-controlled download permissions server-side, and establish rights, takedown, abuse-reporting, and privacy workflows. Do not scrape or rehost other platforms' catalogs; ingest only music the uploader owns or is authorized to distribute.

The visual language is inspired by common music-streaming patterns but is not an exact copy of SoundCloud's proprietary interface or branding.
Production redeploy test
