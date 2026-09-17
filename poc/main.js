'use strict'

// whencalendar 오버레이 PoC — 확정안 ①점 + ⑧끝5분전
// 검증 목표
//  1) 전체화면 앱 위에 뜨는가            (setAlwaysOnTop screen-saver)
//  2) 클릭 통과 + 호버 확장이 같이 되는가 (setIgnoreMouseEvents forward)
//  3) 실제 크기에서 침범 곡선이 어떤가

const { app, BrowserWindow, globalShortcut, screen, ipcMain } = require('electron')
const path = require('node:path')

const WIN_W = 620
const WIN_H = 156

// 오늘 일정 (분 단위)
const AGENDA = [
  { t: '주간 회의',   from: 840,  to: 900  },  // 14:00~15:00
  { t: '디자인 리뷰', from: 930,  to: 975  },  // 15:30~16:15
  { t: '1:1 미팅',    from: 1020, to: 1050 }   // 17:00~17:30
]
const T0 = 780, T1 = 1060   // 13:00 ~ 17:40

let win = null
let playTimer = null

const state = {
  now: 825,          // 13:45에서 시작 — 첫 일정 15분 전
  playing: false,
  ringSize: 20,
  live: false        // true면 실제 현재 시각을 쓴다
}

function push (hud = false) {
  if (!win || win.isDestroyed()) return
  win.webContents.send('state', {
    now: state.now,
    agenda: AGENDA,
    ringSize: state.ringSize,
    playing: state.playing,
    live: state.live,
    hud
  })
}

function createWindow () {
  const d = screen.getPrimaryDisplay()
  win = new BrowserWindow({
    x: Math.round(d.bounds.x + (d.bounds.width - WIN_W) / 2),
    y: d.bounds.y,
    width: WIN_W,
    height: WIN_H,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    focusable: false,      // 포커스를 뺏지 않는다
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  })

  // 마우스는 통과시키되 이동 이벤트는 렌더러로 넘긴다 — 호버 확장을 위해
  win.setIgnoreMouseEvents(true, { forward: true })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // 전체화면·TopMost 창이 나중에 뜨면 같은 z-order 밴드에서 우리 위로 올라간다.
  // 주기적으로 맨 위를 다시 잡는다. moveTop()은 포커스를 뺏지 않는다.
  setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return
    win.setAlwaysOnTop(true, 'screen-saver')
    win.moveTop()
  }, 1000)

  win.loadFile(path.join(__dirname, 'overlay.html'))
  win.webContents.once('did-finish-load', () => {
    win.showInactive()
    push(true)
  })
}

// 아일랜드 위에 마우스가 올라오면 잠깐 통과를 끈다
ipcMain.on('hover', (_e, on) => {
  if (!win || win.isDestroyed()) return
  win.setIgnoreMouseEvents(!on, { forward: true })
})

function stopPlay () {
  if (playTimer) clearInterval(playTimer)
  playTimer = null
  state.playing = false
}

function togglePlay () {
  if (state.playing) { stopPlay(); push(true); return }
  state.live = false
  state.playing = true
  state.now = T0
  const stepMs = 40
  const inc = (T1 - T0) / ((46 * 1000) / stepMs)   // 4시간 40분을 46초로
  playTimer = setInterval(() => {
    state.now += inc
    if (state.now >= T1) { state.now = T1; stopPlay(); push(true); return }
    push()
  }, stepMs)
  push(true)
}

function toggleLive () {
  stopPlay()
  state.live = !state.live
  if (state.live) {
    const tick = () => {
      const d = new Date()
      state.now = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
      push()
    }
    tick()
    playTimer = setInterval(tick, 1000)
    state.playing = false
  }
  push(true)
}

function bindShortcuts () {
  // whenwork(Ctrl+Alt+Space) · whennote(Ctrl+Alt+M/N)와 겹치지 않는 키
  globalShortcut.register('Ctrl+Alt+P', togglePlay)
  globalShortcut.register('Ctrl+Alt+L', toggleLive)

  globalShortcut.register('Ctrl+Alt+Right', () => {
    stopPlay(); state.live = false
    state.now = Math.min(T1, state.now + 10)
    push(true)
  })
  globalShortcut.register('Ctrl+Alt+Left', () => {
    stopPlay(); state.live = false
    state.now = Math.max(T0, state.now - 10)
    push(true)
  })
  globalShortcut.register('Ctrl+Alt+0', () => {
    stopPlay(); state.live = false
    state.now = 825
    push(true)
  })

  ;[16, 20, 26].forEach((sz, i) => {
    globalShortcut.register(`Ctrl+Alt+${i + 1}`, () => {
      state.ringSize = sz
      push(true)
    })
  })

  globalShortcut.register('Ctrl+Alt+H', () => push(true))
  globalShortcut.register('Ctrl+Alt+Q', () => app.quit())
}

app.whenReady().then(() => {
  createWindow()
  bindShortcuts()
})

app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => app.quit())
