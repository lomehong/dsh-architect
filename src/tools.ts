/**
 * dsh-architect 模型工具入口：preset 行（`name: '@dsh-extra/dsh-architect/tools'`）
 * 引用本模块，挂载后的分身会话获得三个架构师工具：
 * - architect_digest：需求准入（六项覆盖检查 → 结构化结论）
 * - architect_design：方案覆盖自检（六维度+五问 → 得分与修复指引）
 * - architect_review：评审评分 + 评审骨架生成（自报 ≠ 完成，通过以主人确认为准）
 *
 * 注册形态：鸭子类型 tools.register（对齐 dsh-task-board/tools），不引入其他
 * 套件包运行时依赖。注册失败降级为跳过：绝不让工具注册问题炸掉会话创建。
 *
 * 输出纪律（宪章⑬）：返回键 ⊆ output schema（additionalProperties: false），
 * 宿主按 schema 校验工具输出，多余键即拒。
 *
 * @module @dsh-extra/dsh-architect/tools
 */
import type { Context } from '@deepseek-ai/cordis'
import { checkDesign, renderReviewSkeleton, type CoverageResult } from './coverage.ts'
import { checkDigest, type DigestInput } from './digest.ts'

interface JsonSchemaLike {
  type: 'object'
  additionalProperties?: boolean
  required?: string[]
  properties: Record<string, unknown>
}

interface ToolOutputLike {
  schema: JsonSchemaLike
  render: (args: unknown, value: unknown) => Array<{ type: 'text'; text: string }>
}

interface ToolRegistration {
  name: string
  description: string
  parameters: JsonSchemaLike
  output: ToolOutputLike
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

interface ToolsLike {
  register(tool: ToolRegistration): void
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** ── architect_digest：需求准入 ── */
function registerDigest(tools: ToolsLike): void {
  tools.register({
    name: 'architect_digest',
    description:
      '架构师需求准入：对结构化需求做六项覆盖检查（需求/系统/证据/风险/验证/不确定性），' +
      '产出准入结论与补齐清单。不足处登记「未知/待验证」，**不得编造**。' +
      '准入不通过时按 missing 清单补齐后重跑；通过后进入 architect-design 流程（读 architect-design 技能）。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['requirement', 'do_items', 'validation_plan'],
      properties: {
        requirement: { type: 'string', description: '需求原文（PRD 转写或主人口头需求的忠实记录）' },
        do_items: { type: 'array', items: { type: 'string' }, description: '做——需求条目逐项归属' },
        dont_items: { type: 'array', items: { type: 'string' }, description: '不做——显式排除项' },
        to_confirm: { type: 'array', items: { type: 'string' }, description: '待确认——问主人的问题清单' },
        assumptions: { type: 'array', items: { type: 'string' }, description: '假设（每条带依据）' },
        blockers: { type: 'array', items: { type: 'string' }, description: '阻断项（非空即准入不通过）' },
        systems: { type: 'array', items: { type: 'string' }, description: '涉及的服务/仓库/上下游' },
        evidences: {
          type: 'array',
          description: '关键结论与证据来源',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['conclusion', 'source'],
            properties: {
              conclusion: { type: 'string', description: '关键结论' },
              source: { type: 'string', description: '证据出处（文件:行 / 知识条目 / 配置路径）' },
            },
          },
        },
        risks_checked: { type: 'boolean', description: '是否已逐类过风险清单（兼容/异常/缓存/MQ/状态机/安全）' },
        validation_plan: { type: 'string', description: '验证计划（至少明确「如何算完成」）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          admission: { type: 'string', enum: ['通过', '不通过'] },
          missing: { type: 'array', items: { type: 'string' } },
          next: { type: 'string' },
          coverage_text: { type: 'string', description: '六项覆盖检查表（文本形态）' },
        },
      },
      render: (_args, value) => {
        const v = value as { admission?: string; missing?: string[]; next?: string; coverage_text?: string }
        const head = v.admission === '通过' ? '✅ 需求准入通过' : '⛔ 需求准入不通过'
        return [{ type: 'text', text: [head, v.coverage_text ?? '', v.missing && v.missing.length > 0 ? `补齐清单：\n- ${v.missing.join('\n- ')}` : '', v.next ?? ''].filter(Boolean).join('\n\n') }]
      },
    },
    execute: async args => {
      const a = (args ?? {}) as Record<string, unknown>
      const requirement = str(a.requirement)
      if (requirement.trim() === '') throw new Error('requirement 必填（需求原文）')
      const doItems = asStringArray(a.do_items)
      if (doItems.length === 0) throw new Error('do_items 必填（至少一项「做」；不做与待确认用 dont_items/to_confirm 表达）')
      const input: DigestInput = {
        requirement,
        doItems,
        dontItems: asStringArray(a.dont_items),
        toConfirm: asStringArray(a.to_confirm),
        assumptions: asStringArray(a.assumptions),
        blockers: asStringArray(a.blockers),
        systems: asStringArray(a.systems),
        evidences: Array.isArray(a.evidences)
          ? a.evidences.map(e => {
              const o = (e ?? {}) as Record<string, unknown>
              return { conclusion: str(o.conclusion), source: str(o.source) }
            })
          : [],
        risksChecked: a.risks_checked === true,
        validationPlan: str(a.validation_plan),
      }
      const result = checkDigest(input)
      const coverageText = result.coverage.map(c => `${c.ok ? '✅' : '⛔'} ${c.item}：${c.note}`).join('\n')
      return { admission: result.admission, missing: result.missing, next: result.next, coverage_text: coverageText }
    },
  })
}

/** ── 共用：方案覆盖检查工具的参数/输出形态 ── */
function designCheckResult(value: CoverageResult): { total: number; max: 60; pass: boolean; five_questions_answered: number; dimensions_text: string; issues: string[] } {
  return {
    total: value.total,
    max: value.max,
    pass: value.pass,
    five_questions_answered: value.fiveQuestions.answered,
    dimensions_text: value.dimensions.map(d => `${d.title} ${d.score}/10${d.issues.length > 0 ? `（${d.issues.join('；')}）` : ''}`).join('\n'),
    issues: value.issues,
  }
}

const DESIGN_MD_PROPERTY = {
  design_md: { type: 'string', description: '方案 markdown 全文（按 templates/executable-design.md 骨架产出）' },
}

function parseDesignMd(args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>
  const md = str(a.design_md)
  if (md.trim() === '') throw new Error('design_md 必填（方案 markdown 全文）')
  return md
}

/** ── architect_design：设计期覆盖自检 ── */
function registerDesign(tools: ToolsLike): void {
  tools.register({
    name: 'architect_design',
    description:
      '架构师方案覆盖自检（设计期）：按六维度+五问检查技术方案的结构完整性与填写纪律' +
      '（缺章节/空单元格/未填占位符），给出得分与逐项修复指引。产出方案前自检用；评审期请用 architect_review。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['design_md'],
      properties: DESIGN_MD_PROPERTY,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          total: { type: 'number' },
          max: { type: 'number' },
          pass: { type: 'boolean' },
          five_questions_answered: { type: 'number' },
          dimensions_text: { type: 'string' },
          issues: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => {
        const v = value as { total?: number; max?: number; pass?: boolean; dimensions_text?: string }
        const head = v.pass === true ? `✅ 自检通过：${v.total}/${v.max}` : `⛔ 自检未通过：${v.total}/${v.max}`
        return [{ type: 'text', text: [head, v.dimensions_text ?? '', '修复上方 issue 后重跑自检；通过后交 architect_review 评审（自报 ≠ 完成）'].filter(Boolean).join('\n') }]
      },
    },
    execute: async args => designCheckResult(checkDesign(parseDesignMd(args))),
  })
}

/** ── architect_review：评审评分 + 骨架 ── */
function registerReview(tools: ToolsLike): void {
  tools.register({
    name: 'architect_review',
    description:
      '架构师方案评审（评审期）：五问+六维度覆盖评分，产出可直接落盘的评审结论骨架。' +
      '**评审通过 ≠ 方案落定**：落定以主人确认为准（自报 ≠ 完成）。评审者应抽查证据回源后再定稿。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['design_md', 'title'],
      properties: { ...DESIGN_MD_PROPERTY, title: { type: 'string', description: '方案标题（写入评审结论标题）' } },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          total: { type: 'number' },
          max: { type: 'number' },
          pass: { type: 'boolean' },
          review_md: { type: 'string', description: '评审结论骨架（markdown，交评审者补评语后落盘）' },
        },
      },
      render: (_args, value) => {
        const v = value as { total?: number; max?: number; pass?: boolean; review_md?: string }
        const head = v.pass === true ? `✅ 评审评分 ${v.total}/${v.max}：通过（待主人确认落定）` : `⛔ 评审评分 ${v.total}/${v.max}：驳回`
        return [{ type: 'text', text: `${head}\n\n评审骨架已生成（review_md 字段）：抽查证据回源、补评语后落盘。注意自报 ≠ 完成——落定以主人确认为准。` }]
      },
    },
    execute: async args => {
      const a = (args ?? {}) as Record<string, unknown>
      const md = parseDesignMd(args)
      const title = str(a.title).trim() !== '' ? str(a.title).trim() : '未命名方案'
      const result = checkDesign(md)
      return { total: result.total, max: result.max, pass: result.pass, review_md: renderReviewSkeleton(title, result) }
    },
  })
}

export const name = 'tool-architect'
export const inject = ['tools']
export function apply(ctx: Context): void {
  const host = ctx as unknown as { tools?: ToolsLike; get?(name: string): unknown }
  const tools = host.tools ?? (host.get?.('tools') as ToolsLike | undefined)
  if (tools === undefined || typeof tools.register !== 'function') return
  const registerAll = [registerDigest, registerDesign, registerReview]
  for (const register of registerAll) {
    try {
      register(tools)
    } catch (e) {
      try { console.warn('[dsh-architect] 工具注册失败（跳过）:', e instanceof Error ? e.message : String(e)) } catch { /* 忽略 */ }
    }
  }
}

