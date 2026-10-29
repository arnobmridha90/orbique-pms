/* A stand-in for the Supabase client in unit tests: every query is answered by handler(table, ops), every rpc by
 * rpc(name, args), every Storage call by storage(bucket, method, args) (sb.storage.from(bucket).method(...args)).
 * ops lists the calls made on the builder: [['select', 'id'], ['eq', 'org_id', 'x'], ...]. */
export function fakeSb({ handler = () => ({ data: null, error: null }), rpc = () => ({ data: null, error: null }), storage = () => ({ data: null, error: null }) } = {}) {
  const calls = [];
  const sb = {
    calls,
    from(table) {
      const ops = [];
      const run = () => { calls.push({ table, ops }); return Promise.resolve(handler(table, ops)); };
      const b = new Proxy({}, {
        get(_, k) {
          if (k === 'then') return (res, rej) => run().then(res, rej);
          if (k === 'maybeSingle' || k === 'single') return () => { ops.push([k]); return run(); };
          return (...args) => { ops.push([k, ...args]); return b; };
        }
      });
      return b;
    },
    rpc(name, args) { calls.push({ rpc: name, args }); return Promise.resolve(rpc(name, args)); },
    storage: {
      from(bucket) {
        return new Proxy({}, { get: (_, method) => (...args) => { calls.push({ storage: method, bucket, args }); return Promise.resolve(storage(bucket, method, args)); } });
      }
    }
  };
  return sb;
}

/** The value given to the first op named k (eq('org_id', x) -> op('eq', 'org_id') is x). */
export const op = (ops, k, field) => { const o = ops.find((x) => x[0] === k && (field === undefined || x[1] === field)); return o ? (field === undefined ? o[1] : o[2]) : undefined; };
