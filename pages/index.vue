<script setup lang="ts">
import { useOperationsStore } from '~/stores/operations'

const store = useOperationsStore()
const { data } = await useFetch('/api/operations')
const { reconnect } = useRealtime((event) => {
  if (event.type === 'connection') {
    if (store.connection === '离线') return
    store.connection = event.payload.startsWith('在线') ? '在线' : '重连中'
  }
  if (event.type === 'permit-update') store.latestAlert = event.payload
})
const counts = computed(() => ({
  active: store.permits.filter((item) => ['执行中', '待结束'].includes(item.status)).length,
  pending: store.permits.filter((item) => ['待复核', '待执行'].includes(item.status)).length,
  invalid: store.permits.filter((item) => !item.review.valid).length,
}))
const deviceRows = computed(() => [
  { label: 'WTG-01 ~ WTG-28', sub: '正常运行', tone: 'green', count: 28 },
  { label: 'WTG-03、LINE-A2', sub: '检修隔离中', tone: 'amber', count: 2 },
  { label: 'BOX-12', sub: '待执行许可', tone: 'red', count: 1 },
])
</script>

<template>
  <div class="page">
    <div class="head">
      <div><p class="eyebrow">现场安全运行</p><h1 class="page-title">隔离与作业许可总览</h1><p class="muted">设备隔离点、作业许可复核与审计记录实时联动，离线现场确认在网络恢复后合并补传。</p></div>
      <div class="inline wrap">
        <UButton color="gray" variant="outline" icon="i-heroicons-arrow-path" @click="reconnect">检查连接</UButton>
        <UButton color="primary" icon="i-heroicons-document-plus" @click="navigateTo('/permits?new=1')">申请作业许可</UButton>
      </div>
    </div>
    <UAlert
      v-if="store.latestAlert" class="mb-4"
      :color="store.conflictCount ? 'red' : 'amber'" variant="soft"
      icon="i-heroicons-exclamation-triangle" title="实时联动提醒" :description="store.latestAlert"
      :actions="[{ label: '协调并确认', click: store.acceptAlert }]"
    />
    <section class="grid metrics">
      <article class="panel metric"><span>执行中许可</span><strong>{{ counts.active }}</strong><small>3 个班组在场</small></article>
      <article class="panel metric"><span>待复核 / 待执行</span><strong>{{ counts.pending }}</strong><small>最早 18:00 开工</small></article>
      <article class="panel metric"><span>复核失效待重算</span><strong class="danger">{{ counts.invalid }}</strong><small>隔离点状态变化触发，重算前不能推进</small></article>
      <article class="panel metric"><span>设备在线</span><strong>{{ data?.onlineDevices }}/{{ data?.totalDevices }}</strong><small>平均风速 {{ data?.windSpeed }} m/s</small></article>
    </section>
    <section class="grid main-grid">
      <article class="panel p-4">
        <div class="panel-head">
          <div><h2>当前作业状态</h2><p class="muted">每张许可带修订号；隔离点一动，复核列立即翻红</p></div>
          <div class="inline">
            <UBadge v-if="store.pendingCount" color="amber" variant="subtle">待补传 {{ store.pendingCount }}</UBadge>
            <UBadge v-if="store.conflictCount" color="red" variant="subtle">修订冲突 {{ store.conflictCount }}</UBadge>
            <UBadge color="blue" variant="subtle">版本 r{{ data?.revision }}</UBadge>
          </div>
        </div>
        <div class="table-scroll">
          <table class="data-table"><thead><tr><th>许可 / 作业</th><th>设备</th><th>负责人</th><th>时间窗</th><th>复核 / 状态</th><th>修订</th><th></th></tr></thead><tbody>
            <tr v-for="permit in store.permits" :key="permit.id">
              <td><b>{{ permit.id }}</b><small class="block muted">{{ permit.title }}</small></td>
              <td>{{ permit.device }}</td><td>{{ permit.owner }} · {{ permit.crew }}</td><td>{{ permit.window }}</td>
              <td><UBadge :color="permit.review.valid ? (permit.status === '执行中' ? 'green' : 'amber') : 'red'" variant="subtle">{{ permit.review.valid ? permit.status : permit.review.result }}</UBadge></td>
              <td class="mono">r{{ permit.revision }}</td>
              <td><UButton size="xs" variant="ghost" @click="navigateTo(`/permits?id=${permit.id}`)">进入</UButton></td>
            </tr>
          </tbody></table>
        </div>
        <div v-if="store.queue.length" class="queue-strip">
          <b>断线期间待补传（{{ store.queue.length }}）</b>
          <div v-for="op in store.queue" :key="op.clientId" class="queue-chip">
            <UBadge :color="op.status === '冲突' ? 'red' : 'amber'" size="xs" variant="subtle">{{ op.status }}</UBadge>
            <span>{{ op.actor }} · {{ op.pointId ?? `${op.permitId}/${op.stepId}` }} · {{ op.source }} · r{{ op.baseRevision }}</span>
          </div>
          <UButton size="xs" color="green" variant="soft" icon="i-heroicons-wifi" :disabled="!store.recovering" @click="store.setOnline">网络恢复后立即合并</UButton>
        </div>
      </article>
      <aside class="grid side-grid">
        <article class="panel p-4">
          <h2>设备状态</h2>
          <div v-for="row in deviceRows" :key="row.label" class="device-row">
            <span class="dot" :class="row.tone" /><div><b>{{ row.label }}</b><small>{{ row.sub }}</small></div><UBadge :color="row.tone">{{ row.count }}</UBadge>
          </div>
          <UButton block size="sm" variant="link" @click="navigateTo('/devices')">进入隔离点台账 →</UButton>
        </article>
        <article class="panel p-4"><h2>现场条件</h2><div class="condition"><span>轮毂高度风速</span><b>10.8 m/s</b></div><div class="condition"><span>能见度</span><b>12 km</b></div><div class="condition"><span>高空作业</span><b class="danger">暂停</b></div><div class="condition"><span>下一次窗口</span><b>17:40 复核</b></div></article>
      </aside>
    </section>
  </div>
</template>

<style scoped>
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:18px}.head h1{margin:3px 0 7px}.head p{margin:0}.eyebrow{font-size:12px;color:#2563eb;font-weight:700}.metrics{grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:16px}.metric{padding:17px}.main-grid{grid-template-columns:minmax(0,1.65fr) minmax(290px,.7fr);gap:16px}.panel-head{display:flex;justify-content:space-between;margin-bottom:12px}.panel h2{font-size:17px;margin:0 0 12px}.panel-head h2{margin:0}.panel-head p{font-size:12px;margin:3px 0}.block,.device-row small{display:block}.side-grid{gap:14px}.device-row,.condition{display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid #edf0f5}.device-row{justify-content:flex-start}.device-row div{flex:1}.dot{width:9px;height:9px;border-radius:50%}.dot.green{background:#22c55e}.dot.amber{background:#f59e0b}.dot.red{background:#ef4444}.condition{justify-content:space-between;font-size:14px}.condition span{color:#667085}.mono{font-family:monospace;font-size:12px}
.queue-strip{margin-top:14px;border-top:1px dashed #e2e8f0;padding-top:12px;display:flex;flex-direction:column;gap:8px}.queue-chip{display:flex;align-items:center;gap:8px;font-size:12px;color:#475569}
@media(max-width:1100px){.metrics{grid-template-columns:1fr 1fr}.main-grid{grid-template-columns:1fr}}@media(max-width:620px){.head{flex-direction:column}.metrics{grid-template-columns:1fr}}
</style>
