import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'

// mkcert certs live in AMA/ (one level up), shared with uvicorn
const certDir = path.resolve(__dirname, '..')
const certFile = path.join(certDir, 'localhost+1.pem')
const keyFile  = path.join(certDir, 'localhost+1-key.pem')
const hasCerts = fs.existsSync(certFile) && fs.existsSync(keyFile)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    ...(hasCerts ? {
      https: { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) },
    } : {}),
  },
})
