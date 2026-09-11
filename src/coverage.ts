/**
 * dsh-architect 覆盖检查核心（纯函数，零依赖）——可执行技术方案的六维度+五问确定性检查器。
 *
 * 方法论出处：dsh-memory 条目 mem_1788978083156_yycfzp 图 8（六维度覆盖 95%+ 主要工程问题）；
 * 模板：digital-architect/templates/executable-design.md。
 * 设计纪律：解析失败/结构缺失一律产出 issue 与低分，**绝不抛错**——检查器自身不得成为设计流程的阻断点。
 *
 * @module @dsh-extra/dsh-architect/coverage
 */

export type DimensionKey = 'requirement' | 'system' | 'evidence' | 'risk' | 'validation' | 'uncertainty'

/** 六维度定义（数组顺序即评分表顺序）。 */
export const DIMENSIONS: ReadonlyArray<{ key: DimensionKey; title: string }> = [
  { key: 'requirement', title: '需求覆盖' },
  { key: 'system', title: '系统覆盖' },
  { key: 'evidence', title: '证据覆盖' },
  { key: 'risk', title: '风险覆盖' },
  { key: 'validation', title: '验证覆盖' },
  { key: 'uncertainty', title: '不确定性治理' },
] as const

export interface DimensionCheck {
  key: DimensionKey
  title: string
  /** 章节是否找到 */
  found: boolean
  /** 0-10：找到章节 4 分 + 无空单元格 3 分 + 无未填占位符 3 分 */
  score: number
  maxScore: 10
  emptyCells: number
  unfilledPlaceholders: number
  issues: string[]
}

export interface FiveQuestionsCheck {
  found: boolean
  /** 五问中回答非空的数量（满分 5） */
  answered: number
  issues: string[]
}

export interface CoverageResult {
  /** 总分 0-60 */
  total: number
  max: 60
  /** total >= 50 且无维度 <= 5 且五问作答 >= 4 */
  pass: boolean
  fiveQuestions: FiveQuestionsCheck
  dimensions: DimensionCheck[]
  issues: string[]
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 抽取某标题（`## …标题…`）到下一个同级或更高级标题之间的区段；找不到返回 undefined。 */
export function sectionOf(md: string, title: string): string | undefined {
  const lines = md.split(/\r?\n/)
  const pattern = new RegExp(`^##\\s+.*${escapeRegExp(title)}`)
  const start = lines.findIndex(l => pattern.test(l))
  if (start < 0) return undefined
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2}\s+/.test(lines[i])) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join('\n')
}

/** 统计 markdown 表格中的空数据单元格（`| |` 空隙；表头分隔行 `|---|---|` 不算）。 */
export function countEmptyCells(text: string): number {
  let count = 0
  for (const line of text.split(/\r?\n/)) {
    if (!/^\s*\|.*\|\s*$/.test(line)) continue
    if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
    for (const cell of cells) {
      if (cell.trim() === '') count++
    }
  }
  return count
}

/** 统计未填写占位符 `<...>`（模板遗留；排除代码块/行内代码/无内容尖括号/闭合标签/泛型等代码形态）。 */
export function countUnfilledPlaceholders(text: string): number {
  const noCode = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '')
  // 中文/描述性占位符：形如 <方案标题>、<日期>、<谁>（含中文即视为占位）
  const descriptive = noCode.match(/<(?!\/?[a-zA-Z][^\s>]*>)[^<>\n]{1,60}>/g) ?? []
  // 英文占位词形态：形如 <TBD>、<description>、<your-name>——单词型标签但命中占位词白名单
  // （白名单制避免误伤 HTML 标签 <b>/<div> 与泛型 <string>；单词形且全词命中才计）
  const wordLike = noCode.match(/<([a-zA-Z][a-zA-Z0-9 _-]*)>/g) ?? []
  const counted = wordLike.filter(m => EN_PLACEHOLDER_RE.test(m.slice(1, -1).trim()))
  return descriptive.filter(m => /[\u4e00-\u9fff]|方案|标题|日期|路径/.test(m)).length + counted.length
}

/** 英文占位词白名单（G5，2026-09-11）：只认明确的占位约定词，不猜泛型/标签。 */
const EN_PLACEHOLDER_RE = /^(tbd|todo|xxx|fixme|wip|待定|待填|待补|待填写|description|title|date|name|path|reason|owner|status|content|value|version|file|slug|module|command|url|your[ _-][a-z]+|[a-z]+[ _-]here)$/i

/** 检查五问速答表。 */
export function checkFiveQuestions(md: string): FiveQuestionsCheck {
  const issues: string[] = []
  const sec = sectionOf(md, '一句话与五问速答') ?? sectionOf(md, '五问')
  if (sec === undefined) {
    return { found: false, answered: 0, issues: ['未找到五问速答区（应含：改哪里/为什么改/影响谁/如何验证/还有什么没有确认）'] }
  }
  const keys = ['改哪里', '为什么改', '影响谁', '如何验证', '还有什么']
  let answered = 0
  for (const key of keys) {
    const line = sec.split(/\r?\n/).find(l => l.includes(key))
    if (line === undefined) {
      issues.push(`五问缺失：${key}？`)
      continue
    }
    const cells = line.split('|').map(c => c.trim()).filter(c => c !== '')
    // 形态：| 问题 | 回答 |——过滤空单元格后，第 0 个是问题、第 1 个才是回答；
    // 只有问题没有回答（长度 < 2）或回答是未填占位符 → 未作答
    const answer = cells[1] ?? ''
    if (cells.length >= 2 && answer !== '' && !answer.startsWith('<') && !/^[<>|\s]+$/.test(answer)) {
      answered++
    } else {
      issues.push(`五问未作答：${key}？`)
    }
  }
  return { found: true, answered, issues }
}

/** 对单个维度区段打分（0-10）。 */
function scoreDimension(sec: string | undefined, key: DimensionKey, title: string): DimensionCheck {
  const maxScore = 10 as const
  if (sec === undefined) {
    return { key, title, found: false, score: 0, maxScore, emptyCells: 0, unfilledPlaceholders: 0, issues: [`缺少章节「${title}」`] }
  }
  const issues: string[] = []
  const empty = countEmptyCells(sec)
  const placeholders = countUnfilledPlaceholders(sec)
  let score = 4
  if (empty > 0) {
    issues.push(`存在 ${empty} 个空表格单元格（不适用也必须写「不适用 + 原因」，不允许留空）`)
  } else {
    score += 3
  }
  if (placeholders > 0) {
    issues.push(`存在 ${placeholders} 处未填写占位符`)
  } else {
    score += 3
  }
  if (!/\|/.test(sec)) {
    issues.push('章节内没有任何结构化表格/清单')
    score = Math.min(score, 4)
  }
  return { key, title, found: true, score, maxScore, emptyCells: empty, unfilledPlaceholders: placeholders, issues }
}

/** 六维度+五问完整检查。纯函数：同输入同输出，不落盘、不联网。 */
export function checkDesign(md: string): CoverageResult {
  if (typeof md !== 'string' || md.trim() === '') {
    return {
      total: 0, max: 60, pass: false,
      fiveQuestions: { found: false, answered: 0, issues: ['方案内容为空'] },
      dimensions: DIMENSIONS.map(d => ({ key: d.key, title: d.title, found: false, score: 0, maxScore: 10, emptyCells: 0, unfilledPlaceholders: 0, issues: ['方案内容为空'] })),
      issues: ['方案内容为空'],
    }
  }
  const fiveQuestions = checkFiveQuestions(md)
  const dimensions = DIMENSIONS.map(d => scoreDimension(sectionOf(md, d.title), d.key, d.title))
  const issues = [...fiveQuestions.issues]
  for (const d of dimensions) issues.push(...d.issues.map(i => `【${d.title}】${i}`))
  const total = dimensions.reduce((n, d) => n + d.score, 0)
  const pass = total >= 50 && dimensions.every(d => d.score > 5) && fiveQuestions.answered === 5
  return { total, max: 60, pass, fiveQuestions, dimensions, issues }
}

/** 生成评审骨架（architect_review 工具产出的固定格式文本，交评审者补评语后落盘）。 */
export function renderReviewSkeleton(title: string, result: CoverageResult): string {
  const dimRows = result.dimensions
    .map(d => `| ${d.title} | ${d.score}/10 | ${d.issues.length === 0 ? '无问题' : d.issues.join('；')} |`)
    .join('\n')
  const fq = result.fiveQuestions
  return [
    `# 评审结论：${title}`,
    '',
    `- 结论：${result.pass ? '通过（待主人确认落定）' : '驳回（退回 architect-design）'}`,
    `- 五问速答：${fq.found ? `已作答 ${fq.answered}/5` : '未找到五问区'}`,
    fq.issues.length > 0 ? `- 五问问题：${fq.issues.join('；')}` : '- 五问问题：无',
    '',
    '| 维度 | 得分 | 评语 |',
    '|---|---|---|',
    dimRows,
    '',
    `合计：**${result.total}/${result.max}**（通过线：≥50 且无维度 ≤5 且五问全答 5/5）`,
    '',
    '## 缺口清单（驳回时由评审者逐条补可执行修改指引）',
    '',
    '- （评审者补）',
    '',
    '## 待主人确认事项',
    '',
    '- （评审者补：五问验收结论；注意自报 ≠ 完成）',
  ].join('\n')
}
