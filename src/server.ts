
import fetch from 'node-fetch';

// tslint:disable-next-line:no-any
(global as any).fetch = fetch;

import '@tensorflow/tfjs-node'

import * as tf from '@tensorflow/tfjs';
import * as socketio from 'socket.io';

import {deserializeTensor, Messages, RemoteVar, SerializedTensor, serializeTensor, Var} from './common';

const serv = socketio();

const vars = new Map<string, RemoteVar<tf.Tensor>>();

function logVars() {
  let str = '\nMap {\n'
  vars.forEach(
      (v,
       k) => {str += `${k} => ${v.value.constructor.name}, ${v.value.shape}\n`})
  str += '}'
  return str;
}

function deserializeIfTensor(obj: any) {
  return obj != null && obj.dtype && obj.shape && obj.data ?
      deserializeTensor(obj) :
      obj;
}

function remoteToLocal(args: any[]) {
  return args.map(
      t => t.value !== null ? deserializeIfTensor(t.value) :
                              vars.get(t.id).value);
}

const logger = enable => (...args) => enable ? console.log(...args) : void 0;

const log = logger(true);

const specialCaseOps = {
  async loadModel(url: string) {
    tf.ENV.set('IS_BROWSER', true);
    const m = tf.loadModel(url);
    tf.ENV.set('IS_BROWSER', false);
    return await m;
  }
};

function handler(socket: SocketIO.Socket) {
  const error = (exn) => {
    socket.emit(Messages.ServerError, exn);
  };

  socket.on(Messages.Upload, (data: RemoteVar<any>, reply) => {
    try {
      log('upload', data);
      const ret = {...data, value: deserializeTensor(data.value)};
      vars.set(data.id, ret);
      return reply({...data, value: null})
    } catch (exn) {
      error(exn);
      return reply({error: exn});
    }
  });

  socket.on(Messages.Download, async (data: RemoteVar<any>, reply) => {
    try {
      log('download', data);
      const val = vars.get(data.id);
      const ret = {...val, value: await serializeTensor(val.value)};
      return reply(ret);
    } catch (exn) {
      error(exn);
      return reply({error: exn});
    }
  });

  socket.on(
      Messages.Update,
      async (target: RemoteVar<any>, val: SerializedTensor, reply) => {
        try {
          log('update', target, val);
          let obj;
          if (vars.has(target.id)) {
            obj = vars.get(target.id)
          } else {
            vars.set(target.id, target);
            obj = target;
          }
          if (obj.value && obj.value.dispose) {
            obj.value.dispose()
          }
          obj.value = deserializeTensor(val);
          return reply({...obj, value: null});
        } catch (exn) {
          error(exn);
          return reply({error: exn});
        }
      });

  socket.on(
      Messages.Op,
      async (op: string, rargs: RemoteVar<SerializedTensor>[], reply) => {
        try {
          log('op', op, rargs, logVars());
          const args = remoteToLocal(rargs);
          const opFn = op in specialCaseOps ? specialCaseOps[op] : tf[op];
          console.log(op, opFn)
          const res: tf.Tensor = await opFn(...args);
          const resVar: RemoteVar<tf.Tensor> = Var(res);

          if (res !== undefined) {
            vars.set(resVar.id, resVar);
          }
          log('ret', resVar);
          return reply({...resVar, value: null});
        } catch (exn) {
          error(exn);
          console.log('handled', exn);
          return reply({error: exn});
        }
      });

  socket.on(
      Messages.MethodCall,
      async (
          thisHandle: RemoteVar<SerializedTensor>, methodName: string,
          rargs: RemoteVar<SerializedTensor>[], reply) => {
        try {
          log('meth', thisHandle, methodName, rargs, logVars());
          const obj = vars.get(thisHandle.id);
          const args = remoteToLocal(rargs);
          log(args);
          const res: tf.Tensor =
              (obj.value as any)[methodName].bind(obj.value)(...args);
          const resVar = Var(res);
          if (res !== undefined) {
            vars.set(resVar.id, resVar);
          }
          return reply({...resVar, value: null});
        } catch (exn) {
          error(exn);
          return reply({error: exn});
        }
      })
}

serv.listen(3060).on('connection', handler);
