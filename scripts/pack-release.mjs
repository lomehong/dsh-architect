#!/usr/bin/env node
/**
 * pack-release.mjs — 发布打包：npm pack 后把本地路径依赖重写为 release URL。
 *
 * 动机：dsh-architect 依赖大脑仓核心 `architect-core: file:../packages/architect-core`。
 * file: 依赖进入发布 tarball 后，安装方（pnpm/npm）按 tarball 相对路径解析必然失败。
 * 本脚本在 npm pack 之后、上传之前，把 tarball 内 package.json 的
 * `dependencies["architect-core"]` 重写为同 release 的稳定资产 URL：
 *
 *   https://github.com/lomehong/dsh-architect/releases/latest/download/architect-core-latest.tgz
 *
 * （releases/latest/download 永远指向最新 release 的同名资产——core 单独发版后，
 *   安装方重装即升级，外壳无需重发。）重写用 Node JSON.parse/stringify，
 * 严禁 PowerShell ConvertTo-Json（exports 伪键事故，2026-09-11）。
 *
 * 用法：node scripts/pack-release.mjs --out <dir>
 * 产物：<out>/dsh-architect-latest.tgz（dependencies 已重写、结构已自检）
 *
 * @module scripts/pack-release
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const CORE_URL = 'https://github.com/lomehong/dsh-architect/releases/latest/download/architect-core-latest.tgz'
const OUT_NAME = 'dsh-architect-latest.tgz'

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

  // 重写本地路径依赖 → release URL（Node 原生 JSON，禁 PS）
  const manifestPath = join(stage, 'package', 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  let rewritten = 0
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = manifest[field]
    if (!deps) continue
    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec === 'string' && (spec.startsWith('file:') || spec.startsWith('link:'))) {
        if (name === 'architect-core') { deps[name] = CORE_URL; rewritten++ }
        else throw new Error(`未配置重写规则的本地路径依赖：${field}["${name}"] = ${spec}（请在 pack-release.mjs 登记 URL）`)
      }
    }
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

  // 结构自检（与 check-publish 同口径，打包即验证）
  const keys = Object.keys(manifest.exports ?? {})
  if (keys.some((k) => k.startsWith('.')) && keys.some((k) => !k.startsWith('.'))) {
    throw new Error(`exports 混合键：${keys.join(', ')}`)
  }
  if (!existsSync(join(stage, 'package', 'lib', 'index.js'))) throw new Error('lib/index.js 缺失——先 npm run build')

  // 重打包为稳定资产名
  execFileSync('tar', ['-czf', join(outDir, OUT_NAME), '-C', stage, 'package'])
  console.log(`[pack-release] ${OUT_NAME} 就绪（重写 ${rewritten} 个本地依赖 → release URL；exports 键 ${keys.length} 个）`)
} finally {
  rmSync(stage, { recursive: true, force: true })
}
