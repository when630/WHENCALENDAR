// main/update-text.mjs — 업데이트 상태를 사람이 읽는 말로 (REL-03).
//
// update.mjs는 electron을 import해야 해서 node --test로 열 수 없다. 문구와 오류 줄이기는
// 순수 계산이라 여기로 떼어냈다 — 이 프로젝트에서 테스트가 닿지 않는 코드는 최소로 둔다.

export function createUpdateState() {
  return { status: 'idle', version: null, percent: 0, error: null, checkedAt: null };
}

// 상태를 한 줄 말로. 트레이 메뉴와 설정 화면이 같은 문구를 쓴다 —
// 두 곳이 다른 말을 하면 사용자는 어느 쪽이 맞는지 알 수 없다.
export function updateLine(state, current = '') {
  switch (state.status) {
    case 'checking':
      return '업데이트 확인 중…';
    case 'available':
      return `새 버전 ${state.version} — 내려받는 중`;
    case 'downloading':
      return `새 버전 ${state.version} 내려받는 중 ${Math.round(state.percent)}%`;
    case 'ready':
      return `새 버전 ${state.version} 준비됨 — 종료할 때 설치됩니다`;
    // macOS. 내려받아 갈아끼우는 경로가 없으므로(D-31) 있다는 것만 알리고 사람이 받는다.
    case 'manual':
      return `새 버전 ${state.version} — 눌러서 받으러 갑니다`;
    case 'error':
      return `업데이트 확인 실패 — ${state.error}`;
    case 'unsupported':
      return '업데이트 확인은 설치본에서만 동작합니다';
    default:
      return current ? `최신 버전 (${current})` : '최신 버전';
  }
}

// 사용자에게 보일 한 줄로 줄인다. 내부 경로나 스택은 내보내지 않는다.
export function shortError(err) {
  const msg = String(err?.message ?? err ?? '');
  if (/ENOTFOUND|EAI_AGAIN|ENETUNREACH|ECONNREFUSED/.test(msg)) return '네트워크에 닿지 못했습니다';
  if (/404/.test(msg)) return '아직 공개된 릴리스가 없습니다';
  if (/rate limit/i.test(msg)) return 'GitHub 요청 한도에 걸렸습니다 — 잠시 뒤 다시';
  return msg.split('\n')[0].slice(0, 120) || '알 수 없는 오류';
}
