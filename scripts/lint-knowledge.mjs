#!/usr/bin/env node
/**
 * knowledge-lint CLI：对 architect-knowledge/ 知识库做结构校验（母包 P1-1）。
 *
 * 用法：node dsh-architect/scripts/lint-knowledge.mjs [知识库根目录]（默认 architect-knowledge）
 * 依赖：零 npm 依赖，node >= 22；需先在 dsh-architect 内 `npm run build`（本脚本 import ../lib/lint.js）。
 *
 * 职责边界：收集（fs）→ 受限格式解析（格式漂移 = R8 error，不猜测不跳过）→ 调 lintKnowledge 纯函数 →
 * 相对路径 ref 存在性核查（R7）→ 报告。exit 0 = pass；exit 1 = 有 error（Q1：error 阻断 CI）。
 *
 * @module @dsh-extra/dsh-architect/lint-cli
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lintIssue, lintKnowledge, relativePathCandidates } from '../lib/lint.js'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const KNOWLEDGE_DIRS = ['meta', 'principle', 'scenario', 'practice', 'reference']
const ENTRY_EXT_RE = /\.md$/i

const rootArg = process.argv[2] ?? 'architect-knowledge'
const root = resolve(process.cwd(), rootArg)

function fail(message) {
  console.error(`⛔ ${message}`)
  process.exit(1)
}

if (!existsSync(root) || !statSync(root).isDirectory()) {
  fail(`知识库根目录不存在：${root}`)
}

const errors = []

/** ── 条目 frontmatter 解析（受限格式：缩进 0 的 `key: value` + 单层嵌套 `key:` 下两空格 `sub: value`）── */
function parseEntry(content, relPath) {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/)
  if ((lines[0] ?? '').trim() !== '---') {
    errors.push(lintIssue('R8', relPath, 'frontmatter 缺失（首行非 ---）'))
    return null
  }
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] ?? '').trim() === '---') { end = i; break }
  }
  if (end < 0) {
    errors.push(lintIssue('R8', relPath, 'frontmatter 未闭合'))
    return null
  }
  const fields = {}
  let nestedKey = null
  for (let i = 1; i < end; i++) {
    const line = lines[i]
    if (line.trim() === '') continue
    const flat = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (flat) {
      nestedKey = flat[2].trim() === '' ? flat[1] : null
      if (nestedKey === null) fields[flat[1]] = flat[2].trim()
      continue
    }
    const nested = line.match(/^\s+([A-Za-z_][\w-]*):\s*(.*)$/)
    if (nested && nestedKey !== null) {
      fields[`${nestedKey}.${nested[1]}`] = nested[2].trim()
      continue
    }
    errors.push(lintIssue('R8', relPath, `无法解析的 frontmatter 行：${JSON.stringify(line)}`))
    return null
  }
  return fields
}

/** ── review-queue.yaml 解析：行组 `- file:` + 缩进续行（reason:/queued:）；其余内容行 = R8 ── */
function parseQueue(content) {
  const rows = []
  let inRow = false
  for (const raw of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    if (line.startsWith('- ')) {
      const m = line.match(/^-\s*file:\s*(.+)$/)
      if (m) { rows.push({ file: m[1].trim() }); inRow = true }
      else errors.push(lintIssue('R8', 'review-queue.yaml', `无法解析的行组首行：${JSON.stringify(raw)}`))
      continue
    }
    if (inRow && /^[\w-]+:\s*/.test(line)) continue // 行组缩进续行（reason/queued 等，P0 schema 附录 B）
    errors.push(lintIssue('R8', 'review-queue.yaml', `无法解析的行：${JSON.stringify(raw)}`))
  }
  return rows
}

/** ── index.md 解析：表格行 `| [file](file) | 定位 | 状态 |` ── */
function parseIndex(content, relPath) {
  const rows = []
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('|')) continue
    const m = line.match(/^\|\s*\[([^\]]+?)\]\([^)]*\)\s*\|/)
    if (!m) continue
    const cells = line.split('|').map(c => c.trim()).filter(c => c !== '')
    if (cells.length < 2) {
      errors.push(lintIssue('R8', relPath, `无法解析的索引行：${JSON.stringify(raw)}`))
      continue
    }
    rows.push({ file: m[1].trim(), status: cells[cells.length - 1] })
  }
  return rows
}

/** ── 收集 ── */
const entries = []
for (const dir of KNOWLEDGE_DIRS) {
  const dirPath = join(root, dir)
  if (!existsSync(dirPath)) {
    errors.push(lintIssue('R8', dir, `目录缺失：${dir}/`))
    continue
  }
  for (const name of readdirSync(dirPath)) {
    if (!ENTRY_EXT_RE.test(name) || name === 'index.md') continue
    const abs = join(dirPath, name)
    const rel = `${dir}/${name}`
    const content = readFileSync(abs, 'utf8')
    const fields = parseEntry(content, rel)
    if (fields !== null) entries.push({ path: rel, fields, body: content })
  }
}

const queuePath = join(root, 'review-queue.yaml')
const reviewQueue = existsSync(queuePath) ? parseQueue(readFileSync(queuePath, 'utf8')) : []

const indexes = []
for (const dir of KNOWLEDGE_DIRS) {
  const idxPath = join(root, dir, 'index.md')
  if (!existsSync(idxPath)) continue
  indexes.push({ dir, rows: parseIndex(readFileSync(idxPath, 'utf8'), `${dir}/index.md`) })
}

/** ── R7 存在性核查：候选相对【知识库根 / 仓库根 / 条目所在目录】三个基准解析 ── */
const parentOfRoot = dirname(root)
function refExists(entryPath, ref) {
  const candidates = relativePathCandidates(ref)
  if (candidates.length === 0) return undefined
  const entryDir = join(root, dirname(entryPath))
  const bases = [root, parentOfRoot, entryDir]
  for (const c of candidates) {
    if (isAbsolute(c) && !existsSync(c)) return false
    if (isAbsolute(c)) continue
    const hit = bases.some(base => existsSync(resolve(base, c)))
    if (!hit) return false
  }
  return true
}

const result = lintKnowledge({ entries, reviewQueue, indexes }, { refExists })
for (const e of errors) result.errors.push(e)
result.pass = result.errors.length === 0

/** ── 报告 ── */
const s = result.stats
console.log(`knowledge-lint｜root=${root}`)
console.log(`条目 ${s.entries}（已确认 ${s.confirmed} / 待审核 ${s.pending}）｜错误 ${result.errors.length}｜警告 ${result.warnings.length}`)
for (const i of result.errors) console.log(`  ⛔ [${i.rule}] ${i.path}：${i.message}`)
for (const w of result.warnings) console.log(`  ⚠️  [${w.rule}] ${w.path}：${w.message}`)
console.log(result.pass ? '✅ PASS' : '⛔ FAIL（error 阻断 CI——主人 2026-09-10 拍板 Q1）')
process.exit(result.pass ? 0 : 1)
