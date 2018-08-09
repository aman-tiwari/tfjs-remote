import {Comm} from '../client_comm';
import {deserializeTensor, RemoteVar, SerializedTensor, Var} from '../common';
import {lazy} from '../lazy';

export function remoteTF<T>(
    moduleToWrap: T, comm: Comm<SerializedTensor, any>, propCheckObjs: any[]) {
  const checker = isPropIn(propCheckObjs);
  return new Proxy(moduleToWrap as any, {
           get(target, prop, recv) {
             if (prop === 'toString') {
               return Reflect.get(target, prop, recv);
             }
             if (!checker(prop)) {
               return undefined;
             }

             return (...args: any[]) => {
               console.log(prop, args);
               const rargs = args.map(
                   a =>
                       (a !== undefined && a['type'] === 'remote') ? a : Var(a))
               return comm.emit(prop, rargs)
                   .then(dispatchMethods(comm, checker));
             }
           }
         }) as T
}

const isPropIn = (objectsToCheckIn: any[]) => (prop: string|number|symbol) =>
    objectsToCheckIn.some(v => v != null && prop in v);

type PropertyChecker = (prop: string|number|symbol) => boolean;

export const dispatchMethods =
    (comm: Comm<SerializedTensor, any>, propChecker: PropertyChecker) =>
        (rvar: RemoteVar<SerializedTensor>) => new Proxy(rvar, {
          get(target, prop, recv) {
            if (prop in rvar) return rvar[prop as keyof typeof rvar];
            if (!propChecker(prop)) return undefined;
            if (prop === 'data') {
              return () => comm.downloadVar(rvar).then(
                         ({value}) => deserializeTensor(value).data());
            }
            if (prop === 'dataSync') {
              return () => {
                throw new Error('Impossible to dataSync')
              };
            }
            if (prop === 'print') {
              return () => comm.downloadVar(rvar).then(({value}) => {
                const t = deserializeTensor(value);
                t.print();
                t.dispose();
              });
            }

            console.log('meth', rvar, prop, propChecker(prop))
            return (...args: any[]) => {
              console.log(
                  prop,
                  args.map(
                      a => (a !== undefined && a['type'] === 'remote') ?
                          {'remote': a} :
                          {'toBeWrapped': a}));
              const rargs = args.map(
                  a => (a !== undefined && a['type'] === 'remote') ? a : Var(a))
              return comm.methodCall(rvar, prop.toString(), rargs)
                  .then(dispatchMethods(comm, propChecker));
            }
          }
        });


export async function initRemote(url: string) {
  const comm = new Comm<SerializedTensor, keyof Comm<SerializedTensor, any>>();
  await comm.connect('http://localhost:3060');
  return <T>(tf: T) => lazy(remoteTF(tf, comm, [
                         tf, (tf as any).Tensor.prototype, {predict: true}
                       ])) as T;
}
