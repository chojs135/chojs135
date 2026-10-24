import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// 구글 앱스 스크립트는 HTML 파일 하나만 제공할 수 있어서 JS/CSS를 모두 index.html 안에 넣는다.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  server: { proxy: { '/__gas': 'http://localhost:3002' } },
})
