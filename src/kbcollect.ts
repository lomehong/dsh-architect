/**
 * 知识库快照采集（R1~R9 校验的唯一采集实现；CLI 与两宿主工具共用）。
 *
 * 分层纪律（与 lint.ts 同构）：**采集（本模块，允许 fs）→ 校验（lintKnowledge，纯函数）→ 报告（调用方）**。
 * 本模块只读不写、绝不抛错：解析类问题以 R8 issue 形式返回，供调用方与原 result.errors 合并。
 *
 * @module @dsh-extra/dsh-architect/kbcollect
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { type KnowledgeSnapshot, lintIssue, lintKnowledge, relativePathCandidates, type LintIssue, type LintEntry, type LintIndex, type LintQueueRow, type LintResult } from './lint.ts'

export const KNOWLEDGE_DIRS = ['meta', 'principle', 'scenario', 'practice', 'reference'] as const
const ENTRY_EXT_RE = /\.md$/i

export interface CollectResult {
  root: string
  snapshot: KnowledgeSnapshot
  /** 采集/解析类问题（R8），调用方需合并进 errors（非空即不应 pass）。 */
  issues: LintIssue[]
}

/** ── 条目 frontmatter 解析（受限格式：缩进 0 的 `key: value` + 单层嵌套 `key:` 下两空格 `sub: value`）── */
export function parseEntry(content: string, relPath: string, issues: LintIssue[]): Record<string, string> | null {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/)
  if ((lines[0] ?? '').trim() !== '---') {
    issues.push(lintIssue('R8', relPath, 'frontmatter 缺失（首行非 ---）'))
    return null
  }
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] ?? '').trim() === '---') { end = i; break }
  }
  if (end < 0) {
    issues.push(lintIssue('R8', relPath, 'frontmatter 未闭合'))
    return null
  }
  const fields: Record<string, string> = {}
  let nestedKey: string | null = null
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
    issues.push(lintIssue('R8', relPath, `无法解析的 frontmatter 行：${JSON.stringify(line)}`))
    return null
  }
  return fields
}

/** ── review-queue.yaml 解析：行组 `- file:` + 缩进续行；其余内容行 = R8 ── */
export function parseQueue(content: string, issues: LintIssue[]): LintQueueRow[] {
  const rows: LintQueueRow[] = []
  let inRow = false
  for (const raw of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    if (line.startsWith('- ')) {
      const m = line.match(/^-\s*file:\s*(.+)$/)
      if (m) { rows.push({ file: m[1].trim() }); inRow = true }
      else issues.push(lintIssue('R8', 'review-queue.yaml', `无法解析的行组首行：${JSON.stringify(raw)}`))
      continue
    }
    if (inRow && /^[\w-]+:\s*/.test(line)) continue
    issues.push(lintIssue('R8', 'review-queue.yaml', `无法解析的行：${JSON.stringify(raw)}`))
  }
  return rows
}

/** ── index.md 解析：表格行 `| [file](file) | 定位 | 状态 |` ── */
export function parseIndex(content: string, relPath: string, issues: LintIssue[]): LintIndex['rows'] {
  const rows: LintIndex['rows'] = []
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('|')) continue
    const m = line.match(/^\|\s*\[([^\]]+?)\]\([^)]*\)\s*\|/)
    if (!m) continue
    const cells = line.split('|').map(c => c.trim()).filter(c => c !== '')
    if (cells.length < 2) {
      issues.push(lintIssue('R8', relPath, `无法解析的索引行：${JSON.stringify(raw)}`))
      continue
    }
    rows.push({ file: m[1].trim(), status: cells[cells.length - 1] })
  }
  return rows
}

/** 采集知识库快照（root 为绝对或相对路径；相对路径按 cwd 解析）。 */
export function collectKnowledgeSnapshot(rootArg: string, cwd = process.cwd()): CollectResult {
  const root = resolve(cwd, rootArg)
  const issues: LintIssue[] = []
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    issues.push(lintIssue('R8', rootArg, `知识库根目录不存在：${root}`))
    return { root, snapshot: { entries: [], reviewQueue: [], indexes: [] }, issues }
  }

  const entries: LintEntry[] = []
  for (const dir of KNOWLEDGE_DIRS) {
    const dirPath = join(root, dir)
    if (!existsSync(dirPath)) {
      issues.push(lintIssue('R8', dir, `目录缺失：${dir}/`))
      continue
    }
    for (const name of readdirSync(dirPath)) {
      if (!ENTRY_EXT_RE.test(name) || name === 'index.md') continue
      const abs = join(dirPath, name)
      const rel = `${dir}/${name}`
      const content = readFileSync(abs, 'utf8')
      const fields = parseEntry(content, rel, issues)
      if (fields !== null) entries.push({ path: rel, fields, body: content })
    }
  }

  const queuePath = join(root, 'review-queue.yaml')
  const reviewQueue = existsSync(queuePath) ? parseQueue(readFileSync(queuePath, 'utf8'), issues) : []

  const indexes: LintIndex[] = []
  for (const dir of KNOWLEDGE_DIRS) {
    const idxPath = join(root, dir, 'index.md')
    if (!existsSync(idxPath)) continue
    indexes.push({ dir, rows: parseIndex(readFileSync(idxPath, 'utf8'), `${dir}/index.md`, issues) })
  }

  return { root, snapshot: { entries, reviewQueue, indexes }, issues }
}

/** R7 存在性核查：候选相对【知识库根 / 仓库根 / 条目所在目录】三个基准解析。 */
export function makeRefExists(root: string) {
  const parentOfRoot = dirname(root)
  return (entryPath: string, ref: string): boolean | undefined => {
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
}

/** 采集 + 校验一体（CLI 与两宿主工具的唯一入口）：返回 lintKnowledge 结果 + 根 + 采集类问题合并后的 pass。 */
export function lintKnowledgeAt(rootArg: string, cwd = process.cwd()): LintResultAt {
  const collected = collectKnowledgeSnapshot(rootArg, cwd)
  const result = lintKnowledge(collected.snapshot, { refExists: makeRefExists(collected.root) })
  for (const i of collected.issues) result.errors.push(i)
  result.pass = result.errors.length === 0
  return { ...result, root: collected.root }
}

export interface LintResultAt extends LintResult {
  root: string
}
