// WHENCALENDAR — 트레이 상주. 상단 아일랜드 오버레이가 다음 일정까지 남은 시간을 말한다.
//
// 엔트리포인트는 bootstrap() 호출 하나뿐이다(WHENWORK D-08 승계). 앱 수명·트레이·틱은
// main/lifecycle.mjs, 오버레이 창은 main/overlay.mjs, "지금 몇 시고 다음이 뭔가"는
// main/clock.mjs — 상태 계산은 clock 한 곳에서만 한다.
import { bootstrap } from './lifecycle.mjs';

bootstrap();
