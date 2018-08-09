import {shapesOnly} from 'tfjs-shapes';

import {Comm} from './client_comm';
import {deserializeTensor, RemoteVar, SerializedTensor, Var} from './common';
import {weightlessHttpRequestRouter} from './weightless_handler';

// import {lazy} from './lazy';

export const loadHandler = weightlessHttpRequestRouter;

export function remoteTF<T>(
    moduleToWrap: T, comm: Comm<SerializedTensor, any>, specialCasedOps) {
  return new Proxy(moduleToWrap as any, {
           get(target, prop, recv) {
             if (prop === 'toString') {
               return Reflect.get(target, prop, recv);
             }

             if (specialCasedOps[prop]) {
               return specialCasedOps[prop];
             }

             let metadataMethod = Reflect.get(target, prop, recv);

             if (!(metadataMethod instanceof Function)) return metadataMethod;

             metadataMethod = metadataMethod.bind(target);
             return (...args: any[]) => {
               const metadata = shapesOnly(() => metadataMethod(...args));
               const rargs = args.map(
                   a => (a != null && a.dataId && a.dataId.remote) ?
                       a.dataId.remote :
                       Var(a))
               metadata.dataId.remote =
                   Promise.all(rargs).then(rargs => comm.emit(prop, rargs));
               return dispatchMethods(comm)(metadata);
             }
           }
         }) as T
}

const isPropIn = (objectsToCheckIn: any[]) => (prop: string|number|symbol) =>
    objectsToCheckIn.some(v => v != null && prop in v);

void isPropIn;

// type PropertyChecker = (prop: string|number|symbol) => boolean;

type RemoteTensor = {
  dataId: {remote: Promise<RemoteVar<SerializedTensor>>}
}

export const dispatchMethods = (comm: Comm<SerializedTensor, any>) =>
    (rtensor: RemoteTensor) =>
        !(rtensor && rtensor.dataId && rtensor.dataId.remote) ?
    rtensor :  // if not actually a RemoteTensor
    new Proxy(rtensor, {
      get(target, prop, recv) {
        const rvar = rtensor.dataId.remote;
        if (prop === 'data') {
          return () => rvar.then(rvar => comm.downloadVar(rvar))
                           .then(({value}) => deserializeTensor(value).data());
        }
        if (prop === 'dataSync') {
          return () => {
            throw new Error('Impossible to dataSync')
          };
        }
        if (prop === 'print') {
          return () => rvar.then(rvar => comm.downloadVar(rvar))
                           .then(({value}) => {
                             const t = deserializeTensor(value);
                             t.print();
                             t.dispose();
                           });
        }

        let val = Reflect.get(target, prop, recv);

        if (!(val instanceof Function)) return val;

        const metadataMethod = val.bind(target);
        console.log(prop);
        return (...args: any[]) => {
          console.log(prop, args);
          const metadata = shapesOnly(() => metadataMethod(...args));

          const rargs = args.map(
              a => (a != null && a.dataId && a.dataId.remote) ?
                  a.dataId.remote :
                  Var(a))

          metadata.dataId.remote =
              Promise.all([rvar, ...rargs])
                  .then(
                      ([rvar, ...rargs]) =>
                          comm.methodCall(rvar, prop.toString(), rargs));

          return dispatchMethods(comm)(metadata);
        }
      }
    });


async function loadRemoteModel(tf: any, comm: Comm<any, any>, url: string) {
  const remoteUrl = 'remote://' + url;
  console.log(url, remoteUrl);
  const modelP = comm.emit('loadModel', [Var(url)]);
  const [m, rvar] = await Promise.all([tf.loadModel(remoteUrl), modelP]);
  return {
    predict(...args: any[]) {
      const metadata = shapesOnly(() => m.predict(...args));

      const rargs = args.map(
          a => (a != null && a.dataId && a.dataId.remote) ? a.dataId.remote :
                                                            Var(a))

      metadata.dataId.remote =
          Promise.all([rvar, ...rargs])
              .then(([rvar,
                      ...rargs]) => comm.methodCall(rvar, 'predict', rargs));
      return dispatchMethods(comm)(metadata);
    }
  }
}

function specialCases(comm: Comm<SerializedTensor, any>, tf: any) {
  return {
    async loadModel(url: string) {
      return loadRemoteModel(tf, comm, url);
    }
  }
}

export async function initRemote(url: string) {
  const comm = new Comm<SerializedTensor, keyof Comm<SerializedTensor, any>>();
  await comm.connect('http://localhost:3060');
  return <T>(tf: T) => {
    (tf as any).io.registerLoadRouter(loadHandler);
    return remoteTF(tf, comm, specialCases(comm, tf)) as T;
  }
}
