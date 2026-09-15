#!/usr/bin/env node
/**
 * materialize-core.mjs — 把 architect-core 物化为 node_modules 真实拷贝（弃 junction）。
 *
 * 动机：npm 对 file: 依赖在 Windows 落成**绝对路径 junction**——同一工作树挂进 Linux 容器
 * 后链接悬空（ERR_MODULE_NOT_FOUND），见 practice/node-modules-symlink-cross-host.md
 * （已确认）。CI 同款做法（dsh-architect 8ff370f 先例：rm + cp lib + cp package.json）。
 *
 * 用法：
 *   node scripts/materialize-core.mjs          # 物化（build 末尾自动执行）
 *   node scripts/materialize-core.mjs --check  # 新鲜度断言：副本与源不一致即非零退出（构建期守护）
 *
 * 副本头注「构建生成、勿手改」（.materialized-core.json stamp）。
 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const shellRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const coreSrc = join(shellRoot, '..', 'packages', 'architect-core')
const dst = join(shellRoot, 'node_modules', 'architect-core')
const stampPath = join(dst, '.materialized-core.json')

/** 源指纹：package.json 版本 + lib/ 全文件（路径+大小+内容哈希）。 */
function sourceFingerprint() {
  const pkg = JSON.parse(readFileSync(join(coreSrc, 'package.json'), 'utf8'))
  const h = createHash('sha256')
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else { h.update(p); h.update(String(st.size)); h.update(readFileSync(p)) }
    }
  }
  walk(join(coreSrc, 'lib'))
  return { coreVersion: pkg.version, libHash: h.digest('hex') }
}

function current() {
  const fp = sourceFingerprint()
  return { ...fp, materializedAt: new Date().toISOString(), note: '构建生成，勿手改（scripts/materialize-core.mjs）' }
}

function assertFresh() {
  const fp = sourceFingerprint()
  if (!existsSync(stampPath)) { console.error('✗ 无物化戳（node_modules/architect-core 非物化拷贝或缺失）'); process.exit(1) }
  const stamp = JSON.parse(readFileSync(stampPath, 'utf8'))
  if (stamp.coreVersion !== fp.coreVersion || stamp.libHash !== fp.libHash) {
    console.error('✗ 物化副本与源不一致（coreVersion/libHash 漂移）——重跑 npm run build 重建')
    process.exit(1)
  }
  console.log(`✓ 物化副本新鲜（core@${fp.coreVersion}，libHash 一致）`)
}

if (process.argv.includes('--check')) { assertFresh(); process.exit(0) }

if (!existsSync(join(coreSrc, 'lib'))) { console.error('✗ core 未构建：先 npm --prefix ../packages/architect-core run build'); process.exit(1) }

// 安全移除旧形态：junction/软链用 unlink（不随链接走入目标！）；真实目录才递归删
if (existsSync(dst) || (() => { try { return lstatSync(dst).isSymbolicLink() } catch { return false } })()) {
  const lst = lstatSync(dst)
  if (lst.isSymbolicLink()) unlinkSync(dst)
  else rmSync(dst, { recursive: true, force: true })
}
mkdirSync(dst, { recursive: true })
cpSync(join(coreSrc, 'lib'), join(dst, 'lib'), { recursive: true })
cpSync(join(coreSrc, 'package.json'), join(dst, 'package.json'))
writeFileSync(stampPath, JSON.stringify(current(), null, 2) + '\n')
console.log(`✓ architect-core 已物化为真实拷贝（${dst}）——junction 悬空路径在容器可解析`)
