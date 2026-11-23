import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

// `npm run dev:phone` sets GT_HTTPS=1: the dev server then uses a self-signed certificate and
// listens on the local network, because phone browsers only allow the microphone on HTTPS
// (localhost is the one exception, and a phone is not localhost). Normal dev and builds are unchanged.
const https = process.env.GT_HTTPS === '1';

export default defineConfig({
  plugins: https ? [basicSsl()] : [],
  server: https ? { host: true } : {},
  build: {
    target: 'es2022',
  },
});
