export type PermitStatus = '待复核' | '待执行' | '执行中' | '待结束' | '待关闭' | '已完成'

export type PointState = '已隔离' | '待操作' | '已恢复'
export type PointType = '开关' | '刀闸' | '阀门' | '接地'
export type ConnectionState = '在线' | '重连中' | '离线'

/** 操作来源：谁、在哪个班组、用什么终端提交的 */
export interface OperationSource {
  crew: string
  actor: string
  terminal: string
}

/** 一次现场确认记录（追加式，不覆盖） */
export interface StepConfirmation {
  source: OperationSource
  at: string
  note?: string
}

export interface IsolationPoint {
  id: string
  device: string
  label: string
  type: PointType
  state: PointState
  /** 点级修订号：每次状态变更 +1，用于冲突检测 */
  revision: number
  updatedBy?: OperationSource
  updatedAt?: string
}

export interface PermitStep {
  id: string
  text: string
  done: boolean
  owner: string
  evidence?: string
  /** 步骤级修订号 */
  revision: number
  updatedBy?: OperationSource
  updatedAt?: string
  /** 追加式确认历史：任何一方的确认都保留，不覆盖 */
  confirmations: StepConfirmation[]
}

export interface Permit {
  id: string
  title: string
  device: string
  crew: string
  owner: string
  window: string
  status: PermitStatus
  risk: '一级' | '二级' | '三级'
  isolationPoints: IsolationPoint[]
  steps: PermitStep[]
  revision: number
  reviewRequired: boolean
  /** 最近一次复核通过时各隔离点的修订号快照；点修订超过快照即复核失效 */
  lastReviewPointRevisions?: Record<string, number>
}

export interface AuditEvent {
  id: string
  time: string
  actor: string
  action: string
  target: string
  detail: string
  source?: OperationSource
}

export type OperationKind = 'step' | 'point'
export type OperationStatus = 'queued' | 'applied' | 'conflict' | 'failed'

/** 离线补传时的差异条目 */
export interface DiffEntry {
  field: string
  label: string
  local: unknown
  remote: unknown
  remoteSource?: OperationSource
  remoteAt?: string
}

/** 一条可补传的现场操作（幂等键 = id） */
export interface FieldOperation {
  /** 幂等键：重复补传只留一次 */
  id: string
  kind: OperationKind
  permitId: string
  stepId?: string
  pointId?: string
  patch: Record<string, unknown>
  source: OperationSource
  /** 目标对象基线修订号 */
  baseRevision: number
  basePermitRevision: number
  createdAt: string
  status: OperationStatus
  attempts: number
  error?: string
  diff?: DiffEntry[]
  /** 冲突时远端快照，用于“采纳对方”回滚 */
  remoteSnapshot?: Record<string, unknown>
  note?: string
}
