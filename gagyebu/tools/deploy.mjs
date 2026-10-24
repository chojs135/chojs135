// node tools/deploy.mjs — 화면을 빌드해서 구글 시트에 연결된 앱스 스크립트로 올리고 웹 앱으로 배포한다.
// 처음 실행하면 "우리집 가계부" 시트에 스크립트를 새로 붙이고, 이후에는 같은 주소로 업데이트한다.
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHEET_ID = process.env.GAGYEBU_SHEET_ID ?? '1PTb4_1YVu94UzckbFCbVBlmivFdBcl-JIlPIRYWLsDc'
const claspJson = path.join(root, '.clasp.json')
const deploymentFile = path.join(root, '.deployment.json')
const manifest = path.join(root, 'gas', 'appsscript.json')

function run(cmd) {
  console.log(`\n> ${cmd}`)
  return execSync(cmd, { cwd: root, stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8', shell: true })
}

// 1. 시트에 스크립트 프로젝트 붙이기 (처음 한 번)
if (!fs.existsSync(claspJson)) {
  console.log('▶ 구글 시트에 앱스 스크립트를 연결합니다.')
  // clasp create는 원격의 기본 설정 파일을 내려받아 덮어쓰므로 우리 설정을 보관했다가 되돌린다.
  const keep = fs.readFileSync(manifest, 'utf8')
  const out = run(`npx clasp create --type sheets --parentId ${SHEET_ID} --title "우리집 가계부" --rootDir gas`)
  console.log(out)
  fs.writeFileSync(manifest, keep)
  for (const f of ['Code.gs', 'Code.js'].map((n) => path.join(root, 'gas', n))) {
    // 새 프로젝트의 빈 Code.gs가 내려오면 지운다(우리 코드는 Code.js).
    if (f.endsWith('.gs') && fs.existsSync(f)) fs.rmSync(f)
  }
}

// 2. 화면 빌드 → gas/Index.html
console.log('▶ 화면을 빌드합니다.')
run('npm --prefix client run build')
fs.copyFileSync(path.join(root, 'client', 'dist', 'index.html'), path.join(root, 'gas', 'Index.html'))

// 3. 코드 올리기
console.log('▶ 코드를 올립니다.')
console.log(run('npx clasp push -f'))

// 4. 웹 앱 배포 (주소가 바뀌지 않도록 같은 배포를 갱신)
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
let deploymentId = fs.existsSync(deploymentFile) ? JSON.parse(fs.readFileSync(deploymentFile, 'utf8')).deploymentId : null
if (deploymentId) {
  console.log(run(`npx clasp deploy -i ${deploymentId} -d "업데이트 ${stamp}"`))
} else {
  const out = run(`npx clasp deploy -d "첫 배포 ${stamp}"`)
  console.log(out)
  deploymentId = out.match(/AKfyc[\w-]+/)?.[0]
  if (!deploymentId) throw new Error('배포 ID를 찾지 못했어요. 위 출력을 확인해 주세요.')
  fs.writeFileSync(deploymentFile, JSON.stringify({ deploymentId }, null, 2))
}

const url = `https://script.google.com/macros/s/${deploymentId}/exec`
console.log('\n✅ 완료! 가계부 주소:\n')
console.log(`   ${url}\n`)
console.log('이 주소를 휴대폰·학교 PC 브라우저에서 열고, 즐겨찾기나 홈 화면에 추가해 두세요.')
