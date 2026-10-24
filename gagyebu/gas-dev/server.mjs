// 로컬 개발용: gas/Code.js를 흉내 시트 위에서 돌리고 /__gas 로 노출한다.
// 화면(npm run dev)은 google.script.run 대신 여기로 요청한다. 주소 뒤에 ?as=이메일 을 붙이면 그 사람으로 접속.
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGas } from './gas-mock.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const gas = createGas({ persistFile: process.env.GAS_DEV_DATA ?? path.join(here, '.data.json') })
const port = Number(process.env.PORT ?? 3002)
// GAS_DEV_AUTH_MISSING=1 이면 "시트 권한을 빼고 허용한" 사용자처럼 동작한다.
gas.authState.missing = process.env.GAS_DEV_AUTH_MISSING === '1'

http
  .createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/__gas') return res.writeHead(404).end()
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const { method, path: p, body, user } = JSON.parse(raw)
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(gas.callRaw(user || 'me@example.com', method, p, body))
    })
  })
  .listen(port, () => console.log(`Apps Script 흉내 서버: http://localhost:${port}/__gas`))
