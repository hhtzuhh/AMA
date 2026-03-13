/**
 * Central API/WebSocket URL config.
 *
 * Development: auto-derives from the current page hostname so both
 *   localhost (desktop) and 192.168.x.x (phone on same WiFi) work.
 * Production (GCP): set VITE_API_URL=https://your-backend.run.app at build time.
 *
 * WebSocket URL is derived automatically:
 *   http://...  →  ws://...
 *   https://... →  wss://...
 */
const _envUrl = import.meta.env.VITE_API_URL as string | undefined

// In dev, backend always runs on port 8000 on the same machine as the frontend.
// Using window.location.hostname means it works whether you're on localhost OR
// accessing via 192.168.x.x from a phone on the same network.
// Mirror the page protocol — avoids mixed-content blocking when on https://
const _proto = window.location.protocol   // 'http:' or 'https:'
const _host  = window.location.hostname   // 'localhost' or '192.168.x.x'

export const API_URL: string =
  _envUrl ?? `${_proto}//${_host}:8000`

export const WS_URL: string = API_URL.replace(/^http/, 'ws')
