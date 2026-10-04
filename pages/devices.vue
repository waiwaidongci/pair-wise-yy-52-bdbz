<script setup lang="ts">
import { useOperationsStore } from '~/stores/operations'
import type { PointState } from '~/types'

const store = useOperationsStore()
const toast = useToast()

const selectedDevice = ref('LINE-A2')
const deviceMeta: Record<string, { name: string; state: string; crew: string }> = {
  'WTG-03': { name: '3 号风力发电机组', state: '检修隔离', crew: '机务二班' },
  'LINE-A2': { name: 'A2 集电线路', state: '待隔离', crew: '线路一班' },
  'BOX-12': { name: '12 号箱式变压器', state: '运行', crew: '电气一班' },
  'BUS-A': { name: 'A 段 35kV 母线', state: '运行', crew: '公用' },
}

const pointStateColor: Record<PointState, string> = { 已隔离: 'green', 待操作: 'amber', 已恢复: 'gray' }
const nextLabel: Record<PointState, string> = { 待操作: '执行隔离', 已隔离: '解除隔离', 已恢复: '重新隔离' }

const devices = computed(() => {
  return Object.entries(deviceMeta).map(([id, meta]) => {
    const pts = store.points.filter((point) => point.device === id)
    const linked = store.permits.filter((permit) => permit.pointIds.some((pid) => pts.some((point) => point.id === pid)))
    return { id, ...meta, points: pts.length, linked }
  })
})
const selectedPoints = computed(() => store.points.filter((point) => point.device === selectedDevice.value))

function linkedPermits(pointId: string) {
  return store.permits.filter((permit) => permit.pointIds.includes(pointId))
}
function run(result: ReturnType<typeof store.cyclePoint>) {
  if (result && !result.ok) toast.add({ title: '操作未执行', description: result.error, color: 'red' })
  else if (result) toast.add({ title: '已执行', description: '隔离点修订号已递增，引用该点的许可复核立即失效重算', color: 'green' })
}
const pointConflicts = computed(() => store.conflicts.filter((item) => item.type === 'point-op'))
const pointQueue = computed(() => store.queue.filter((item) => item.type === 'point-op'))
</script>

<template>
  <div class="page">
    <div class="head">
      <div><p class="eyebrow">LOCKOUT / TAGOUT</p><h1 class="page-title">设备隔离与锁定点</h1><p class="muted">隔离点为全局共享资源，状态一变，引用它的作业许可复核结果立即失效并重算；每次操作带来源终端与修订号。</p></div>
      <div class="inline">
        <UBadge :color="store.connection === '在线' ? 'green' : 'red'" variant="subtle">{{ store.connection }}</UBadge>
        <UButton color="gray" variant="outline" icon="i-heroicons-user-group" @click="navigateTo('/permits')">查看关联许可</UButton>
      </div>
    </div>
    <div class="device-grid">
      <article
        v-for="device in devices" :key="device.id" class="panel device"
        :class="{ active: selectedDevice === device.id }" @click="selectedDevice = device.id"
      >
        <div class="inline justify-between">
          <UBadge variant="subtle">{{ device.id }}</UBadge>
          <UBadge :color="device.state === '运行' ? 'green' : device.state === '检修隔离' ? 'red' : 'amber'" variant="subtle">{{ device.state }}</UBadge>
        </div>
        <h2>{{ device.name }}</h2>
        <div class="kv"><span>隔离点</span><b>{{ device.points }} 个</b></div>
        <div class="kv"><span>关联许可</span><b>{{ device.linked.length }} 张</b></div>
        <div class="kv"><span>责任班组</span><b>{{ device.crew }}</b></div>
      </article>
    </div>

    <section class="grid lower">
      <article class="panel p-4">
        <h2>{{ selectedDevice }} · 隔离检查单</h2>
        <div v-for="point in selectedPoints" :key="point.id" class="point">
          <div class="lock-icon"><UIcon name="i-heroicons-lock-closed" /></div>
          <div class="point-main">
            <b>{{ point.label }}</b>
            <small>{{ point.type }} · {{ point.id }} · 当前 r{{ point.revision }}</small>
            <small>最近操作：{{ point.updatedBy }} · {{ point.updatedAt }} · 来源 {{ point.source }}</small>
            <div class="tags">
              <UButton
                v-for="permit in linkedPermits(point.id)" :key="permit.id"
                size="xs" variant="link"
                :color="permit.review.valid ? 'gray' : 'red'"
                @click="navigateTo(`/permits?id=${permit.id}`)"
              >{{ permit.id }}{{ permit.review.valid ? '' : '（复核已失效）' }}</UButton>
            </div>
          </div>
          <UBadge :color="pointStateColor[point.state]" variant="subtle">{{ point.state }}</UBadge>
          <UButton size="xs" color="primary" variant="soft" icon="i-heroicons-arrow-path" @click="run(store.cyclePoint(point.id))">{{ nextLabel[point.state] }}</UButton>
          <UButton size="xs" color="gray" variant="ghost" icon="i-heroicons-user-plus" :loading="false" @click="run(store.peerEditPoint(point.id))">模拟对端操作</UButton>
        </div>
        <UAlert v-if="!selectedPoints.length" color="gray" title="该设备暂无隔离点" description="可在许可中新建隔离点并关联设备。" />
      </article>

      <aside class="grid side">
        <article class="panel p-4">
          <h3>联动规则</h3>
          <ul class="rules">
            <li>隔离点每次现场操作修订号 +1，旧修订号上的许可复核立即标记「失效待重算」。</li>
            <li>同一隔离点被多张许可引用（如 BUS-A 母线刀闸），任一班组操作都会触发联动。</li>
            <li>复核未重算通过前，许可无法推进流程；步骤现场确认不受影响。</li>
          </ul>
        </article>

        <article v-if="pointConflicts.length" class="panel p-4 conflict-panel">
          <h3 class="danger">修订冲突（隔离点）</h3>
          <div v-for="conflict in pointConflicts" :key="conflict.id" class="conflict">
            <b>{{ conflict.label }}</b>
            <div class="diff">
              <div class="diff-local"><small>我的操作 · {{ conflict.local.source }} · 基于 r{{ conflict.local.baseRevision }}</small><span>{{ conflict.local.value }}</span></div>
              <div class="diff-remote"><small>对方记录 · {{ conflict.remote.source }} · r{{ conflict.remote.revision }}</small><span>{{ conflict.remote.value }}</span></div>
            </div>
            <div class="inline">
              <UButton size="xs" color="primary" variant="soft" @click="run(store.rebaseConflict(conflict.id))">基于最新修订重做</UButton>
              <UButton size="xs" color="gray" variant="ghost" @click="store.discardConflict(conflict.id)">保留对方记录</UButton>
            </div>
          </div>
        </article>

        <article class="panel p-4">
          <h3>待补传的隔离操作 <UBadge v-if="pointQueue.length" color="amber" variant="subtle">{{ pointQueue.length }}</UBadge></h3>
          <p v-if="!pointQueue.length" class="muted small">无待处理项。可先点「模拟断网」，再操作隔离点体验补传合并。</p>
          <div v-for="op in pointQueue" :key="op.clientId" class="queue-item">
            <div><b>{{ op.pointId }}</b><small>{{ op.actor }} · {{ op.source }} · 基于 r{{ op.baseRevision }} · 第 {{ op.attempts }} 次尝试</small><small class="mono">{{ op.clientId }}</small></div>
            <UButton size="xs" :color="op.status === '冲突' ? 'red' : 'amber'" variant="soft" :disabled="store.connection === '离线'" @click="run(store.retryOp(op.clientId))">重试</UButton>
          </div>
        </article>
      </aside>
    </section>
  </div>
</template>

<style scoped>
.head{display:flex;justify-content:space-between;gap:16px;margin-bottom:18px}.head h1{margin:3px 0 7px}.head p{margin:0;max-width:820px}.eyebrow{font-size:12px;color:#2563eb;font-weight:700}
.device-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:16px}.device{padding:16px;cursor:pointer}.device.active{border-color:#2563eb;box-shadow:0 0 0 2px #dbeafe}.device h2{font-size:16px;margin:14px 0}.kv{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #edf0f5;font-size:13px}.kv span{color:#667085}
.lower{grid-template-columns:1.35fr .65fr;gap:16px}.side{gap:14px;height:fit-content}.panel h2{font-size:17px;margin:0 0 14px}.panel h3{font-size:15px;margin:0 0 10px}
.point{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #edf0f5;flex-wrap:wrap}.point-main{flex:1;min-width:220px}.point b,.point small{display:block}.point small{color:#667085;margin-top:3px}.lock-icon{display:grid;place-items:center;width:34px;height:34px;background:#eff6ff;color:#2563eb;border-radius:7px}.tags{display:flex;flex-wrap:wrap;margin-top:4px}
.rules{margin:0;padding-left:18px;color:#475569;font-size:13px;line-height:1.9}
.conflict{border:1px solid #fecaca;border-radius:8px;padding:10px;margin-bottom:10px;background:#fef2f2}.conflict>b{font-size:13px}.diff{display:grid;gap:6px;margin:8px 0}.diff small{display:block;color:#667085}.diff span{font-size:13px}.diff-local{border-left:3px solid #f59e0b;padding:4px 8px;background:#fffbeb;border-radius:0 6px 6px 0}.diff-remote{border-left:3px solid #2563eb;padding:4px 8px;background:#eff6ff;border-radius:0 6px 6px 0}
.queue-item{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid #edf0f5}.queue-item small{display:block;color:#667085;font-size:12px;margin-top:2px}.mono{font-family:monospace;font-size:11px}.small{font-size:12px}
@media(max-width:1050px){.device-grid{grid-template-columns:1fr 1fr}.lower{grid-template-columns:1fr}}@media(max-width:600px){.head{flex-direction:column;gap:12px}.device-grid{grid-template-columns:1fr}}
</style>
