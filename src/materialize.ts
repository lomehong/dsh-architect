/**
 * architect preset 物化器（母包 P2/协同御驿化目标 4）。
 *
 * 与 dsh-twin 的 materializePreset 同策略：目录存在且版本戳一致 → 跳过；
 * 否则 .bak 备份后整份写入 preset 文件，再按可选依赖探测追加工具行。
 * 身份模型（主人 2026-09-11 裁决）：architect 是独立于 digital-twin 的
 * preset id——两个 preset 各自独立 standing mount，御符按实例注入、不共享。
 *
 * 分层：plan（纯函数，可测）与 fs 执行分离；执行层绝不抛错（不炸宿主加载）。
 *
 * @module @dsh-extra/dsh-architect/materialize
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PRESET_ID = 'architect'
export const PRESET_VERSION = '1'
export const PRESET_FILES = ['agent.cordis.yml', 'preset.yml'] as const

/** 可选工具行：探测到包在位才追加（写死会让未装机上的整份 preset 无法挂载）。 */
export interface OptionalRow {
  id: string
  name: string
  /** 包根目录名（如 'dsh-yuyi'、'@dsh-extra/dsh-memory'），按 node_modules 布局探测 */
  packageRoot: string
}

export const OPTIONAL_ROWS: OptionalRow[] = [
  { id: 'tool-yuyi', name: 'dsh-yuyi/tools', packageRoot: 'dsh-yuyi' },
  { id: 'tool-memory', name: '@dsh-extra/dsh-memory/tools', packageRoot: '@dsh-extra/dsh-memory' },
]

export interface MaterializePlan {
  action: 'skip' | 'write'
  targetDir: string
  stampPath: string
  /** 需备份的既有文件（写前改名 .bak） */
  backups: string[]
  files: Array<{ src: string; dst: string }>
  optionalRows: OptionalRow[]
}

function presetIdOk(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(id)
}

function normPath(p: string): string {
  return p.replace(/\\/g, '/')
}

/** 纯函数：给定版本戳现状与可选包探测结果，产出物化计划。 */
export function planMaterialize(input: {
  dshHome: string
  packageDir: string
  version?: string
  optionalDetected: Record<string, boolean>
  exists: (p: string) => boolean
  /** 版本戳内容注入（真实 fs 由 materializeAt 提供）；缺省时无法确认版本 → 保守重物化 */
  readText?: (p: string) => string | undefined
}): MaterializePlan {
  const version = input.version ?? PRESET_VERSION
  const targetDir = normPath(join(input.dshHome, '.agent-presets', PRESET_ID))
  const stampPath = normPath(join(targetDir, '.materialized-version'))
  const exists = input.exists
  const backups: string[] = []
  const files: Array<{ src: string; dst: string }> = []
  let skip = false
  if (exists(stampPath)) {
    const stamped = input.readText?.(stampPath)
    if (stamped !== undefined && stamped.trim() === version) skip = true
  }
  for (const f of PRESET_FILES) {
    const dst = normPath(join(targetDir, f))
    if (exists(dst)) backups.push(`${f}.bak`)
    files.push({ src: normPath(join(input.packageDir, 'presets', PRESET_ID, f)), dst })
  }
  const optionalRows = skip ? [] : OPTIONAL_ROWS.filter(r => input.optionalDetected[r.packageRoot] === true)
  return { action: skip ? 'skip' : 'write', targetDir, stampPath, backups, files, optionalRows }
}

/** 渲染可选工具行的 yaml 追加段（写在主文件末尾，与 digital-twin 物化形态一致）。 */
export function renderOptionalRows(rows: OptionalRow[]): string {
  if (rows.length === 0) return ''
  return '\n' + rows.map(r => `# 可选工具行（物化时探测到 ${r.packageRoot} 在位，自动追加）\n- id: ${r.id}\n  name: '${r.name}'`).join('\n') + '\n'
}

/** node_modules 布局探测：$DSH_HOME/node_modules 与 $DSH_HOME/profiles 下各 profile 的 node_modules 目录。 */
export function detectOptionalPackages(dshHome: string, exists: (p: string) => boolean): Record<string, boolean> {
  const detected: Record<string, boolean> = {}
  const bases = [join(dshHome, 'node_modules')]
  const profilesDir = join(dshHome, 'profiles')
  if (exists(profilesDir)) {
    for (const p of existsSafeRead(profilesDir)) bases.push(join(profilesDir, p, 'node_modules'))
  }
  for (const row of OPTIONAL_ROWS) {
    detected[row.packageRoot] = bases.some(base => exists(join(base, row.packageRoot)))
  }
  return detected
}

function existsSafeRead(dir: string): string[] {
  try { return readdirSync(dir) } catch { return [] }
}

/** 执行物化（fs 层）。绝不抛错：失败返回 false 并经 onWarn 上报。 */
export function materializeAt(dshHome: string, packageDir: string, onWarn?: (message: string) => void): boolean {
  try {
    const exists = (p: string) => existsSync(p)
    const detected = detectOptionalPackages(dshHome, exists)
    const plan = planMaterialize({
      dshHome,
      packageDir,
      optionalDetected: detected,
      exists,
      readText: p => { try { return readFileSync(p, 'utf8') } catch { return undefined } },
    })
    if (plan.action === 'skip') return true
    // 先校验源文件齐全，再创建目标目录（坏源目录时不得产生任何写入）
    const missing = plan.files.filter(f => !existsSync(f.src))
    if (missing.length > 0) {
      onWarn?.(`[architect-materialize] 源文件缺失：${missing.map(f => f.src).join(', ')}`)
      return false
    }
    mkdirSync(plan.targetDir, { recursive: true })
    for (const f of plan.files) {
      if (existsSync(f.dst)) renameSync(f.dst, `${f.dst}.bak`)
      copyFileSync(f.src, f.dst)
    }
    // 可选行追加到 agent.cordis.yml 末尾
    const mainYml = plan.files.find(f => f.dst.endsWith('agent.cordis.yml'))
    if (mainYml && plan.optionalRows.length > 0) {
      const rendered = renderOptionalRows(plan.optionalRows)
      writeFileSync(mainYml.dst, readFileSync(mainYml.dst, 'utf8') + rendered, 'utf8')
    }
    writeFileSync(plan.stampPath, `${PRESET_VERSION}\n`, 'utf8')
    return true
  } catch (e) {
    onWarn?.('[architect-materialize] 物化失败：' + (e instanceof Error ? e.message : String(e)))
    return false
  }
}

/** 本包根（presets/ 的宿主）。 */
export function packageDirHere(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)))
}
