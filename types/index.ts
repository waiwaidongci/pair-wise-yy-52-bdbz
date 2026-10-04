export type PermitStatus = '待复核' | '待执行' | '执行中' | '待结束' | '待关闭' | '已完成'
export type PointState = '已隔离' | '待操作' | '已恢复'
export type PointType = '开关' | '刀闸' | '阀门' | '接地'
export type ReviewResult = '通过' | '待复核' | '失效待重算'
export type ConnectionState = '在线' | '重连中' | '离线'

export interface IsolationPoint {
  id: string
  device: string
  label: string
  type: PointType
  state: PointState
  /** 隔离点修订号，每次现场操作递增；许可复核以此为依据 */
  revision: number
  updatedAt: string
  updatedBy: string
  source: string
}

export interface PermitStep {
  id: string
  text: string
  done: boolean
  owner: string
  evidence?: string
  /** 现场确认人（可能与步骤责任人不同） */
  confirmedBy?: string
  confirmedAt?: string
  /** 确认来源终端，如 PAD-02 */
  source?: string
  /** 该确认落库时所在的许可修订号 */
  revision?: number
}

export interface ReviewState {
  /** 复核结果是否仍有效；隔离点修订一变化立即置为 false */
  valid: boolean
  result: ReviewResult
  reason: string
  reviewer?: string
  reviewedAt?: string
  /** 上一次有效复核的签字人（失效后保留，便于追溯） */
  lastReviewer?: string
  lastReviewedAt?: string
  /** 复核所依据的隔离点快照，形如 IP-413@4 */
  basis: string[]
  /** 复核动作发生时的许可修订号 */
  revision?: number
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
  pointIds: string[]
  steps: PermitStep[]
  revision: number
  updatedAt: string
  updatedBy: string
  review: ReviewState
}

export type OpType = 'step-confirm' | 'step-evidence' | 'point-op' | 'permit-advance' | 'review'
export type OpStatus = '待发送' | '同步中' | '失败' | '冲突'

export interface PendingOp {
  /** 操作幂等键：同一操作重复补传只落一次 */
  clientId: string
  type: OpType
  permitId?: string
  pointId?: string
  stepId?: string
  payload: Record<string, unknown>
  /** 发起时依据的修订号，用于乐观锁冲突检测 */
  baseRevision: number
  actor: string
  source: string
  createdAt: string
  attempts: number
  status: OpStatus
  lastError?: string
}

export interface MergeConflict {
  id: string
  clientId: string
  type: OpType
  permitId?: string
  pointId?: string
  stepId?: string
  label: string
  local: { actor: string; at: string; source: string; baseRevision: number; value: string }
  remote: { actor: string; at: string; source: string; revision: number; value: string }
  detectedAt: string
  resolved?: 'remote' | 'local'
}

export interface AuditEvent {
  id: string
  /** 毫秒时间戳，保证同分钟内事件顺序稳定 */
  ts: number
  time: string
  actor: string
  action: string
  target: string
  detail: string
  /** 来源终端 */
  source: string
  /** 对应操作的幂等键 */
  clientId: string
  /** 操作后修订号 */
  revision?: number
  kind?: 'point' | 'step' | 'review' | 'sync' | 'system'
}
