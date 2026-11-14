// 골든 답안(G1 = m4-base-anthropic-11121636-2). 설계안 6.2-B1 표의 답안들. golden.test.js와 스냅샷 생성이 함께 쓴다(파일 이름이 .test.js가 아니라 테스트로 돌지 않는다)
export const G1 = 'm4-base-anthropic-11121636-2';
const reject = (marks) => ({ marks, decision: 'reject', reason: '원자료와 다시 대조해 주세요' });
export const CASES = {
  emptyApprove: { marks: [], decision: 'approve' },
  emptyReject: reject([]),
  origins4: reject(['S4.b7', 'S1.e7', 'S3.i4', 'S3.i2'].map((uid) => ({ uid, origin: true }))),
  finals4: reject(['S5.n5', 'S5.n4', 'S4.b6', 'S4.b4'].map((uid) => ({ uid }))),
  bcSplit: reject([{ uid: 'S4.b5' }, { uid: 'S5.n2' }]),
  messy: { marks: [{ uid: 'S1.e1' }, { uid: 'S1.e1' }, { uid: 'S9.x1' }, { uid: 'S4.b7', origin: true }], decision: 'approve' },
};
// [판, A, 찾음, 헛짚음, bcSeen, 처음 생긴 곳 맞힘/분모, 결재 맞음, 점수]
export const TABLE = {
  emptyApprove: { 2: [5, 0, [], [], 0, 4, false, 0], 3: [5, 0, [], [], 0, 4, false, 0] },
  emptyReject: { 2: [5, 0, [], [], 0, 4, true, 20], 3: [5, 0, [], [], 0, 4, true, 20] },
  origins4: { 2: [5, 5, [], ['S3.i2'], 4, 4, true, 100], 3: [5, 5, [], ['S3.i2'], 4, 4, true, 100] },
  finals4: { 2: [5, 4, [], ['S5.n4'], 0, 4, true, 80], 3: [5, 4, [], ['S5.n4'], 0, 4, true, 80] },
  bcSplit: { 2: [5, 0, ['S4.b5', 'S5.n2'], [], 0, 4, true, 20], 3: [5, 0, ['S5.n2'], ['S4.b5'], 0, 4, true, 30] },
  messy: { 2: [5, 1, ['S1.e1'], [], 1, 4, false, 23], 3: [5, 1, ['S1.e1'], [], 1, 4, false, 23] },
};

// 테스트용 가짜 v4(설계안 6.2-B3): v3를 복사해 ① L1 근거 D-p7 → D-p8 ② L3 등급 A → B ③ L1 옮겨진 칸에 S2.r4를 더한다
export function fakeV4(v3) {
  const v4 = structuredClone(v3);
  v4.version = 4; v4.parent = 3; v4.reason = '테스트용 가짜 판';
  const L1 = v4.items.find((x) => x.id === 'L1');
  L1.evidence = L1.evidence.map((e) => (e.ref === 'D-p7' ? { ...e, ref: 'D-p8' } : e));
  L1.spread = [...L1.spread, 'S2.r4'];
  v4.items.find((x) => x.id === 'L3').grade = 'B';
  return v4;
}
// 설계안 2.3 계산 예: D 탭을 열어 D-p7을 2.3초 보고 S4.b7에 줄을 그었다
export const EXAMPLE_TRACE = { v: 1, dropped: 0, events: [[0, 'open', ''], [4100, 'tab', 'D'], [5200, 'view', 'D-p7', 2300], [61000, 'stage', 'S2'], [88000, 'mark', 'S4.b7'], [300000, 'decide', 'reject']] };
export const EXAMPLE_ANSWER = { marks: [{ uid: 'S4.b7', origin: true, note: '관심 조건이 빠짐' }], decision: 'reject', reason: 'D-1 대상 조건을 원자료 D와 다시 대조해 주세요' };
