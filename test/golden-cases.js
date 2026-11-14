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
