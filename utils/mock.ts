import type { AuditEvent, IsolationPoint, Permit } from '~/types'

const T0 = '2026-09-29 16:42'

/** 全局共享的设备隔离点；多个许可可引用同一个点（跨班组共用边界） */
export const isolationPoints: IsolationPoint[] = [
  { id: 'IP-301', device: 'WTG-03', label: '塔基 690V 主开关', type: '开关', state: '已隔离', revision: 3, updatedAt: T0, updatedBy: '周野', source: 'PAD-02' },
  { id: 'IP-302', device: 'BOX-03', label: '箱变低压侧刀闸', type: '刀闸', state: '已隔离', revision: 2, updatedAt: T0, updatedBy: '周野', source: 'PAD-02' },
  { id: 'IP-303', device: 'WTG-03', label: '叶轮机械锁', type: '阀门', state: '已隔离', revision: 1, updatedAt: T0, updatedBy: '李骁', source: 'WEB-值班台' },
  { id: 'IP-411', device: 'LINE-A2', label: 'A2 进线断路器', type: '开关', state: '待操作', revision: 1, updatedAt: '09-29 15:30', updatedBy: '何岚', source: 'WEB-值班台' },
  { id: 'IP-412', device: 'LINE-A2', label: '17 号杆接地刀闸', type: '接地', state: '待操作', revision: 1, updatedAt: '09-29 15:30', updatedBy: '何岚', source: 'WEB-值班台' },
  { id: 'IP-413', device: 'BUS-A', label: '母线侧隔离刀闸', type: '刀闸', state: '已隔离', revision: 4, updatedAt: '09-29 16:20', updatedBy: '赵清', source: 'WEB-值班台' },
  { id: 'IP-501', device: 'BOX-12', label: '高压负荷开关', type: '开关', state: '待操作', revision: 1, updatedAt: '09-29 14:05', updatedBy: '孙禾', source: 'PAD-05' },
]

const pointBasis = (ids: string[]) => ids.map((id) => {
  const point = isolationPoints.find((item) => item.id === id)!
  return `${id}@${point.revision}`
})

export const permits: Permit[] = [
  {
    id: 'WP-260929-018', title: '3 号风机齿轮箱更换', device: 'WTG-03 · 箱变 03', crew: '机务二班', owner: '李骁', window: '09-29 14:00 — 22:00', status: '执行中', risk: '一级',
    pointIds: ['IP-301', 'IP-302', 'IP-303'], revision: 5, updatedAt: T0, updatedBy: '周野',
    review: { valid: true, result: '通过', reason: '隔离边界完整，复核通过', reviewer: '赵清', reviewedAt: '09-29 13:50', basis: pointBasis(['IP-301', 'IP-302', 'IP-303']), revision: 4 },
    steps: [
      { id: 'ST-01', text: '核对工作票、设备双重编号与现场标识', done: true, owner: '周野', evidence: '现场照片 2 张', confirmedBy: '周野', confirmedAt: '09-29 14:12', source: 'PAD-02', revision: 2 },
      { id: 'ST-02', text: '断开 690V 主开关并执行机械锁定', done: true, owner: '周野', evidence: '锁具编号 LK-2107', confirmedBy: '周野', confirmedAt: T0, source: 'PAD-02', revision: 5 },
      { id: 'ST-03', text: '验电、放电并装设接地线', done: false, owner: '何岚' },
      { id: 'ST-04', text: '全体作业人员确认隔离边界', done: false, owner: '李骁' },
    ],
  },
  {
    id: 'WP-260929-021', title: '2 号集电线路绝缘子更换', device: 'LINE-A2 · 杆塔 17–23', crew: '线路一班', owner: '何岚', window: '09-29 18:00 — 30 02:00', status: '待复核', risk: '一级',
    pointIds: ['IP-411', 'IP-412', 'IP-413', 'IP-501'], revision: 2, updatedAt: '09-29 16:18', updatedBy: '何岚',
    // 引用了 BUS-A 与 BOX-12 的点，共用边界一动，这个复核立即失效
    review: { valid: false, result: '失效待重算', reason: '共用母线隔离点 IP-413 已被其他班组操作（r3 → r4），原复核依据失效，必须重新复核', lastReviewer: '赵清', lastReviewedAt: '09-29 15:40', basis: pointBasis(['IP-411', 'IP-412', 'IP-413', 'IP-501']) },
    steps: [
      { id: 'ST-11', text: '核对线路双重名称与停电范围', done: true, owner: '何岚', confirmedBy: '何岚', confirmedAt: '09-29 15:46', source: 'PAD-01', revision: 1 },
      { id: 'ST-12', text: '断开 A2 进线并完成五防校验', done: false, owner: '孙禾' },
      { id: 'ST-13', text: '17、23 号杆验电并装设接地线', done: false, owner: '谭勇' },
    ],
  },
  {
    id: 'WP-260930-004', title: '箱变 12 温控器更换', device: 'BOX-12', crew: '电气一班', owner: '孙禾', window: '09-30 08:00 — 12:00', status: '待执行', risk: '二级',
    pointIds: ['IP-501'], revision: 1, updatedAt: '09-29 14:05', updatedBy: '孙禾',
    review: { valid: true, result: '通过', reason: '低压负荷已转移，复核通过', reviewer: '赵清', reviewedAt: '09-29 14:00', basis: pointBasis(['IP-501']), revision: 1 },
    steps: [
      { id: 'ST-21', text: '核对箱变编号和低压侧负荷转移', done: true, owner: '孙禾', confirmedBy: '孙禾', confirmedAt: '09-29 14:02', source: 'PAD-05', revision: 1 },
      { id: 'ST-22', text: '断开高压负荷开关并锁定', done: false, owner: '孙禾' },
    ],
  },
]

export const auditEvents: AuditEvent[] = [
  { id: 'AE-0007', ts: new Date('2026-09-29T16:42:00').getTime(), time: '09-29 16:42', actor: '周野', action: '完成步骤', target: 'WP-260929-018 / ST-02', detail: '上传机械锁具编号 LK-2107', source: 'PAD-02', clientId: 'seed-ae-7', revision: 5, kind: 'step' },
  { id: 'AE-0006', ts: new Date('2026-09-29T16:20:00').getTime(), time: '09-29 16:20', actor: '赵清', action: '隔离点操作', target: 'BUS-A / IP-413', detail: '母线侧隔离刀闸状态由“待操作”变更为“已隔离”（r3 → r4）', source: 'WEB-值班台', clientId: 'seed-ae-6', revision: 4, kind: 'point' },
  { id: 'AE-0005', ts: new Date('2026-09-29T16:18:30').getTime(), time: '09-29 16:18', actor: '系统', action: '复核失效', target: 'WP-260929-021', detail: 'IP-413 修订号变化，赵清 15:40 的复核结果自动失效，等待重新复核', source: '系统', clientId: 'seed-ae-5', kind: 'review' },
  { id: 'AE-0004', ts: new Date('2026-09-29T16:18:00').getTime(), time: '09-29 16:18', actor: '系统', action: '冲突预警', target: 'LINE-A2', detail: '检测到线路一班与电气二班在 18:00–20:00 重叠作业', source: '系统', clientId: 'seed-ae-4', kind: 'system' },
  { id: 'AE-0003', ts: new Date('2026-09-29T15:56:00').getTime(), time: '09-29 15:56', actor: '赵清', action: '复核通过', target: 'WP-260929-014', detail: '同意执行，要求每 2 小时回报风速', source: 'WEB-值班台', clientId: 'seed-ae-3', kind: 'review' },
]
