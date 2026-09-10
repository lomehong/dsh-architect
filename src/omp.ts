/**
 * oh-my-pi（omp）工具适配器：把与 dsh 工具同源的三个架构师检查器
 * （architect_digest / architect_design / architect_review）适配为
 * omp CustomTool（omp docs/custom-tools.md：模块默认导出 factory，factory(api) -> 工具数组）。
 *
 * 复用同一组纯函数（coverage.ts / digest.ts）——单一事实源，两宿主行为一致（决策 D9）。
 * omp 侧纪律：
 * - 参数 schema 用注入的 zod 兼容 builder（优先 pi.zod，回退 arktype / typebox）；
 * - 返回 { content, details }——omp 无输出 schema 校验，结构化结果放 details；
 * - loadMode: 'essential' 保持常驻（omp 自定义工具默认 discoverable，不常驻）；
 * - 无 UI 依赖、无持久化、无网络——与 dsh 版同一纪律（宪章 §3.3 数据自治）；
 * - builder 缺失 = 注册降级：返回空数组并告警，绝不抛错炸掉宿主加载。
 *
 * 安装：把本文件构建产物 lib/omp.js（或仓库内 src/omp.ts，omp 基于 Bun 可直接加载 TS）
 * 路径配置进 omp 工具发现（~/.omp/agent/tools、项目 .omp/tools，或 settings 工具路径）。
 * SKILL 侧挂载与宿主判别见 digital-architect 仓 adapters/oh-my-pi.md。
 *
 * @module @dsh-extra/dsh-architect/omp
 */
import { checkDesign, renderReviewSkeleton, type CoverageResult } from './coverage.ts'
import { checkDigest, type DigestInput } from './digest.ts'

/** zod 兼容 builder 的最小面（omp 注入 pi.zod / arktype / typebox 之一）。 */
interface OptionalLike {
  optional(): unknown
}

interface ZodLike {
  object(fields: Record<string, unknown>): unknown
  string(): OptionalLike
  boolean(): OptionalLike
  array(schema: unknown): OptionalLike
}

/** omp 注入给 factory 的宿主 API（只取本适配器用到的字段）。 */
export interface OmpApi {
  cwd?: string
  hasUI?: boolean
  logger?: { info?: (...a: unknown[]) => void; warn?: (...a: unknown[]) => void }
  zod?: ZodLike
  arktype?: ZodLike
  typebox?: ZodLike
  pi?: { zod?: ZodLike }
}

/** omp CustomTool 的最小结构面（execute 返回 { content, details }）。 */
export interface OmpCustomTool {
  name: string
  label: string
  description: string
  loadMode: 'essential'
  parameters: unknown
  execute: (
    toolCallId: string,
    params: unknown,
    onUpdate: unknown,
    ctx: unknown,
    signal: unknown,
  ) => Promise<OmpToolResult>
}

export interface OmpToolResult {
  content: Array<{ type: 'text'; text: string }>
  details: Record<string, unknown>
}

function resolveZod(api: OmpApi): ZodLike {
  const z = api.zod ?? api.pi?.zod ?? api.arktype ?? api.typebox
  if (z === undefined) {
    throw new Error('未找到 zod 兼容 schema builder（pi.zod / arktype / typebox）——无法构建工具参数 schema')
  }
  return z
}

/** ── 输入解析（与 dsh 版 tools.ts 同纪律：防御式读取，缺省安全） ── */
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** ── 共用：方案覆盖检查结果 → omp details ── */
function designDetails(value: CoverageResult): Record<string, unknown> {
  const dimensionsText = value.dimensions
    .map(d => `${d.title} ${d.score}/10${d.issues.length > 0 ? `（${d.issues.join('；')}）` : ''}`)
    .join('\n')
  return {
    total: value.total,
    max: value.max,
    pass: value.pass,
    five_questions_answered: value.fiveQuestions.answered,
    dimensions_text: dimensionsText,
    issues: value.issues,
  }
}

/** ── architect_digest：需求准入 ── */
function digestTool(z: ZodLike): OmpCustomTool {
  return {
    name: 'architect_digest',
    label: '架构师需求准入',
    description:
      '架构师需求准入：对结构化需求做六项覆盖检查（需求/系统/证据/风险/验证/不确定性），' +
      '产出准入结论与补齐清单。不足处登记「未知/待验证」，**不得编造**。' +
      '准入不通过时按 missing 清单补齐后重跑；通过后进入 architect-design 流程（读 architect-design 技能）。',
    loadMode: 'essential',
    parameters: z.object({
      requirement: z.string().optional(),
      do_items: z.array(z.string()).optional(),
      dont_items: z.array(z.string()).optional(),
      to_confirm: z.array(z.string()).optional(),
      assumptions: z.array(z.string()).optional(),
      blockers: z.array(z.string()).optional(),
      systems: z.array(z.string()).optional(),
      evidences: z.array(z.object({ conclusion: z.string().optional(), source: z.string().optional() })).optional(),
      risks_checked: z.boolean().optional(),
      validation_plan: z.string().optional(),
    }),
    execute: async (_toolCallId, params) => {
      const a = (params ?? {}) as Record<string, unknown>
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
      const head = result.admission === '通过' ? '✅ 需求准入通过' : '⛔ 需求准入不通过'
      const text = [
        head,
        coverageText,
        result.missing.length > 0 ? `补齐清单：\n- ${result.missing.join('\n- ')}` : '',
        result.next,
      ].filter(Boolean).join('\n\n')
      return {
        content: [{ type: 'text', text }],
        details: { admission: result.admission, missing: result.missing, next: result.next },
      }
    },
  }
}

/** ── architect_design：设计期覆盖自检 ── */
function designTool(z: ZodLike): OmpCustomTool {
  return {
    name: 'architect_design',
    label: '架构师方案自检',
    description:
      '架构师方案覆盖自检（设计期）：按六维度+五问检查技术方案的结构完整性与填写纪律' +
      '（缺章节/空单元格/未填占位符），给出得分与逐项修复指引。产出方案前自检用；评审期请用 architect_review。',
    loadMode: 'essential',
    parameters: z.object({
      design_md: z.string().optional(),
    }),
    execute: async (_toolCallId, params) => {
      const a = (params ?? {}) as Record<string, unknown>
      const md = str(a.design_md)
      if (md.trim() === '') throw new Error('design_md 必填（方案 markdown 全文）')
      const result = checkDesign(md)
      const head = result.pass ? `✅ 自检通过：${result.total}/${result.max}` : `⛔ 自检未通过：${result.total}/${result.max}`
      const details = designDetails(result)
      const text = [
        head,
        String(details.dimensions_text ?? ''),
        '修复上方 issue 后重跑自检；通过后交 architect_review 评审（自报 ≠ 完成）',
      ].filter(Boolean).join('\n')
      return { content: [{ type: 'text', text }], details }
    },
  }
}

/** ── architect_review：评审评分 + 骨架 ── */
function reviewTool(z: ZodLike): OmpCustomTool {
  return {
    name: 'architect_review',
    label: '架构师方案评审',
    description:
      '架构师方案评审（评审期）：五问+六维度覆盖评分，产出可直接落盘的评审结论骨架。' +
      '**评审通过 ≠ 方案落定**：落定以主人确认为准（自报 ≠ 完成）。评审者应抽查证据回源后再定稿。',
    loadMode: 'essential',
    parameters: z.object({
      design_md: z.string().optional(),
      title: z.string().optional(),
    }),
    execute: async (_toolCallId, params) => {
      const a = (params ?? {}) as Record<string, unknown>
      const md = str(a.design_md)
      if (md.trim() === '') throw new Error('design_md 必填（方案 markdown 全文）')
      const title = str(a.title).trim() !== '' ? str(a.title).trim() : '未命名方案'
      const result = checkDesign(md)
      const head = result.pass
        ? `✅ 评审评分 ${result.total}/${result.max}：通过（待主人确认落定）`
        : `⛔ 评审评分 ${result.total}/${result.max}：驳回`
      return {
        content: [{
          type: 'text',
          text: `${head}\n\n评审骨架已生成（review_md 字段）：抽查证据回源、补评语后落盘。注意自报 ≠ 完成——落定以主人确认为准。`,
        }],
        details: { total: result.total, max: result.max, pass: result.pass, review_md: renderReviewSkeleton(title, result) },
      }
    },
  }
}

/** 注册三个工具（供测试与高级宿主直接调用；builder 缺失抛错）。 */
export function createTools(api: OmpApi): OmpCustomTool[] {
  const z = resolveZod(api)
  return [digestTool(z), designTool(z), reviewTool(z)]
}

/** omp CustomToolFactory：模块默认导出。builder 缺失降级为空数组 + 告警（不炸宿主加载）。 */
export default function factory(api: OmpApi): OmpCustomTool[] {
  try {
    return createTools(api)
  } catch (e) {
    api.logger?.warn?.('[dsh-architect/omp] 工具注册失败（跳过）: ' + (e instanceof Error ? e.message : String(e)))
    return []
  }
}
