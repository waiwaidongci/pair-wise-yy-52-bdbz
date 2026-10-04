<script setup lang="ts">
import { useOperationsStore } from '~/stores/operations'
import type { PointState } from '~/types'

const store = useOperationsStore()
const selectedDevice = ref('WTG-03')
const devices = [
  { id: 'WTG-03', name: '3 号风力发电机组', state: '检修隔离', load: '0 kW', points: 3, crew: '机务二班' },
  { id: 'LINE-A2', name: 'A2 集电线路', state: '待隔离', load: '0.8 MW', points: 3, crew: '线路一班' },
  { id: 'BOX-12', name: '12 号箱式变压器', state: '运行', load: '2.4 MW', points: 1, crew: '电气一班' },
  { id: 'BUS-A', name: 'A 段 35kV 母线', state: '运行', load: '18.6 MW', points: 1, crew: '公用' },
]

/** 扁平化出「许可 - 隔离点」对，便于操作 */
const selectedPoints = computed(() =>
  store.permits.flatMap((permit) =>
    permit.isolationPoints
      .filter((point) => point.device.includes(selectedDevice.value) || permit.device.includes(selectedDevice.value))
      .map((point) => ({ permitId: permit.id, permitTitle: permit.title, point })),
  ),
)

function nextState(state: PointState): PointState {
  if (state === '已隔离') return '已恢复'
  if (state === '已恢复') return '已隔离'
  return '已隔离'
}
function stateColor(state: PointState) {
  return state === '已隔离' ? 'green' : state === '已恢复' ? 'blue' : 'amber'
}
</script>

<template>
  <div class="page">
    <div class="head"><div><p class="eyebrow">LOCKOUT / TAGOUT</p><h1 class="page-title">设备隔离与锁定点</h1><p class="muted">隔离点状态变更后，相关许可的复核结果立即失效并退回重算；操作带来源与修订号。</p></div><UButton color="primary" icon="i-heroicons-plus">登记隔离点</UButton></div>
    <div class="device-grid">
      <article v-for="device in devices" :key="device.id" class="panel device" :class="{ active: selectedDevice === device.id }" @click="selectedDevice = device.id"><div class="inline justify-between"><UBadge variant="subtle">{{ device.id }}</UBadge><UBadge :color="device.state === '运行' ? 'green' : device.state === '检修隔离' ? 'red' : 'amber'" variant="subtle">{{ device.state }}</UBadge></div><h2>{{ device.name }}</h2><div class="kv"><span>当前负荷</span><b>{{ device.load }}</b></div><div class="kv"><span>隔离点</span><b>{{ device.points }} 个</b></div><div class="kv"><span>责任班组</span><b>{{ device.crew }}</b></div></article>
    </div>
    <section class="grid lower"><article class="panel p-4"><h2>{{ selectedDevice }} · 隔离检查单</h2><div v-for="item in selectedPoints" :key="item.point.id" class="point"><div class="lock-icon"><UIcon name="i-heroicons-lock-closed" /></div><div class="point-body"><b>{{ item.point.label }}</b><small>{{ item.point.type }} · {{ item.point.id }} · r{{ item.point.revision }}<template v-if="item.point.updatedBy"> · {{ item.point.updatedBy.actor }} 于 {{ item.point.updatedAt }}</template></small><small class="muted">{{ item.permitId }} · {{ item.permitTitle }}</small></div><UBadge :color="stateColor(item.point.state)" variant="subtle">{{ item.point.state }}</UBadge><UButton size="xs" :color="item.point.state === '已隔离' ? 'blue' : 'green'" variant="soft" @click="store.submitPoint(item.permitId, item.point.id, nextState(item.point.state))">{{ item.point.state === '已隔离' ? '恢复' : '隔离' }}</UButton></div><UAlert v-if="!selectedPoints.length" color="gray" title="该设备暂无隔离点" description="可在许可中新建隔离点并关联设备。" /></article><article class="panel p-4"><h2>复核联动</h2><UAlert color="amber" variant="soft" title="隔离点状态一变，复核立即失效" description="点状态变更会退回相关许可至「待复核」，需值班负责人重新确认后方可继续推进。" /><div v-for="permit in store.permits.filter((p) => p.reviewRequired)" :key="permit.id" class="review-row"><div><b>{{ permit.id }}</b><small>{{ permit.title }}</small></div><UBadge color="red" variant="subtle">待复核</UBadge></div><h3>锁定器具台账</h3><div class="tool"><span>LK-2107</span><b>WTG-03 · 周野</b></div><div class="tool"><span>LK-2118</span><b>LINE-A2 · 待领用</b></div><div class="tool"><span>GND-042</span><b>17 号杆 · 谭勇</b></div></article></section>
  </div>
</template>

<style scoped>
.head{display:flex;justify-content:space-between;margin-bottom:18px}.head h1{margin:3px 0 7px}.head p{margin:0}.eyebrow{font-size:12px;color:#2563eb;font-weight:700}.device-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:16px}.device{padding:16px;cursor:pointer}.device.active{border-color:#2563eb;box-shadow:0 0 0 2px #dbeafe}.device h2{font-size:16px;margin:14px 0}.kv{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #edf0f5;font-size:13px}.kv span{color:#667085}.lower{grid-template-columns:1.3fr .7fr;gap:16px}.panel h2{font-size:17px;margin:0 0 14px}.panel h3{font-size:15px;margin:18px 0 10px}.point{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #edf0f5}.point-body{flex:1}.point-body b,.point-body small{display:block}.point-body small{color:#667085;margin-top:4px}.lock-icon{display:grid;place-items:center;width:34px;height:34px;background:#eff6ff;color:#2563eb;border-radius:7px}.review-row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #edf0f5}.review-row b,.review-row small{display:block}.review-row small{color:#667085;margin-top:2px}.tool{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #edf0f5}.tool span{color:#2563eb;font-family:monospace}.tool b{font-size:13px}
@media(max-width:1050px){.device-grid{grid-template-columns:1fr 1fr}.lower{grid-template-columns:1fr}}@media(max-width:600px){.head{flex-direction:column;gap:12px}.device-grid{grid-template-columns:1fr}}
</style>
