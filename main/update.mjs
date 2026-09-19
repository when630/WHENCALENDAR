// main/update.mjs — GitHub Releases를 보고 새 버전을 알린다 (REL-03).
//
// **사용자가 모르는 채로 바뀌지 않는다.** 내려받은 뒤에도 바로 재시작하지 않고 다음에
// 앱을 끌 때 설치한다. 상주 앱이 쓰는 도중에 스스로 사라지면, 그 순간 놓친 일정이
// 이 앱이 막으려던 바로 그 일이다.
//
// macOS는 여기서 갈라진다 — Squirrel.Mac은 **서명된 앱만** 갈아끼운다. 미서명 설치본에서
// 내려받아 봐야 설치가 못 끝나고 조용히 실패한다. 그래서 macOS에서는 확인만 하고
// (latest-mac.yml은 릴리스에 함께 올라간다) 받는 것은 사람이 한다 (D-31).
import { app, shell } from 'electron';
import electronUpdater from 'electron-updater';
import { platform } from './platform/index.mjs';
import { createUpdateState, updateLine, shortError } from './update-text.mjs';

export { createUpdateState, updateLine, shortError } from './update-text.mjs';

// electron-updater는 CommonJS다 — ESM에서는 구조분해로 꺼내야 한다.
const { autoUpdater } = electronUpdater;

export const RELEASES_URL = 'https://github.com/when630/whencalendar/releases/latest';

// 켜자마자 확인하지 않는다 — 부팅이 무거워지고, 첫 화면이 느려지면 상주 앱의 쓸모가 준다.
const FIRST_CHECK_MS = 60_000;
// 하루 한 번. 트레이 앱은 몇 주씩 떠 있어 주기 확인이 곧 유일한 확인 기회다.
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function createUpdater({ onChange = () => {} } = {}) {
  const state = createUpdateState();
  let timer = null;

  const emit = () => onChange(state);

  // 개발 실행에는 업데이트가 없다. 확인을 시도하면 dev-app-update.yml이 없다고 시끄럽다.
  const supported = app.isPackaged;

  if (supported) {
    autoUpdater.autoDownload = platform.update.autoDownload;
    // 종료할 때 설치 — 쓰는 도중에 재시작하지 않는다. macOS는 둘 다 꺼진다.
    autoUpdater.autoInstallOnAppQuit = platform.update.installOnQuit;

    autoUpdater.on('checking-for-update', () => {
      state.status = 'checking';
      emit();
    });
    autoUpdater.on('update-available', (info) => {
      // macOS에서는 여기가 끝이다. 내려받지 않으므로 download-progress도 ready도 오지 않는다.
      state.status = platform.update.manual ? 'manual' : 'available';
      state.version = info?.version ?? null;
      emit();
    });
    autoUpdater.on('update-not-available', () => {
      state.status = 'idle';
      state.checkedAt = new Date().toISOString();
      emit();
    });
    autoUpdater.on('download-progress', (p) => {
      state.status = 'downloading';
      state.percent = p?.percent ?? 0;
      emit();
    });
    autoUpdater.on('update-downloaded', (info) => {
      state.status = 'ready';
      state.version = info?.version ?? state.version;
      emit();
    });
    autoUpdater.on('error', (err) => {
      state.status = 'error';
      state.error = shortError(err);
      emit();
    });
  } else {
    state.status = 'unsupported';
  }

  async function check() {
    if (!supported) return state;
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      state.status = 'error';
      state.error = shortError(err);
      emit();
    }
    return state;
  }

  const openReleases = () => shell.openExternal(RELEASES_URL);

  return {
    state,
    line: (current) => updateLine(state, current),
    check,
    openReleases,

    // 트레이 메뉴에서 그 줄을 눌렀을 때. 상태에 따라 하는 일이 다르다 —
    // 새 버전을 찾아 둔 macOS에서는 확인을 한 번 더 하는 것이 아니라 받는 곳을 연다.
    activate() {
      if (!supported) return state;
      if (state.status === 'manual') {
        openReleases();
        return state;
      }
      return check();
    },
    start() {
      if (!supported) return;
      setTimeout(check, FIRST_CHECK_MS);
      timer = setInterval(check, CHECK_INTERVAL_MS);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
