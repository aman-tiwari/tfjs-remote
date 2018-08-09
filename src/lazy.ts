export const isLazyWrapped = Symbol.for('@@tensorflowjs/isLazyWrapped')

export function isLazy<T>(x: any): x is Lazy<T> {
  return x !== undefined && x[isLazyWrapped];
}

/**
 Wraps a Promise (or an object) with methods and values that return or are
 * promises to support "sync" chaining and usage
 * E.g:
 *
 *   class AsyncNumber {
        async constructor(x): Promise<AsyncNumber>
        async add(x): Promise<AsyncNumber>
        async mul(x: number): AsyncNumber
        async addNumber(x: AsyncNumber): AsyncNumber
      }
      ...
 *    const t = new AsyncNumber(2)
      const tg0 = lazy(t)
      const tg1 = tg0.add(1).mul(2)
      const tg2 = tg1.add(3)
      const tg3 = tg1.addNumber(tg2)
      const tg4 = lazy(new AsyncNumber(1))
      tg4.value = Promise.resolve(5)

      6 == await tg1.value
      9 == tg2.value
      15 == tg3.value
      etc...

 */

type Lazy<T> = {
  [P in keyof T]: T[P]
}

import{inspect} from 'util';

export function lazy<T>(objOrPromise: T): T {
  const obj = Promise.resolve(objOrPromise);
  const then: any = obj.then.bind(obj);
  const toString = () => '[object lazy]'
  const callable: any = function LazyObject() {} as any;
  callable.prototype = Promise.prototype;

  return new Proxy(callable as any, {
           get(target, prop, recv): any {
             if (prop === 'then') {
               return then;
             } else if (prop === isLazyWrapped) {
               return true;
             } else if (
                 prop === 'toString' || prop === 'inspect' ||
                 prop === inspect.custom) {
               return toString;
             }
             const s = then((o: T) => {
               const val: any = o[prop as keyof T];
               return typeof val === 'function' ? val.bind(o) : val
             })
             return lazy(s);
           },

           set(target, prop, value) {
             throw new Error('Impossible to set a property on a lazy object')
           },

           apply(target, thisArg, argumentsList) {
             return lazy(Promise.all([obj, ...argumentsList])
                             .then(
                                 ([o, ...args]) => {
                                     return Reflect.apply(o, thisArg, args)}));
           }
         }) as any as Lazy<T>;
};
