type RealtimeEvent = { type: 'permit-update' | 'connection'; payload: string }

export function useRealtime(onEvent: (event: RealtimeEvent) => void) {
  let timer: ReturnType<typeof setInterval> | undefined
  let socket: WebSocket | undefined

  function connect() {
    const url = useRuntimeConfig().public.wsUrl as string | undefined
    if (url && import.meta.client) {
      socket = new WebSocket(url)
      socket.onmessage = (event) => onEvent(JSON.parse(event.data))
      socket.onclose = () => onEvent({ type: 'connection', payload: '重连中' })
      return
    }
    onEvent({ type: 'connection', payload: '在线 · 模拟通道' })
    timer = setInterval(() => {
      const updates = ['通道心跳正常 · 隔离点与许可修订号已同步', '风速 10.8m/s，高空作业保持暂停']
      onEvent({ type: 'permit-update', payload: updates[Math.floor(Math.random() * updates.length)]! })
    }, 30000)
  }
  function disconnect() { if (timer) clearInterval(timer); socket?.close() }
  function reconnect() {
    disconnect()
    connect()
  }
  onMounted(connect)
  onBeforeUnmount(disconnect)
  return { reconnect, disconnect }
}
