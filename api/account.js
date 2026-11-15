// POST /api/account — 선택 계정(아이디·비밀번호). 계정 없이도 모든 기능을 쓴다.
// 기록은 지금처럼 브라우저의 무작위 번호(기록 코드 = deviceId)에 묶여 있고, 계정은 그 기록 코드를 아이디·비밀번호에 묶어 다른 기기에서 이어 보게 하는 열쇠다.
//   { action:'signup', username, password, code? }  가입. code(기록 코드)를 주면 그 기록을 그대로 계정에 묶는다(없으면 이 브라우저의 deviceId)
//   { action:'login', username, password }          로그인 → { username, deviceId }. 브라우저는 이 deviceId로 바꿔 기록을 이어 본다
//   { action:'code', code }                         비회원 기록 코드로 이어 보기. 계정에 묶인 코드는 로그인해야 한다
//   { action:'status', deviceId }                   이 기록 코드가 계정에 묶였나
// 이름·이메일·연락처는 받지 않는다. 비밀번호는 scrypt(솔트 16바이트)로만 저장하고, 아이디당 15분에 10번 틀리면 잠시 막는다.
import { scrypt as _scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { handler, body, deviceOk, err } from './_lib.js';
import { getJson, setJson, sadd, sismember, incr, del, lrange } from '../src/store.js';

const scrypt = promisify(_scrypt);
const LONG = 400 * 24 * 3600;
const USER = /^[a-z0-9_]{3,20}$/;
const norm = (u) => String(u ?? '').trim().toLowerCase();
const hashOf = async (password, salt) => (await scrypt(String(password), salt, 64)).toString('base64');

function checkPassword(p) {
  if (typeof p !== 'string' || p.length < 8 || p.length > 72) throw err('비밀번호는 8~72자로 정해 주세요');
}

export default handler(async (req) => {
  if (req.method !== 'POST') throw err('POST만 받습니다', 405);
  const b = body(req);

  if (b.action === 'signup') {
    const u = norm(b.username);
    if (!USER.test(u)) throw err('아이디는 영문 소문자·숫자·밑줄 3~20자로 정해 주세요');
    checkPassword(b.password);
    const code = b.code ?? b.deviceId;
    if (!deviceOk(code)) throw err('기록 코드 형식이 맞지 않습니다');
    if (await sismember('ss2:accountDevs', code)) throw err('이 기록 코드는 이미 다른 계정에 묶여 있습니다', 409);
    if (!(await sadd('ss2:accounts', u, LONG))) throw err('이미 쓰는 아이디입니다', 409);
    if (!(await sadd('ss2:accountDevs', code, LONG))) throw err('이 기록 코드는 이미 다른 계정에 묶여 있습니다', 409);
    const salt = randomBytes(16).toString('base64');
    await setJson(`ss2:account:${u}`, { username: u, salt, hash: await hashOf(b.password, salt), deviceId: code, at: new Date().toISOString() }, LONG);
    return { username: u, deviceId: code };
  }

  if (b.action === 'login') {
    const u = norm(b.username);
    if (!USER.test(u) || typeof b.password !== 'string') throw err('아이디 또는 비밀번호가 맞지 않습니다', 401);
    const failKey = `ss2:loginfail:${u}`;
    if ((await incr(failKey, 0, 900)) >= 10) throw err('비밀번호를 여러 번 틀렸습니다. 15분 뒤에 다시 해 주세요', 429);
    const a = await getJson(`ss2:account:${u}`);
    const ok = a && timingSafeEqual(Buffer.from(await hashOf(b.password, a.salt)), Buffer.from(a.hash));
    if (!ok) { await incr(failKey, 1, 900); throw err('아이디 또는 비밀번호가 맞지 않습니다', 401); }
    await del(failKey);
    return { username: a.username, deviceId: a.deviceId };
  }

  if (b.action === 'code') {
    if (!deviceOk(b.code)) throw err('기록 코드 형식이 맞지 않습니다');
    if (await sismember('ss2:accountDevs', b.code)) throw err('계정에 묶인 기록 코드입니다. 아이디로 로그인해 주세요', 403);
    if (!(await lrange(`ss2:dev:${b.code}`, 0, 0)).length) throw err('이 기록 코드로 남은 기록이 없습니다', 404);
    return { deviceId: b.code };
  }

  if (b.action === 'status') {
    if (!deviceOk(b.deviceId)) throw err('기기 ID가 없습니다');
    return { account: await sismember('ss2:accountDevs', b.deviceId) };
  }
  throw err('모르는 동작');
});
