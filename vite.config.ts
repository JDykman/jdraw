import react from '@vitejs/plugin-react-swc'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import { zodLocalePlugin } from './scripts/vite-zod-locale-plugin.js'

export default defineConfig(() => {
	return {
		plugins: [
			zodLocalePlugin(fileURLToPath(new URL('./scripts/zod-locales-shim.js', import.meta.url))),
			react(),
		],
		define: {
			'licenseState === "expired" || licenseState === "unlicensed-production"': 'false',
			'shouldHideEditorAfterDelay(licenseState)': 'false',
		},
		server: {
			proxy: {
				'/api': 'http://localhost:3001',
				'/stream': 'http://localhost:3001',
				'/ws': { target: 'ws://localhost:3001', ws: true },
			},
		},
	}
})
