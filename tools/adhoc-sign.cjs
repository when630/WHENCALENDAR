// tools/adhoc-sign.cjs — 다 싼 macOS 앱에 **ad-hoc 서명**을 붙인다 (REL-06).
//
// 인증서는 없다. 그런데 Apple 실리콘은 서명이 **하나도 없는** 실행 파일을 아예 띄우지
// 않는다 — "손상되었기 때문에 열 수 없습니다"는 대개 파일이 깨진 것이 아니라 이것이다.
//
// electron-builder는 인증서가 없으면 서명을 통째로 건너뛴다(`identity: null`). 그러면 앱
// 번들에는 Electron 바이너리가 들고 온 linker-signed 서명만 남고, 번들의 리소스는 봉인되지
// 않는다 — `codesign --verify`가 "code has no resources but signature indicates they must be
// present"로 거절한다. 실측한 결과다.
//
// 그래서 `codesign --sign -`로 직접 붙인다. 붙는 것은 신원이 아니라 **봉인**이다.
// 공증(notarization)이 아니므로 처음 열 때의 Gatekeeper 경고는 그대로 남는다 —
// 그 우회는 README에 적어 두었다. 서명을 살 때 이 파일을 지우고 identity를 넣으면 된다.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

module.exports = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  // --deep은 안쪽 Helper·Framework까지 함께 봉인한다. 진짜 인증서라면 안에서 바깥으로
  // 하나씩 서명해야 하지만, ad-hoc에는 그 구분이 의미가 없다.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log(`  • ad-hoc signed  file=${path.basename(app)} arch=${context.arch}`);
};
