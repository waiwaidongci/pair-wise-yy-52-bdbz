import { useOperationsStore } from '~/stores/operations'
import type { OperationSource } from '~/types'

export type RealtimeEvent =
  | { type: 'connection'; payload: string }
  | { type: 'permit-update'; payload: string }
  | { type: 'remote-op'; payload: { permitId: string; stepId: string; done: boolean; evidence?: string; source: OperationSource } }

/** 其他班组在现场终端上的确认（实时通道下发，会抬高步骤修订号） */
const REMOTE_OPS: Array<{ permitId: string; stepId: string; done: boolean; evidence?: string; source: OperationSource }> = [
  { permitId: 'WP-260929-018', stepId: 'ST-03', done: true, evidence: '验电合格，接地线 GND-042', source: { crew: '线路一班', actor: '何岚', terminal: '平板-07' } },
  { permitId: 'WP-260929-021', stepId: 'ST-12', done: true, evidence: '五防校验通过', source: { crew: '电气二班', actor: '谭勇', terminal: '平板-09' } },
  { permitId: 'WP-260930-004', stepId: 'ST-22', done: true, source: { crew: '电气一班', actor: '孙禾', terminal: '平板-12' } },
]

export function useRealtime(onEvent?: (event: RealtimeEvent) => void) {
  const store = useOperationsStore()
  let timer: ReturnType<typeof setInterval> | undefined
  let socket: WebSocket | undefined

  function handle(event: RealtimeEvent) {
    if (event.type === 'connection') {
      store.setConnection(event.payload.startsWith('在线') ? '在线' : '重连中')
    } else if (event.type === 'remote-op') {
      store.applyRemoteStepConfirm(event.payload)
    } else if (onEvent) {
      onEvent(event)
    }
  }

  function connect() {
    const url = useRuntimeConfig().public.wsUrl as string | undefined
    if (url && import.meta.client) {
      socket = new WebSocket(url)
      socket.onmessage = (event) => handle(JSON.parse(event.data))
      socket.onclose = () => store.setConnection('重连中')
      return
    }
    store.setConnection('在线')
    timer = setInterval(() => {
      if (store.connection === '在线' && Math.random() < 0.45) {
        handle({ type: 'remote-op', payload: REMOTE_OPS[Math.floor(Math.random() * REMOTE_OPS.length)]! })
      } else {
        const updates = ['WTG-03 隔离点状态已由周野确认', '风速 10.8m/s，高空作业保持暂停', 'LINE-A2 许可复核提醒已送达负责人']
        handle({ type: 'permit-update', payload: updates[Math.floor(Math.random() * updates.length)]! })
      }
    }, 12000)
  }
  function disconnect() { if (timer) clearInterval(timer); socket?.close() }
  onMounted(connect)
  onBeforeUnmount(disconnect)
  return { reconnect: connect, disconnect }
}
