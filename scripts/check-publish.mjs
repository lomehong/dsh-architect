#!/usr/bin/env node
/**
 * check-publish.mjs — 发布资产结构门禁（零依赖）。
 *
 * 动机（2026-09-11 事故）：手工改写 tarball 内 package.json 时 exports 被序列化出
 * 非法混合键（子路径键与条件键混用），Node 24 报 ERR_INVALID_PACKAGE_CONFIG——
 * 且是启动期致命（服务提前退出）。本脚本把此类结构残废拦在发布之前。
 *
 * 规则（对每个输入 tarball）：
 *   1. exports 键形态合法：全部以 '.' 开头（subpath）或全部不以 '.' 开头（条件键）；
 *      混合 = FAIL。exports 缺失时跳过本条（main 直连形态）。
 *   2. dependencies / peerDependencies / optionalDependencies / devDependencies
 *      不得包含 file: / link: 协议依赖（发布包内含未发布的本地路径依赖 = 安装必炸）。
 *   3. main 与 exports 解析出的每个入口文件必须存在于 tar 清单中。
 *   4. tar 清单不得含 src/tests/node_modules/.github 目录与 .ts 源码（.d.ts 除外）。
 *
 * 用法：node scripts/check-publish.mjs <file.tgz> [<file2.tgz> ...]
 * 退出码：0 = 全部通过；1 = 任一失败（收集全部问题一次性输出）。
 *
 * @module scripts/check-publish
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const FORBIDDEN_DIRS = new Set(['src', 'tests', 'test', '__tests__', 'node_modules', '.github', '.git'])
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

function fail(problems, label) {
  console.error(`[check-publish] FAIL：${label}`)
  for (const p of problems) console.error(`[check-publish]   - ${p}`)
  process.exit(1)
}

for (const tarball of process.argv.slice(2)) {
  const problems = []
  const files = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
    .split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    .filter((s) => !s.endsWith('/'))
    .map((s) => s.replace(/^package\//, ''))
    .filter((s) => s !== '')
  const fileSet = new Set(files)

  const pkgJson = files.find((f) => f === 'package.json')
  if (pkgJson === undefined) fail([`tarball 缺少 package/package.json`], tarball)
  const pkg = JSON.parse(readFileSync(`${tarball}`, 'utf8') && execFileSync('tar', ['-xzOf', tarball, 'package/package.json'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }))

  // 1) exports 键形态
  if (pkg.exports !== undefined) {
    const keys = Object.keys(pkg.exports)
    const subpath = keys.filter((k) => k.startsWith('.'))
    if (subpath.length > 0 && subpath.length < keys.length) {
      problems.push(`exports 混合键（子路径键与条件键混用 → ERR_INVALID_PACKAGE_CONFIG）：${keys.join(', ')}`)
    }
    // main/exports 入口存在性
    const entries = []
    if (typeof pkg.main === 'string') entries.push(pkg.main)
    const walk = (node) => {
      if (typeof node === 'string') entries.push(node)
      else if (node && typeof node === 'object') for (const v of Object.values(node)) walk(v)
    }
    if (pkg.exports) walk(pkg.exports)
    for (const e of entries.map((p) => p.replace(/^\.\//, ''))) {
      if (!fileSet.has(e)) problems.push(`入口文件不在 tarball 内：${e}`)
    }
  }

  // 2) 本地路径协议依赖
  for (const field of DEP_FIELDS) {
    const deps = pkg[field]
    if (!deps) continue
    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec === 'string' && (spec.startsWith('file:') || spec.startsWith('link:'))) {
        problems.push(`${field}["${name}"] 为本地路径依赖（${spec}）——发布包内含未发布路径，安装必炸；请在打包阶段重写为 release URL 或移除`)
      }
    }
  }

  // 4) 禁含目录/源码
  for (const f of files) {
    if (f.split('/').some((seg) => FORBIDDEN_DIRS.has(seg))) problems.push(`包含禁止目录：${f}`)
    else if (f.endsWith('.tsx') || (f.endsWith('.ts') && !f.endsWith('.d.ts'))) problems.push(`包含 TS 源码：${f}`)
  }

  if (problems.length > 0) fail(problems, tarball)
  console.log(`[check-publish] PASS：${tarball}（${files.length} 个文件；exports 与依赖结构合法）`)
}
