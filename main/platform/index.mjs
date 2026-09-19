// main/platform/index.mjs — OS 분기는 이 폴더 안에만 있다 (PLAT-06).
//
// **`process.platform`을 읽는 곳은 이 파일 한 줄뿐이다.** 나머지 코드는 platform 표를
// 읽을 뿐 자기가 어느 OS에서 도는지 모른다. test/platform.test.mjs가 이것을 지킨다 —
// 분기가 여기저기 흩어지기 시작하면 한쪽 OS에서만 도는 코드가 조용히 늘어난다.
//
// Linux는 내지 않는다. 그래도 개발 실행이 죽지는 않아야 하므로 Windows 표로 떨어뜨린다 —
// 트레이도 오버레이도 같은 방식으로 뜬다.
import { win32 } from './win32.mjs';
import { darwin } from './darwin.mjs';

export { win32, darwin };

export function platformFor(id) {
  return id === 'darwin' ? darwin : win32;
}

export const platform = platformFor(process.platform);
