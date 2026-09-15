#!/usr/bin/env node
/**
 * pack-release.mjs — 发布打包：外壳**自包含**（vendor 大脑核心进包）。
 *
 * 动机（2026-09-15 三层故障根治）：此前把本地依赖 architect-core 重写为同仓
 * release URL——URL 形态的「子依赖」被 pnpm 12 默认供应链防护
 * blockExoticSubdeps 拦截（顶层 URL 放行、子依赖一律拒绝），消费方 profile
 * 必须关闭防护才能安装；弱网+镜像链路下曾连环失败（2026-09-15 事故）。
 *
 * 根治：打包时把 architect-core 的构建产物 **vendor 进外壳 tarball**
 * （core/**），lib 内引用重写为包内相对路径，并从依赖声明移除——
 * 外壳 tarball 自包含，blockExoticSubdeps 防护回归完整。
 *
 * 取舍：核心不再经 URL 独立热更新——核心变更需重发外壳版本
 * （architect-core-latest.tgz 资产仍照常发布，供独立消费与追溯）。
 * 重写用 Node JSON.parse/stringify，严禁 PowerShell ConvertTo-Json
 * （exports 伪键事故，2026-09-11）。
 *
 * 用法：node scripts/pack-release.mjs --out <dir>
 * 产物：<out>/dsh-architect-latest.tgz（自包含、无 URL/file 子依赖）
 *
 * @module scripts/pack-release
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, relative, resolve } from 'node:path'

const OUT_NAME = 'dsh-architect-latest.tgz'
// core lib 双路径回退：CI=仓库内 symlink（release.yml Link 步骤）；本地=父仓 packages/
const CORE_LIB_CANDIDATES = ['packages/architect-core/lib', '../packages/architect-core/lib']
const CORE_LIB = CORE_LIB_CANDIDATES.map((p) => resolve(p)).find((p) => existsSync(p))

const argv = process.argv.slice(2)
const outIdx = argv.indexOf('--out')
const outDir = outIdx >= 0 ? argv[outIdx + 1] : 'dist'
if (!outDir) throw new Error('用法：node scripts/pack-release.mjs --out <dir>')

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const stage = mkdtempSync(join(tmpdir(), 'pack-release-'))

try {
  // npm pack（按 files 白名单）→ 解包到 staging（脚本约定从仓库根调用；Windows 须 shell 调 npm.cmd）
  const tgz = execFileSync('npm', ['pack', '--pack-destination', stage, '--ignore-scripts'],
    { encoding: 'utf8', cwd: process.cwd(), shell: process.platform === 'win32' })
    .trim().split(/\r?\n/).pop()
  const tgzPath = join(stage, tgz)
  execFileSync('tar', ['-xzf', tgzPath, '-C', stage])

  // ── vendor：核心构建产物进包（core/**）──
  if (!existsSync(CORE_LIB)) throw new Error(`${CORE_LIB} 缺失——先构建核心（npm --prefix packages/architect-core run build）`)
  cpSync(CORE_LIB, join(stage, 'package', 'core'), { recursive: true })

  // 依赖声明：移除 architect-core（已 vendor=自包含）；其余 file:/link: 仍拒绝（兜底守卫）
  const manifestPath = join(stage, 'package', 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.dependencies) delete manifest.dependencies['architect-core']
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = manifest[field]
    if (!deps) continue
    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec === 'string' && (spec.startsWith('file:') || spec.startsWith('link:'))) {
        throw new Error(`未 vendor 的本地路径依赖：${field}["${name}"] = ${spec}（仅 architect-core 已 vendor；其余请登记处理）`)
      }
    }
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

  // 引用重写：lib 内所有 .js/.d.ts 的 'architect-core' → 包内相对路径
  //（lib 根文件 → ./core/index.js；lib/types/* → ../../core/index.js，按文件深度计算）
  const rewriteImports = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { rewriteImports(full); continue }
      if (!entry.name.endsWith('.js') && !entry.name.endsWith('.d.ts')) continue
      const text = readFileSync(full, 'utf8')
      if (!text.includes("'architect-core'") && !text.includes('"architect-core"')) continue
      const rel = relative(dirname(full), join(stage, 'package', 'core', 'index.js')).split('\\').join('/')
      const spec = rel.startsWith('.') ? rel : './' + rel
      const next = text.replaceAll("'architect-core'", `'${spec}'`).replaceAll('"architect-core"', `"${spec}"`)
      writeFileSync(full, next, 'utf8')
    }
  }
  rewriteImports(join(stage, 'package', 'lib'))

  // 结构自检（与 check-publish 同口径，打包即验证）
  const keys = Object.keys(manifest.exports ?? {})
  if (keys.some((k) => k.startsWith('.')) && keys.some((k) => !k.startsWith('.'))) {
    throw new Error(`exports 混合键：${keys.join(', ')}`)
  }
  if (!existsSync(join(stage, 'package', 'lib', 'index.js'))) throw new Error('lib/index.js 缺失——先 npm run build')

  // 重打包为稳定资产名（先确保输出目录存在——tar 不建父目录）
  mkdirSync(outDir, { recursive: true })
  execFileSync('tar', ['-czf', join(outDir, OUT_NAME), '-C', stage, 'package'])
  console.log(`[pack-release] ${OUT_NAME} 就绪（vendor 模式：core 已进包、依赖已自包含；exports 键 ${keys.length} 个）`)
} finally {
  rmSync(stage, { recursive: true, force: true })
}
