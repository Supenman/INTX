/**
 * 结果类型：领域函数用它表达可预期的失败，而不是抛异常。
 *
 * 理由：端口不兼容、资产缺失、参数非法这些都是业务常态，
 * 调用方需要"哪一步失败了、为什么"的具体信息，而不是一个 Error 栈。
 * 异常留给真正的程序错误（bug）。
 */
export type Ok<T> = { ok: true; value: T };
export type Err<E> = { ok: false; error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is Ok<T> {
  return r.ok === true;
}

export function isErr<T, E>(r: Result<T, E>): r is Err<E> {
  return r.ok === false;
}
