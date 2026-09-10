/**
 * knowledge-lint 核心（纯函数，零依赖零网络零 fs）——知识库结构校验器（母包 P1-1，规则 R1~R8）。
 *
 * 方法论出处：文章 §3 路线三（Agent-friendly Repo：CI 负责发现知识陈旧、链接失效和结构漂移）+
 * §5.4（自动化守结构底线，语义归人）；本函数只读不写，不是设计流程的阻断点（解析缺失产出 issue，绝不抛错）。
 *
 * 纪律（与 coverage.ts 同构）：
 * - 输入为调用方收集好的结构化快照（KnowledgeSnapshot）——本模块不做任何 IO；
 * - `pass = errors.length === 0`（warnings 仅提示不阻断；R7 路径不存在由调用方经 refExists 判 false 升 error）；
 * - 解析类问题由调用方以 R8 issue 形式塞进快照外的 errors？——不：调用方直接向 result 追加？
 *   本模块暴露 `lintIssue()` 帮助调用方构造同形 issue，保持报告结构单一。
 *
 * @module @dsh-extra/dsh-architect/lint
 */

/** 单个知识条目快照：path 为相对知识库根的 POSIX 风格路径；fields 为展平的 frontmatter（嵌套 source 记为 `source.origin`）。 */
export interface LintEntry {
  path: string
  fields: Record<string, string>
}

/** review-queue.yaml 的一行（`- file: <相对路径>`）。 */
export interface LintQueueRow {
  file: string
}

/** 某目录 index.md 的一行（file 为该目录内文件名；status 为行内状态列，缺省=未写）。 */
export interface LintIndexRow {
  file: string
  status?: string
}

/** 一个目录的索引快照。 */
export interface LintIndex {
  dir: string
  rows: LintIndexRow[]
}

/** 知识库结构快照（调用方收集；本模块只读）。 */
export interface KnowledgeSnapshot {
  entries: LintEntry[]
  reviewQueue: LintQueueRow[]
  indexes: LintIndex[]
}

export interface LintIssue {
  rule: string
  path: string
  message: string
}

export interface LintStats {
  entries: number
  confirmed: number
  pending: number
}

export interface LintResult {
  /** pass = errors.length === 0（warnings 不阻断）。 */
  pass: boolean
  errors: LintIssue[]
  warnings: LintIssue[]
  stats: LintStats
}

export interface LintOptions {
  /**
   * 相对路径形态 ref 的存在性核查（R7）：
   * 返回 true=存在（无事）、false=不存在（升 error）、undefined=无法判定（保持 warning）。
   * 缺省时本模块对相对路径 ref 一律出 warning（由 CLI 等调用方补核查）。
   */
  refExists?: (entryPath: string, ref: string) => boolean | undefined
}

const REQUIRED_FIELDS = ['title', 'domain', 'source.origin', 'source.ref', 'confirmed', 'status', 'owner'] as const
const ALLOWED_STATUSES = ['已确认', '待审核']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const EXT_RE = /\.(?:md|yaml|yml|json|ts|js)$/i

function normPath(p: string): string {
  return String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, '')
}

function baseName(p: string): string {
  const n = normPath(p)
  const i = n.lastIndexOf('/')
  return i < 0 ? n : n.slice(i + 1)
}

function dirName(p: string): string {
  const n = normPath(p)
  const i = n.lastIndexOf('/')
  return i < 0 ? '' : n.slice(0, i)
}

/**
 * 从 ref 中提取「仓内相对路径形态」的候选（含 / 或 \，且以已知扩展名结尾）；
 * URL（含 ://）与纯章节号（§…）不构成候选。lint.ts 与 CLI 共用，保持单一事实源。
 */
export function relativePathCandidates(ref: string): string[] {
  if (typeof ref !== 'string' || ref.trim() === '') return []
  return ref
    .split(/[\s；;，,（）()【】\[\]「」]+/)
    .filter(part => part.includes('/') && !part.includes('://') && EXT_RE.test(part))
}

/** 供调用方（CLI/工具）追加解析类问题时构造同形 issue（R8）。 */
export function lintIssue(rule: string, path: string, message: string): LintIssue {
  return { rule, path, message }
}

/** 知识库结构校验（R1~R8）。纯函数：同输入同输出，不落盘、不联网、绝不抛错。 */
export function lintKnowledge(snapshot: KnowledgeSnapshot, opts: LintOptions = {}): LintResult {
  const errors: LintIssue[] = []
  const warnings: LintIssue[] = []
  const err = (rule: string, path: string, message: string): void => { errors.push({ rule, path, message }) }
  const warn = (rule: string, path: string, message: string): void => { warnings.push({ rule, path, message }) }

  const entries = (Array.isArray(snapshot?.entries) ? snapshot.entries : [])
    .map(e => ({ path: normPath(e?.path), fields: e?.fields ?? {} }))
    .filter(e => e.path !== '')
  const byPath = new Map(entries.map(e => [e.path, e]))

  for (const e of entries) {
    for (const k of REQUIRED_FIELDS) {
      const v = e.fields[k]
      if (typeof v !== 'string' || v.trim() === '') err('R1', e.path, `缺少必填字段 ${k}`)
    }
    const status = (e.fields.status ?? '').trim()
    if (status !== '' && !ALLOWED_STATUSES.includes(status)) err('R2', e.path, `status 非法：${status}（允许：已确认/待审核）`)
    const confirmed = (e.fields.confirmed ?? '').trim()
    if (confirmed !== '' && !DATE_RE.test(confirmed)) err('R3', e.path, `confirmed 非 YYYY-MM-DD：${confirmed}`)
    if (typeof e.fields.owner === 'string' && e.fields.owner.trim() === '') err('R6', e.path, 'owner 为空')
    const ref = e.fields['source.ref']
    if (typeof ref === 'string' && relativePathCandidates(ref).length > 0) {
      const verdict = opts.refExists?.(e.path, ref)
      if (verdict === false) err('R7', e.path, `ref 中仓内路径不存在：${ref}`)
      else if (verdict === undefined) warn('R7', e.path, `ref 含仓内路径，未经存在性核查：${ref}`)
    }
  }

  const queue = (Array.isArray(snapshot?.reviewQueue) ? snapshot.reviewQueue : []).map(r => normPath(r?.file)).filter(p => p !== '')
  const queued = new Set(queue)
  for (const file of queue) {
    const e = byPath.get(file)
    if (e === undefined) err('R4', file, 'review-queue 引用不存在的条目')
    else if ((e.fields.status ?? '').trim() !== '待审核') err('R4', file, `review-queue 引用了非待审核条目（status=${e.fields.status}）`)
  }
  for (const e of entries) {
    if ((e.fields.status ?? '').trim() === '待审核' && !queued.has(e.path)) err('R4', e.path, '待审核条目未登记 review-queue')
  }

  const indexed = new Set<string>()
  for (const idx of Array.isArray(snapshot?.indexes) ? snapshot.indexes : []) {
    const dir = normPath(idx?.dir)
    for (const row of Array.isArray(idx?.rows) ? idx.rows : []) {
      const rowFile = normPath(row?.file)
      if (rowFile === '') continue
      const full = dir === '' ? rowFile : `${dir}/${rowFile}`
      const e = byPath.get(full)
      if (e === undefined) { err('R5', full, 'index 引用不存在的条目'); continue }
      indexed.add(full)
      const rowStatus = (row?.status ?? '').trim()
      if (rowStatus !== '' && rowStatus !== (e.fields.status ?? '').trim()) {
        err('R5', full, `index 状态「${rowStatus}」与 frontmatter「${e.fields.status}」不一致`)
      }
    }
  }
  for (const e of entries) {
    if (!indexed.has(e.path)) err('R5', e.path, '条目未登记所在目录 index.md')
  }

  const confirmed = entries.filter(e => (e.fields.status ?? '').trim() === '已确认').length
  const pending = entries.filter(e => (e.fields.status ?? '').trim() === '待审核').length
  return { pass: errors.length === 0, errors, warnings, stats: { entries: entries.length, confirmed, pending } }
}

export { baseName, dirName, normPath }
